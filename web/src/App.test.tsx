import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const pdf = (pages = "1", ms = "420") =>
  new Response(new Blob(["%PDF-1.5"]), { status: 200, headers: { "content-type": "application/pdf", "x-latex2pdf-pages": pages, "x-latex2pdf-duration-ms": ms } });
const apiError = (status: number, error: object) => new Response(JSON.stringify({ error }), { status });
const health = () => new Response(JSON.stringify({ ok: true, engine: { found: true, version: "Tectonic 0.17.0" } }), { status: 200 });

function mockApi(onCompile: Handler = () => pdf(), onHealth: Handler = health) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => (String(url).startsWith("/api/health") ? onHealth(url, init) : onCompile(url, init)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const compileCalls = (m: ReturnType<typeof mockApi>) => m.mock.calls.filter(([u]) => u === "/api/compile");
const editor = () => screen.getByLabelText("LaTeX source") as HTMLTextAreaElement;
const setSource = (v: string) => fireEvent.change(editor(), { target: { value: v } });

beforeEach(() => {
  vi.mocked(URL.revokeObjectURL).mockClear();
});

describe("layout and accessibility", () => {
  it("has landmarks, a single h1, an editor on the left and a preview on the right", async () => {
    mockApi();
    render(<App />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /editor/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /preview/i })).toBeInTheDocument();
    expect(await screen.findByText(/Tectonic 0\.17\.0/)).toBeInTheDocument();
  });

  it("starts idle: compile and download are disabled", () => {
    mockApi();
    render(<App />);
    expect(screen.getByRole("button", { name: /compile/i })).toBeDisabled();
    expect(screen.getByText("Download PDF").closest("a")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/ready/i);
  });

  it("warns when the engine is missing", async () => {
    mockApi(() => pdf(), () => new Response(JSON.stringify({ ok: true, engine: { found: false } }), { status: 200 }));
    render(<App />);
    expect(await screen.findByText(/npm run install:engine/)).toBeInTheDocument();
  });

  it("warns when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    render(<App />);
    expect(await screen.findByText(/server isn't reachable/i)).toBeInTheDocument();
  });
});

describe("compiling", () => {
  it("compiles on click, shows the preview and an enabled download", async () => {
    const m = mockApi();
    render(<App />);
    setSource("\\documentclass{article}");
    await userEvent.click(screen.getByRole("button", { name: /compile/i }));
    expect(await screen.findByTitle("PDF preview")).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    expect(screen.getByRole("status")).toHaveTextContent(/ta-da/i);
    expect(screen.getByRole("status")).toHaveTextContent(/1 page/);
    const dl = screen.getByText("Download PDF").closest("a")!;
    expect(dl).toHaveAttribute("href", expect.stringMatching(/^blob:/));
    expect(dl).toHaveAttribute("download", "resume.pdf");
    expect(dl).not.toHaveAttribute("aria-disabled", "true");
    const body = JSON.parse(compileCalls(m)[0][1]!.body as string);
    expect(body).toEqual({ source: "\\documentclass{article}" });
  });

  it("celebrates success with confetti", async () => {
    mockApi();
    render(<App />);
    setSource("x");
    await userEvent.click(screen.getByRole("button", { name: /compile/i }));
    expect(await screen.findByTestId("confetti")).toBeInTheDocument();
  });

  it("shows a friendly error with the log when LaTeX fails", async () => {
    mockApi(() => apiError(422, { code: "COMPILE_FAILED", message: "Compilation failed: ! Undefined control sequence.", log: "l.5 \\nope" }));
    render(<App />);
    setSource("\\nope");
    await userEvent.click(screen.getByRole("button", { name: /compile/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Undefined control sequence/);
    expect(within(alert).getByText(/l\.5/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/grumpy/i);
    expect(screen.queryByTitle("PDF preview")).not.toBeInTheDocument();
  });

  it("explains network failures", async () => {
    mockApi(() => { throw new TypeError("Failed to fetch"); });
    render(<App />);
    setSource("x");
    await userEvent.click(screen.getByRole("button", { name: /compile/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't reach/i);
  });

  it("a newer compile aborts the previous request and revokes the old preview URL", async () => {
    const signals: AbortSignal[] = [];
    let call = 0;
    mockApi((_u, init) => {
      signals.push(init!.signal as AbortSignal);
      call += 1;
      return call === 1 ? new Promise<Response>(() => {}) : pdf();
    });
    render(<App />);
    setSource("one");
    await userEvent.click(screen.getByRole("button", { name: /compile/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/hold my coffee/i);
    setSource("two");
    await userEvent.click(screen.getByRole("button", { name: /compile/i }));
    await screen.findByTitle("PDF preview");
    expect(signals[0].aborted).toBe(true);
    setSource("three");
    await userEvent.click(screen.getByRole("button", { name: /compile/i }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
  });

  it("Cmd/Ctrl+Enter compiles from the editor", async () => {
    const m = mockApi();
    render(<App />);
    setSource("x");
    fireEvent.keyDown(editor(), { key: "Enter", ctrlKey: true });
    await screen.findByTitle("PDF preview");
    fireEvent.keyDown(editor(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(compileCalls(m)).toHaveLength(2));
  });

  it("Tab inserts two spaces instead of moving focus", async () => {
    mockApi();
    render(<App />);
    setSource("ab");
    editor().setSelectionRange(1, 1);
    fireEvent.keyDown(editor(), { key: "Tab" });
    expect(editor().value).toBe("a  b");
  });

  it("blocks compiling over the size limit and says so", () => {
    mockApi();
    render(<App />);
    setSource("x".repeat(1_048_577));
    expect(screen.getByRole("button", { name: /compile/i })).toBeDisabled();
    expect(screen.getByText(/over the 1 MiB limit/i)).toBeInTheDocument();
  });
});

describe("auto-compile", () => {
  it("debounces typing and compiles once after the pause", async () => {
    vi.useFakeTimers();
    const m = mockApi();
    render(<App />);
    fireEvent.click(screen.getByLabelText(/auto-compile/i));
    setSource("a");
    setSource("ab");
    setSource("abc");
    expect(compileCalls(m)).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(compileCalls(m)).toHaveLength(1);
    expect(JSON.parse(compileCalls(m)[0][1]!.body as string).source).toBe("abc");
  });

  it("does nothing while auto-compile is off", async () => {
    vi.useFakeTimers();
    const m = mockApi();
    render(<App />);
    setSource("abc");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(compileCalls(m)).toHaveLength(0);
  });
});

describe("editor helpers and files", () => {
  it("loads the sample and clears it again", async () => {
    mockApi();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /load sample/i }));
    expect(editor().value).toContain("\\documentclass");
    expect(screen.getByRole("button", { name: /compile/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(editor().value).toBe("");
  });

  it("opens a dropped .tex file, shows the drop overlay while dragging, and names the PDF after it", async () => {
    mockApi();
    render(<App />);
    const zone = screen.getByTestId("dropzone");
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText(/drop it like it's hot/i)).toBeInTheDocument();
    const f = new File(["\\documentclass{article} Hello"], "my cv.tex");
    fireEvent.drop(zone, { dataTransfer: { files: [f], types: ["Files"] } });
    await waitFor(() => expect(editor().value).toContain("Hello"));
    expect(screen.queryByText(/drop it like it's hot/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /compile/i }));
    await screen.findByTitle("PDF preview");
    expect(screen.getByText("Download PDF").closest("a")).toHaveAttribute("download", "my cv.pdf");
  });

  it("opens a file picked with the Open file button", async () => {
    mockApi();
    render(<App />);
    const input = screen.getByLabelText(/open a \.tex or \.txt file/i) as HTMLInputElement;
    await userEvent.upload(input, new File(["picked text"], "notes.txt"));
    await waitFor(() => expect(editor().value).toBe("picked text"));
  });

  it("rejects unsupported and oversized files without touching the editor", async () => {
    mockApi();
    render(<App />);
    setSource("keep me");
    const zone = screen.getByTestId("dropzone");
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "pic.png")], types: ["Files"] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/\.tex|\.txt/);
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x".repeat(1_048_577)], "big.tex")], types: ["Files"] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/1 MiB/));
    expect(editor().value).toBe("keep me");
  });

  it("ignores drags that carry no files (e.g. selected text)", () => {
    mockApi();
    render(<App />);
    fireEvent.dragEnter(screen.getByTestId("dropzone"), { dataTransfer: { types: ["text/plain"] } });
    expect(screen.queryByText(/drop it like it's hot/i)).not.toBeInTheDocument();
  });

  it("shows a character counter", () => {
    mockApi();
    render(<App />);
    setSource("hello");
    expect(screen.getByText(/5 chars/)).toBeInTheDocument();
  });
});
