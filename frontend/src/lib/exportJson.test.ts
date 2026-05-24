/**
 * exportJson tests — verify the download path:
 *   - JSON is correctly serialized
 *   - filename gets a timestamp
 *   - anchor element is created and clicked exactly once
 *   - object URL is revoked (no leak)
 *   - works with null/empty data without crashing JSON.stringify
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJSON } from "./exportJson";

describe("exportJSON", () => {
  let createSpy: ReturnType<typeof vi.spyOn>;
  let revokeSpy: ReturnType<typeof vi.spyOn>;
  let clickedHrefs: string[] = [];
  let clickedNames: string[] = [];

  beforeEach(() => {
    clickedHrefs = [];
    clickedNames = [];

    // jsdom's URL.createObjectURL / revokeObjectURL exist as stubs; spy on them
    createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob://fake");
    revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    // Replace click() with a probe so we can inspect the anchor without
    // actually triggering a download in jsdom.
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clickedHrefs.push(this.href);
      clickedNames.push(this.download);
    };
    // restore via afterEach
    (HTMLAnchorElement.prototype as unknown as { __orig: unknown }).__orig =
      origClick;
  });

  afterEach(() => {
    createSpy.mockRestore();
    revokeSpy.mockRestore();
    HTMLAnchorElement.prototype.click = (
      HTMLAnchorElement.prototype as unknown as { __orig: () => void }
    ).__orig;
  });

  it("creates an anchor with the correct download name (with timestamp)", () => {
    exportJSON("manet", { hello: "world" });
    expect(clickedNames).toHaveLength(1);
    expect(clickedNames[0]).toMatch(/^manet-\d{8}-\d{6}\.json$/);
  });

  it("creates an anchor pointing at the blob URL", () => {
    exportJSON("schedule", { duration: 4 });
    expect(clickedHrefs[0]).toBe("blob://fake");
  });

  it("revokes the object URL after triggering the download", () => {
    exportJSON("postprocess", { x: 1 });
    expect(revokeSpy).toHaveBeenCalledWith("blob://fake");
  });

  it("preserves a .json suffix and inserts the stamp before it", () => {
    exportJSON("evolution.json", { frames: [] });
    expect(clickedNames[0]).toMatch(/^evolution-\d{8}-\d{6}\.json$/);
  });

  it("handles null data without crashing", () => {
    expect(() => exportJSON("x", null)).not.toThrow();
  });

  it("serializes nested structures", () => {
    // Spy on Blob constructor via a wrapper.
    const captured: { parts: BlobPart[]; opts: BlobPropertyBag | undefined }[] = [];
    const RealBlob = window.Blob;
    class SpyBlob extends RealBlob {
      constructor(parts?: BlobPart[], opts?: BlobPropertyBag) {
        super(parts, opts);
        captured.push({ parts: parts ?? [], opts });
      }
    }
    window.Blob = SpyBlob as unknown as typeof Blob;
    try {
      exportJSON("x", { a: [1, 2, { b: "deep" }] });
      expect(captured.length).toBeGreaterThan(0);
      expect(captured[0].opts?.type).toBe("application/json");
      const parsed = JSON.parse(captured[0].parts[0] as string);
      expect(parsed.a[2].b).toBe("deep");
    } finally {
      window.Blob = RealBlob;
    }
  });
});
