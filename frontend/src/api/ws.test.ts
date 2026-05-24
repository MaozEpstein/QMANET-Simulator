/**
 * WebSocket client tests.
 *
 * We stub the global WebSocket so we can drive onopen/onmessage/onerror
 * synchronously from the test, asserting the callback contract without
 * standing up a real server.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamSimulation } from "./ws";
import type { SimulateRequest } from "./rest";

interface StubWS {
  url: string;
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
}

let lastSocket: StubWS | null = null;

beforeEach(() => {
  lastSocket = null;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {
    static OPEN = 1;
    static CLOSED = 3;
    url: string;
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onopen?: () => void;
    onmessage?: (e: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;

    constructor(url: string) {
      this.url = url;
      this.readyState = 0;
      this.send = vi.fn();
      this.close = vi.fn(() => {
        this.readyState = 3;
      });
      lastSocket = this as unknown as StubWS;
    }
  };
  // Stub window.location since jsdom may or may not have it set
  (globalThis as unknown as { window: { location: { protocol: string; host: string } } }).window = {
    location: { protocol: "http:", host: "localhost:5173" },
  };
});

function fakeRequest(): SimulateRequest {
  return {
    positions: [{ id: 0, x: 10, y: 10 }],
    schedule: {
      omega: { times: [0, 1], values: [0, 5] },
      delta: { times: [0, 1], values: [0, 0] },
      phi: { times: [0, 1], values: [0, 0] },
      duration: 1,
    },
    n_frames: 5,
  };
}

describe("streamSimulation", () => {
  it("connects to /ws/simulate and sends the request on open", () => {
    const onOpen = vi.fn();
    streamSimulation(fakeRequest(), { onOpen });
    expect(lastSocket).not.toBeNull();
    expect(lastSocket!.url).toBe("ws://localhost:5173/ws/simulate");

    lastSocket!.onopen?.();
    expect(onOpen).toHaveBeenCalled();
    expect(lastSocket!.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(lastSocket!.send.mock.calls[0][0]);
    expect(sent.n_frames).toBe(5);
  });

  it("dispatches frame messages to onFrame", () => {
    const onFrame = vi.fn();
    streamSimulation(fakeRequest(), { onFrame });
    lastSocket!.onmessage?.({
      data: JSON.stringify({
        type: "frame",
        frame: { t_us: 0.5, rydberg_populations: [0.3], norm: 1 },
      }),
    });
    expect(onFrame).toHaveBeenCalledWith({ t_us: 0.5, rydberg_populations: [0.3], norm: 1 });
  });

  it("dispatches done message to onDone", () => {
    const onDone = vi.fn();
    streamSimulation(fakeRequest(), { onDone });
    lastSocket!.onmessage?.({
      data: JSON.stringify({ type: "done", n_atoms: 1, duration_us: 1.0, final_t_us: 1.0 }),
    });
    // The full message envelope is forwarded; the caller can pluck the fields it wants.
    const arg = onDone.mock.calls[0][0];
    expect(arg.n_atoms).toBe(1);
    expect(arg.duration_us).toBe(1.0);
    expect(arg.final_t_us).toBe(1.0);
  });

  it("dispatches error message to onError", () => {
    const onError = vi.fn();
    streamSimulation(fakeRequest(), { onError });
    lastSocket!.onmessage?.({
      data: JSON.stringify({ type: "error", message: "invalid request" }),
    });
    expect(onError).toHaveBeenCalledWith("invalid request");
  });

  it("emits onError on malformed JSON instead of crashing", () => {
    const onError = vi.fn();
    streamSimulation(fakeRequest(), { onError });
    lastSocket!.onmessage?.({ data: "not json" });
    expect(onError).toHaveBeenCalled();
  });

  it("emits onError on socket error", () => {
    const onError = vi.fn();
    streamSimulation(fakeRequest(), { onError });
    lastSocket!.onerror?.();
    expect(onError).toHaveBeenCalledWith("websocket error");
  });

  it("close() closes the underlying socket", () => {
    const handle = streamSimulation(fakeRequest(), {});
    handle.close();
    expect(lastSocket!.close).toHaveBeenCalled();
  });
});
