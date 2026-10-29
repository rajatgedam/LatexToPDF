import { describe, expect, it, vi } from "vitest";
import { ApiError, compilePdf, fetchHealth } from "./api";

const pdfResponse = (pages = "2", ms = "123") =>
  new Response(new Blob(["%PDF-1.5"]), { status: 200, headers: { "content-type": "application/pdf", "x-latex2pdf-pages": pages, "x-latex2pdf-duration-ms": ms } });
const errorResponse = (status: number, error: object) => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });

describe("compilePdf", () => {
  it("posts JSON and returns blob, pages and duration", async () => {
    const fetchMock = vi.fn(async () => pdfResponse());
    vi.stubGlobal("fetch", fetchMock);
    const r = await compilePdf("hello");
    expect(r.pages).toBe(2);
    expect(r.durationMs).toBe(123);
    expect(r.blob).toBeInstanceOf(Blob);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/compile");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ source: "hello" });
  });

  it("falls back to sane numbers when headers are missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["%PDF-"]), { status: 200 })));
    const r = await compilePdf("x");
    expect(r.pages).toBe(0);
    expect(r.durationMs).toBe(0);
  });

  it("turns API errors into ApiError with code, message and log", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(422, { code: "COMPILE_FAILED", message: "Compilation failed", log: "! Undefined control sequence." })));
    await expect(compilePdf("x")).rejects.toMatchObject({ name: "ApiError", code: "COMPILE_FAILED", status: 422, log: "! Undefined control sequence." });
  });

  it("handles non-JSON error bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>nope</html>", { status: 502 })));
    await expect(compilePdf("x")).rejects.toMatchObject({ code: "HTTP_502" });
  });

  it("maps network failures to a friendly NETWORK error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await compilePdf("x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("NETWORK");
  });

  it("rethrows aborts untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(compilePdf("x")).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("fetchHealth", () => {
  it("returns engine info", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, engine: { found: true, version: "Tectonic 0.17.0" } }), { status: 200 })));
    expect(await fetchHealth()).toEqual({ found: true, version: "Tectonic 0.17.0" });
  });

  it("reports not found when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    expect(await fetchHealth()).toEqual({ found: false, unreachable: true });
  });
});
