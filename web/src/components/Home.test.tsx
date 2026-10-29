import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Home, matches } from "./Home";
import { binaryTool, docxTool, missingEngine, textTool } from "../test/fixtures";

const tools = () => [docxTool(), textTool(), binaryTool()];

describe("Home menu", () => {
  it("groups tools by category with a card per tool linking to its page", () => {
    render(<Home tools={tools()} onOpen={() => {}} />);
    expect(screen.getByRole("heading", { level: 3, name: "Documents" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Images" })).toBeInTheDocument();
    const docs = within(screen.getByRole("region", { name: "Documents" }));
    expect(docs.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Text Tool/ })).toHaveAttribute("href", "#/tool/text-tool");
    expect(screen.getByRole("link", { name: /Binary Tool/ })).toHaveAttribute("href", "#/tool/binary-tool");
  });

  it("shows what goes in and out, and whether the tool is ready", () => {
    render(<Home tools={[textTool(), missingEngine(docxTool())]} onOpen={() => {}} />);
    expect(screen.getByText(".tex → .pdf")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Needs setup")).toBeInTheDocument();
    expect(screen.getByText("Run: toolmaster install docx-tool")).toBeInTheDocument();
  });

  it("searches names, descriptions, tags and categories, and explains an empty result", async () => {
    render(<Home tools={tools()} onOpen={() => {}} />);
    const box = screen.getByLabelText("Search tools");
    await userEvent.type(box, "word");
    expect(screen.getByRole("link", { name: /Docx Tool/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Text Tool/ })).not.toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, "images");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    await userEvent.clear(box);
    await userEvent.type(box, "zzzz");
    expect(screen.getByText(/nothing matches "zzzz"/i)).toBeInTheDocument();
    await userEvent.clear(box);
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("says so when no tools are installed", () => {
    render(<Home tools={[]} onOpen={() => {}} />);
    expect(screen.getByText(/no tools are installed/i)).toBeInTheDocument();
  });

  it("number keys open the Nth visible tool; / focuses the search box", () => {
    const onOpen = vi.fn();
    render(<Home tools={tools()} onOpen={onOpen} />);
    fireEvent.keyDown(window, { key: "2" });
    expect(onOpen).toHaveBeenCalledWith("text-tool");
    fireEvent.keyDown(window, { key: "1" });
    expect(onOpen).toHaveBeenLastCalledWith("docx-tool");
    fireEvent.keyDown(window, { key: "9" });
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "/" });
    expect(screen.getByLabelText("Search tools")).toHaveFocus();
  });

  it("shortcuts are ignored while typing and with modifier keys", async () => {
    const onOpen = vi.fn();
    render(<Home tools={tools()} onOpen={onOpen} />);
    await userEvent.type(screen.getByLabelText("Search tools"), "1");
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "1", metaKey: true });
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("the shortcut numbers follow the filtered list", async () => {
    const onOpen = vi.fn();
    render(<Home tools={tools()} onOpen={onOpen} />);
    const box = screen.getByLabelText("Search tools");
    await userEvent.type(box, "image");
    box.blur();
    fireEvent.keyDown(window, { key: "1" });
    expect(onOpen).toHaveBeenCalledWith("binary-tool");
  });
});

describe("matches", () => {
  it("is case-insensitive and an empty query matches everything", () => {
    expect(matches(textTool(), "")).toBe(true);
    expect(matches(textTool(), "  ")).toBe(true);
    expect(matches(textTool(), "TEXT")).toBe(true);
    expect(matches(textTool(), "pdf")).toBe(true);
    expect(matches(textTool(), "spreadsheet")).toBe(false);
  });
});
