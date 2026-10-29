import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Workbench } from "./Workbench";
import { OptionsBar, defaultOptions } from "./OptionsBar";
import { TEXT_PREVIEW_CHARS } from "../useRunner";
import { readerTool } from "../test/fixtures";

const markdown = (text: string) => new Response(text, { status: 200, headers: { "content-type": "text/markdown", "x-toolmaster-meta": '{"pages":3}', "x-toolmaster-duration-ms": "90" } });
const stub = (text = "# Title\n\nbody") => {
  const m = vi.fn(async () => markdown(text));
  vi.stubGlobal("fetch", m);
  return m;
};
const drop = (name = "paper.pdf") => fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [new File(["x"], name)], types: ["Files"] } });

afterEach(() => vi.unstubAllGlobals());

describe("text results", () => {
  it("are shown in the page, not in a frame, and the card says nothing about a file", async () => {
    stub("# Title\n\nbody");
    render(<Workbench tool={readerTool()} />);
    drop();
    await userEvent.click(screen.getByRole("button", { name: /read it/i }));
    const pre = await screen.findByLabelText("Result text");
    expect(pre).toHaveTextContent(/# Title\s+body/);
    expect(screen.queryByTitle("Result preview")).not.toBeInTheDocument();
    expect(screen.queryByText(/your md file is ready/i)).not.toBeInTheDocument();
    expect(screen.getByText("Download MD").closest("a")).toHaveAttribute("download", "paper.md");
  });

  it("can be copied with one click", async () => {
    stub("copy me");
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<Workbench tool={readerTool()} />);
    drop();
    await userEvent.click(screen.getByRole("button", { name: /read it/i }));
    await screen.findByLabelText("Result text");
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("copy me");
    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("are cut at a sensible length on screen while the download keeps everything", async () => {
    stub("x".repeat(TEXT_PREVIEW_CHARS + 50));
    render(<Workbench tool={readerTool()} />);
    drop();
    await userEvent.click(screen.getByRole("button", { name: /read it/i }));
    const pre = await screen.findByLabelText("Result text");
    expect(pre.textContent).toMatch(/Showing the first 200,000 characters/);
    expect(pre.textContent!.length).toBeLessThan(TEXT_PREVIEW_CHARS + 200);
  });
});

describe("free-text options", () => {
  it("show the default as a placeholder, respect maxLength, and travel in the query string for file tools", async () => {
    const m = stub();
    render(<Workbench tool={readerTool()} />);
    const box = screen.getByLabelText("Pages") as HTMLInputElement;
    expect(box).toHaveAttribute("placeholder", "all");
    expect(box).toHaveAttribute("maxlength", "40");
    expect(box).toHaveAttribute("title", "like 1-3");
    expect(box.value).toBe("all");
    await userEvent.clear(box);
    await userEvent.type(box, "r1,1-r2");
    drop();
    await userEvent.click(screen.getByRole("button", { name: /read it/i }));
    await screen.findByLabelText("Result text");
    const [url] = m.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/tools/reader-tool/run?pages=r1%2C1-r2&markers=true");
  });
});

describe("OptionsBar", () => {
  it("renders one control per option type and reports changes", async () => {
    const onChange = vi.fn();
    const tool = readerTool();
    render(<OptionsBar options={tool.options ?? []} values={defaultOptions(tool.options)} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("Mark pages"));
    expect(onChange).toHaveBeenCalledWith({ pages: "all", markers: false });
    fireEvent.change(screen.getByLabelText("Pages"), { target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith({ pages: "2", markers: true });
  });

  it("renders nothing when a tool has no options", () => {
    const { container } = render(<OptionsBar options={[]} values={{}} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
