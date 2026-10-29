import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workbench } from "./Workbench";
import { binaryTool, docxTool, missingEngine, textTool } from "../test/fixtures";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const out = (meta = '{"pages":1}', ms = "420", type = "application/pdf") =>
  new Response("%PDF-1.5", { status: 200, headers: { "content-type": type, "x-toolmaster-meta": meta, "x-toolmaster-duration-ms": ms } });
const html = () => new Response("<p>preview</p>", { status: 200, headers: { "content-type": "text/html" } });
const apiError = (status: number, error: object) => new Response(JSON.stringify({ error }), { status });

function mockApi(onRun: Handler = () => out(), onPreview: Handler = () => html()) {
  const m = vi.fn(async (url: string, init?: RequestInit) => (String(url).includes("/preview") ? onPreview(url, init) : onRun(url, init)));
  vi.stubGlobal("fetch", m);
  return m;
}
const runCalls = (m: ReturnType<typeof mockApi>) => m.mock.calls.filter(([u]) => String(u).includes("/run"));
const body = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const editor = () => screen.getByLabelText("Input text") as HTMLTextAreaElement;
const setSource = (v: string) => fireEvent.change(editor(), { target: { value: v } });
const actionButton = (name = /compile/i) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.mocked(URL.revokeObjectURL).mockClear();
});

describe("layout and accessibility", () => {
  it("shows the tool, a way back, an editor on the left and a result pane on the right", () => {
    mockApi();
    render(<Workbench tool={textTool()} />);
    expect(screen.getByRole("heading", { level: 2, name: /Text Tool/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /all tools/i })).toHaveAttribute("href", "#/");
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /editor/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /result/i })).toBeInTheDocument();
    expect(screen.getByText("Engine: E 1.0")).toBeInTheDocument();
  });

  it("starts idle: the action and the download are disabled", () => {
    mockApi();
    render(<Workbench tool={textTool()} />);
    expect(actionButton()).toBeDisabled();
    expect(screen.getByText("Download PDF").closest("a")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/ready/i);
  });

  it("says how to fix a missing engine, and has a sensible line for engine-less tools", () => {
    mockApi();
    const { unmount } = render(<Workbench tool={missingEngine(textTool())} />);
    expect(screen.getByText(/toolmaster install text-tool/)).toBeInTheDocument();
    unmount();
    render(<Workbench tool={textTool({ status: { ready: true, engines: [] } })} />);
    expect(screen.getByText(/runs entirely in toolmaster/i)).toBeInTheDocument();
  });
});

describe("running a text tool", () => {
  it("runs on click, previews the result, and enables the download", async () => {
    const m = mockApi(() => out('{"pages":2}'));
    render(<Workbench tool={textTool()} />);
    setSource("\\documentclass{article}");
    await userEvent.click(actionButton());
    expect(await screen.findByTitle("Result preview")).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    expect(screen.getByTitle("Result preview")).not.toHaveAttribute("sandbox");
    expect(screen.getByRole("status")).toHaveTextContent(/ta-da/i);
    expect(screen.getByRole("status")).toHaveTextContent(/2 pages/);
    const dl = screen.getByText("Download PDF").closest("a")!;
    expect(dl).toHaveAttribute("href", expect.stringMatching(/^blob:/));
    expect(dl).toHaveAttribute("download", "result.pdf");
    expect(dl).not.toHaveAttribute("aria-disabled", "true");
    expect(body(runCalls(m)[0])).toEqual({ input: "\\documentclass{article}", options: { mode: "auto" } });
    expect(screen.getByTestId("confetti")).toBeInTheDocument();
  });

  it("sends the chosen options", async () => {
    const m = mockApi();
    render(<Workbench tool={docxTool()} />);
    setSource("x");
    await userEvent.selectOptions(screen.getByLabelText("Input type"), "latex");
    await userEvent.click(screen.getByLabelText("Add a table of contents"));
    await userEvent.click(actionButton(/convert/i));
    await screen.findByTitle("Result preview");
    expect(body(runCalls(m)[0]).options).toEqual({ mode: "latex", toc: true });
  });

  it("tools with an html preview show it in a script-less sandboxed frame", async () => {
    const m = mockApi(() => out("{}", "100", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    render(<Workbench tool={docxTool()} />);
    setSource("x");
    await userEvent.click(actionButton(/convert/i));
    const frame = await screen.findByTitle("Result preview");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(m.mock.calls.some(([u]) => String(u).endsWith("/preview"))).toBe(true);
    expect(screen.getByText("Download DOCX").closest("a")).toHaveAttribute("href", expect.stringMatching(/^blob:/));
    expect(screen.getByRole("status")).toHaveTextContent(/ta-da/i);
  });

  it("falls back to a ready card when the preview itself fails", async () => {
    mockApi(() => out("{}"), () => apiError(500, { code: "INTERNAL", message: "x" }));
    render(<Workbench tool={docxTool()} />);
    setSource("x");
    await userEvent.click(actionButton(/convert/i));
    expect(await screen.findByText(/your docx file is ready/i)).toBeInTheDocument();
    expect(screen.queryByTitle("Result preview")).not.toBeInTheDocument();
  });

  it("tools without a preview show a ready card with the file name and size", async () => {
    mockApi(() => out("{}"));
    render(<Workbench tool={textTool({ preview: "none" })} />);
    setSource("x");
    await userEvent.click(actionButton());
    expect(await screen.findByText(/your pdf file is ready/i)).toBeInTheDocument();
    expect(screen.getByText(/result\.pdf · 8 B/)).toBeInTheDocument();
  });

  it("shows a friendly error with the log when the tool fails", async () => {
    mockApi(() => apiError(422, { code: "TOOL_FAILED", message: "Tool failed: ! Undefined control sequence.", log: "l.5 \\nope" }));
    render(<Workbench tool={textTool()} />);
    setSource("\\nope");
    await userEvent.click(actionButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Undefined control sequence/);
    expect(within(alert).getByText(/l\.5/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/didn't work/i);
    expect(screen.queryByTitle("Result preview")).not.toBeInTheDocument();
  });

  it("explains network failures", async () => {
    mockApi(() => { throw new TypeError("Failed to fetch"); });
    render(<Workbench tool={textTool()} />);
    setSource("x");
    await userEvent.click(actionButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't reach/i);
  });

  it("a newer run aborts the previous request and revokes the old result URL", async () => {
    const signals: AbortSignal[] = [];
    let call = 0;
    mockApi((_u, init) => {
      signals.push(init!.signal as AbortSignal);
      call += 1;
      return call === 1 ? new Promise<Response>(() => {}) : out();
    });
    render(<Workbench tool={textTool()} />);
    setSource("one");
    await userEvent.click(actionButton());
    expect(screen.getByRole("status")).toHaveTextContent(/hold my coffee/i);
    setSource("two");
    await userEvent.click(actionButton());
    await screen.findByTitle("Result preview");
    expect(signals[0].aborted).toBe(true);
    setSource("three");
    await userEvent.click(actionButton());
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
  });

  it("Cmd/Ctrl+Enter runs from the editor", async () => {
    const m = mockApi();
    render(<Workbench tool={textTool()} />);
    setSource("x");
    fireEvent.keyDown(editor(), { key: "Enter", ctrlKey: true });
    await screen.findByTitle("Result preview");
    fireEvent.keyDown(editor(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(runCalls(m)).toHaveLength(2));
  });

  it("Tab inserts two spaces; Escape then Tab leaves the editor alone", () => {
    mockApi();
    render(<Workbench tool={textTool()} />);
    setSource("ab");
    editor().setSelectionRange(1, 1);
    fireEvent.keyDown(editor(), { key: "Tab" });
    expect(editor().value).toBe("a  b");
    fireEvent.keyDown(editor(), { key: "Escape" });
    fireEvent.keyDown(editor(), { key: "Tab" });
    expect(editor().value).toBe("a  b");
  });

  it("blocks running over the size limit and says so", () => {
    mockApi();
    render(<Workbench tool={textTool()} />);
    setSource("x".repeat(1_048_577));
    expect(actionButton()).toBeDisabled();
    expect(screen.getByText(/over the 1 MiB limit/i)).toBeInTheDocument();
  });

  it("shows a character counter", () => {
    mockApi();
    render(<Workbench tool={textTool()} />);
    setSource("hello");
    expect(screen.getByText(/5 chars/)).toBeInTheDocument();
  });
});

describe("auto-run", () => {
  it("debounces typing and runs once after the pause", async () => {
    vi.useFakeTimers();
    const m = mockApi();
    render(<Workbench tool={textTool()} />);
    fireEvent.click(screen.getByLabelText(/auto-run/i));
    setSource("a");
    setSource("ab");
    setSource("abc");
    expect(runCalls(m)).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(runCalls(m)).toHaveLength(1);
    expect(body(runCalls(m)[0]).input).toBe("abc");
  });

  it("does nothing while it is off", async () => {
    vi.useFakeTimers();
    const m = mockApi();
    render(<Workbench tool={textTool()} />);
    setSource("abc");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(runCalls(m)).toHaveLength(0);
  });
});

describe("editor helpers and files", () => {
  it("loads the tool's sample and clears it again", async () => {
    mockApi();
    render(<Workbench tool={textTool()} />);
    await userEvent.click(screen.getByRole("button", { name: /load sample/i }));
    expect(editor().value).toContain("sample");
    expect(actionButton()).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(editor().value).toBe("");
  });

  it("has no Load sample button when the tool has none", () => {
    mockApi();
    render(<Workbench tool={textTool({ sample: undefined })} />);
    expect(screen.queryByRole("button", { name: /load sample/i })).not.toBeInTheDocument();
  });

  it("opens a dropped file, shows the overlay while dragging, and names the download after it", async () => {
    mockApi();
    render(<Workbench tool={textTool()} />);
    const zone = screen.getByTestId("dropzone");
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText(/drop it like it's hot/i)).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["\\documentclass{article} Hello"], "my cv.tex")], types: ["Files"] } });
    await waitFor(() => expect(editor().value).toContain("Hello"));
    expect(screen.queryByText(/drop it like it's hot/i)).not.toBeInTheDocument();
    await userEvent.click(actionButton());
    await screen.findByTitle("Result preview");
    expect(screen.getByText("Download PDF").closest("a")).toHaveAttribute("download", "my cv.pdf");
  });

  it("opens a file picked with the Open file button", async () => {
    mockApi();
    render(<Workbench tool={textTool()} />);
    await userEvent.upload(screen.getByLabelText(/open a \.tex or \.txt file/i), new File(["picked text"], "notes.txt"));
    await waitFor(() => expect(editor().value).toBe("picked text"));
  });

  it("rejects unsupported and oversized files without touching the editor", async () => {
    mockApi();
    render(<Workbench tool={textTool()} />);
    setSource("keep me");
    const zone = screen.getByTestId("dropzone");
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "pic.png")], types: ["Files"] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/\.tex, \.txt/);
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x".repeat(1_048_577)], "big.tex")], types: ["Files"] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/1 MiB/));
    expect(editor().value).toBe("keep me");
  });

  it("ignores drags that carry no files", () => {
    mockApi();
    render(<Workbench tool={textTool()} />);
    fireEvent.dragEnter(screen.getByTestId("dropzone"), { dataTransfer: { types: ["text/plain"] } });
    expect(screen.queryByText(/drop it like it's hot/i)).not.toBeInTheDocument();
  });
});

describe("a binary tool", () => {
  it("takes a dropped file, posts it raw, and offers the download", async () => {
    const m = mockApi(() => out("{}", "50", "image/png"));
    render(<Workbench tool={binaryTool({ preview: "none" })} />);
    expect(actionButton(/shrink/i)).toBeDisabled();
    expect(screen.queryByLabelText("Input text")).not.toBeInTheDocument();
    const zone = screen.getByTestId("dropzone");
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["abc"], "photo.png")], types: ["Files"] } });
    expect(await screen.findByText(/photo\.png/)).toBeInTheDocument();
    await userEvent.click(actionButton(/shrink/i));
    expect(await screen.findByText(/your png file is ready/i)).toBeInTheDocument();
    const [url, init] = runCalls(m)[0] as [string, RequestInit];
    expect(url).toBe("/api/tools/binary-tool/run");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/octet-stream");
    expect((init.body as File).name).toBe("photo.png");
    expect(screen.getByText("Download PNG").closest("a")).toHaveAttribute("download", "photo.png");
  });

  it("rejects wrong file types and can be cleared", async () => {
    mockApi();
    render(<Workbench tool={binaryTool()} />);
    const zone = screen.getByTestId("dropzone");
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "doc.txt")], types: ["Files"] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/\.png, \.jpg/);
    await userEvent.upload(screen.getByLabelText(/open a \.png or \.jpg file/i), new File(["x"], "ok.jpg"));
    expect(await screen.findByText(/ok\.jpg/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByText(/drop a \.png \/ \.jpg file here/i)).toBeInTheDocument();
    expect(actionButton(/shrink/i)).toBeDisabled();
  });
});
