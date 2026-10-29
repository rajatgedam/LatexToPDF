import { describe, expect, it, vi } from "vitest";
import { ApiError, listTools, previewTool, runTool } from "./api";
import { textTool, binaryTool } from "./test/fixtures";

const okFile = (meta = '{"pages":2}', ms = "123") =>
  new Response(new Blob(["%PDF-1.5"]), { status: 200, headers: { "content-type": "application/pdf", "x-toolmaster-meta": meta, "x-toolmaster-duration-ms": ms } });
const errorResponse = (status: number, error: object) => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
const call = (m: ReturnType<typeof vi.fn>) => m.mock.calls[0] as unknown as [string, RequestInit];

describe("listTools", () => {
  it("returns the catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tools: [textTool()] }), { status: 200 })));
    expect((await listTools()).map((t) => t.id)).toEqual(["text-tool"]);
  });

  it("maps network failures and bad responses to ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    await expect(listTools()).rejects.toMatchObject({ name: "ApiError", code: "NETWORK" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 502 })));
    await expect(listTools()).rejects.toMatchObject({ code: "HTTP_502" });
  });
});

describe("runTool", () => {
  it("posts text tools as JSON with options and returns blob, meta and duration", async () => {
    const m = vi.fn(async () => okFile());
    vi.stubGlobal("fetch", m);
    const r = await runTool(textTool(), "hello", { mode: "latex", toc: true });
    expect(r.meta).toEqual({ pages: 2 });
    expect(r.durationMs).toBe(123);
    expect(r.blob).toBeInstanceOf(Blob);
    const [url, init] = call(m);
    expect(url).toBe("/api/tools/text-tool/run");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ input: "hello", options: { mode: "latex", toc: true } });
  });

  it("posts binary tools as a raw octet-stream with options in the query string", async () => {
    const m = vi.fn(async () => okFile());
    vi.stubGlobal("fetch", m);
    const file = new File(["abc"], "a.bin");
    await runTool(binaryTool(), file, { quality: "high", strip: false });
    const [url, init] = call(m);
    expect(url).toBe("/api/tools/binary-tool/run?quality=high&strip=false");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/octet-stream");
    expect(init.body).toBe(file);
  });

  it("falls back to sane values when headers are missing or malformed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"]), { status: 200, headers: { "x-toolmaster-meta": "{nope" } })));
    const r = await runTool(textTool(), "x", {});
    expect(r.meta).toEqual({});
    expect(r.durationMs).toBe(0);
  });

  it("turns API errors into ApiError with code, message and log", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(422, { code: "TOOL_FAILED", message: "Tool failed", log: "! Undefined control sequence." })));
    await expect(runTool(textTool(), "x", {})).rejects.toMatchObject({ name: "ApiError", code: "TOOL_FAILED", status: 422, log: "! Undefined control sequence." });
  });

  it("handles non-JSON error bodies, network failures and aborts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>nope</html>", { status: 502 })));
    await expect(runTool(textTool(), "x", {})).rejects.toMatchObject({ code: "HTTP_502" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await runTool(textTool(), "x", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("NETWORK");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(runTool(textTool(), "x", {})).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("previewTool", () => {
  it("posts to the preview endpoint and returns an html blob", async () => {
    const m = vi.fn(async () => new Response("<p>hi</p>", { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", m);
    const blob = await previewTool(textTool({ preview: "html" }), "x", { toc: false });
    expect(await blob.text()).toBe("<p>hi</p>");
    expect(call(m)[0]).toBe("/api/tools/text-tool/preview");
  });

  it("propagates errors like runTool", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(400, { code: "INPUT_INVALID", message: "bad" })));
    await expect(previewTool(textTool({ preview: "html" }), "x", {})).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});
