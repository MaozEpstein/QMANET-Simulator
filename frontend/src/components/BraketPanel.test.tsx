/**
 * Frontend tests for BraketPanel (Phase 7 UI).
 *
 * The panel is a pure render of {positions, schedule} props plus a `fetch`
 * stub for the two backend endpoints. We don't try to assert layout pixels —
 * we verify the behaviour a user actually sees:
 *  1. Initial render without any payload.
 *  2. "Build payload" triggers a POST and renders cost / runtime / device ARN.
 *  3. Preflight violations are surfaced via ConstraintBadge.
 *  4. "Submit to Aquila" is disabled until a payload is built.
 *  5. The graceful submit response (submitted=false + message) is rendered.
 *  6. Build errors propagate as an error message and don't crash the panel.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BraketPanel } from "./BraketPanel";
import type { BraketPayloadResponse, BraketSubmitResponse, NodePos, ScheduleDTO } from "../api/rest";

const positions: NodePos[] = [
  { id: 0, x: 10.0, y: 10.0 },
  { id: 1, x: 15.0, y: 10.0 },
];

const schedule: ScheduleDTO = {
  omega: { times: [0.0, 0.4, 3.6, 4.0], values: [0.0, 15.0, 15.0, 0.0] },
  delta: { times: [0.0, 0.4, 3.6, 4.0], values: [-30.0, -30.0, 40.0, 40.0] },
  phi: { times: [0.0, 4.0], values: [0.0, 0.0] },
  duration: 4.0,
};

const cleanPayloadResponse: BraketPayloadResponse = {
  payload: {
    setup: { ahs_register: { sites: [[1e-5, 1e-5]], filling: [1, 1] } },
    hamiltonian: { drivingFields: [{}], shiftingFields: [] },
    shots: 100,
  },
  cost_estimate: {
    shot_fee_usd: 1.0,
    task_fee_usd: 0.3,
    total_usd: 1.3,
    shots: 100,
  },
  runtime_estimate_seconds: 40,
  device_arn: "arn:aws:braket:us-east-1::device/qpu/quera/Aquila",
  preflight_violations: [],
};

const responseWithViolation: BraketPayloadResponse = {
  ...cleanPayloadResponse,
  preflight_violations: [
    {
      code: "site_too_close",
      message: "Atoms 0 and 1 are 2.000µm apart; minimum is 4.000µm",
      locus: { atom_idx: 0, other_idx: 1, distance_um: 2.0 },
      measured: 2.0,
      limit: 4.0,
    },
  ],
};

const sdkMissingSubmit: BraketSubmitResponse = {
  submitted: false,
  message: "amazon-braket-sdk is not installed. `pip install amazon-braket-sdk boto3`",
};

const fetchMock = vi.fn();

function jsonResp<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BraketPanel", () => {
  it("renders the title and submit button (disabled before build)", () => {
    render(<BraketPanel positions={positions} schedule={schedule} />);
    expect(screen.getByText(/Run on Aquila/)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /Submit to Aquila/ });
    expect(submit).toBeDisabled();
  });

  it("builds a payload and renders cost + runtime + device ARN", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp(cleanPayloadResponse));
    render(<BraketPanel positions={positions} schedule={schedule} defaultShots={100} />);

    fireEvent.click(screen.getByRole("button", { name: /Build payload/ }));

    await waitFor(() => {
      expect(screen.getByText("$1.30")).toBeInTheDocument();
    });
    expect(screen.getByText("$0.30")).toBeInTheDocument(); // task fee
    expect(screen.getByText("$1.00")).toBeInTheDocument(); // shot fee total
    expect(screen.getByText(/~40 s/)).toBeInTheDocument();
    // device ARN line uses the full string verbatim
    expect(screen.getByText(/arn:aws:braket.*Aquila/)).toBeInTheDocument();
    // The payload JSON is rendered in a <pre> with test id
    expect(screen.getByTestId("braket-payload")).toBeInTheDocument();

    // Submit becomes enabled once we have a payload
    expect(screen.getByRole("button", { name: /Submit to Aquila/ })).not.toBeDisabled();
  });

  it("sends the configured shots count in the POST body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp(cleanPayloadResponse));
    render(<BraketPanel positions={positions} schedule={schedule} defaultShots={250} />);

    fireEvent.click(screen.getByRole("button", { name: /Build payload/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.shots).toBe(250);
    expect(body.positions).toEqual(positions);
  });

  it("renders preflight violations via ConstraintBadge", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp(responseWithViolation));
    render(<BraketPanel positions={positions} schedule={schedule} />);

    fireEvent.click(screen.getByRole("button", { name: /Build payload/ }));

    await waitFor(() => {
      // ConstraintBadge maps site_too_close to a Hebrew label
      expect(screen.getByText("מרחק בין אטומים קטן מהמינימום")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("submit flow renders the not-submitted warning when SDK is missing", async () => {
    // First call: build payload. Second call: submit.
    fetchMock
      .mockResolvedValueOnce(jsonResp(cleanPayloadResponse))
      .mockResolvedValueOnce(jsonResp(sdkMissingSubmit));

    render(<BraketPanel positions={positions} schedule={schedule} />);

    fireEvent.click(screen.getByRole("button", { name: /Build payload/ }));
    await waitFor(() => expect(screen.getByTestId("braket-payload")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Submit to Aquila/ }));

    await waitFor(() => {
      expect(screen.getByText(/not submitted/)).toBeInTheDocument();
    });
    expect(screen.getByText(/amazon-braket-sdk is not installed/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();

    // /api/braket/submit was the second call and carries the region.
    const [, init2] = fetchMock.mock.calls[1];
    const body = JSON.parse((init2 as RequestInit).body as string);
    expect(body.region).toBe("us-east-1");
    expect(body.shots).toBeGreaterThan(0);
  });

  it("renders an error message when build fails (and stays mounted)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 422, statusText: "Unprocessable Entity" }));
    render(<BraketPanel positions={positions} schedule={schedule} />);

    fireEvent.click(screen.getByRole("button", { name: /Build payload/ }));

    await waitFor(() => {
      expect(screen.getByText(/422/)).toBeInTheDocument();
    });
    // Submit remains disabled — we never got a payload back.
    expect(screen.getByRole("button", { name: /Submit to Aquila/ })).toBeDisabled();
  });

  it("region input value is forwarded to /api/braket/submit", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResp(cleanPayloadResponse))
      .mockResolvedValueOnce(jsonResp(sdkMissingSubmit));

    render(<BraketPanel positions={positions} schedule={schedule} />);
    fireEvent.click(screen.getByRole("button", { name: /Build payload/ }));
    await waitFor(() => expect(screen.getByTestId("braket-payload")).toBeInTheDocument());

    const regionInput = screen.getByDisplayValue("us-east-1") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(regionInput, { target: { value: "eu-west-1" } });
    });

    fireEvent.click(screen.getByRole("button", { name: /Submit to Aquila/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [, init2] = fetchMock.mock.calls[1];
    const body = JSON.parse((init2 as RequestInit).body as string);
    expect(body.region).toBe("eu-west-1");
  });
});
