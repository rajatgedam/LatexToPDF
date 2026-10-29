import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { parseHash } from "./useHashRoute";
import { docxTool, textTool } from "./test/fixtures";

const catalog = (tools = [docxTool(), textTool()]) => new Response(JSON.stringify({ tools }), { status: 200 });

beforeEach(() => {
  window.location.hash = "";
});

describe("routing", () => {
  it("parses hashes into routes and ignores junk", () => {
    expect(parseHash("")).toEqual({ name: "home" });
    expect(parseHash("#/")).toEqual({ name: "home" });
    expect(parseHash("#/tool/latex-to-pdf")).toEqual({ name: "tool", id: "latex-to-pdf" });
    expect(parseHash("#/tool/latex-to-pdf/")).toEqual({ name: "tool", id: "latex-to-pdf" });
    expect(parseHash("#/tool/../etc")).toEqual({ name: "home" });
    expect(parseHash("#/tool/Bad_Id")).toEqual({ name: "home" });
  });
});

describe("App", () => {
  it("shows the start menu with one h1, then opens a tool and comes back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => catalog()));
    render(<App />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    expect(await screen.findByText("What shall we make today?")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveTextContent("2 tools installed");

    await userEvent.click(screen.getByRole("link", { name: /Text Tool/ }));
    expect(await screen.findByRole("heading", { level: 2, name: /Text Tool/ })).toBeInTheDocument();
    expect(screen.queryByText("What shall we make today?")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: /all tools/i }));
    expect(await screen.findByText("What shall we make today?")).toBeInTheDocument();
  });

  it("deep links straight to a tool", async () => {
    window.location.hash = "#/tool/docx-tool";
    vi.stubGlobal("fetch", vi.fn(async () => catalog()));
    render(<App />);
    expect(await screen.findByRole("heading", { level: 2, name: /Docx Tool/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /convert/i })).toBeInTheDocument();
  });

  it("an unknown tool id gets a friendly page with a way back", async () => {
    window.location.hash = "#/tool/ghost";
    vi.stubGlobal("fetch", vi.fn(async () => catalog()));
    render(<App />);
    expect(await screen.findByText(/isn't in this build/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to the menu/i })).toHaveAttribute("href", "#/");
  });

  it("switching tools starts fresh (no leftover input)", async () => {
    window.location.hash = "#/tool/text-tool";
    vi.stubGlobal("fetch", vi.fn(async () => catalog()));
    render(<App />);
    const editor = (await screen.findByLabelText("Input text")) as HTMLTextAreaElement;
    await userEvent.type(editor, "abc");
    window.location.hash = "#/tool/docx-tool";
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: /Docx Tool/ })).toBeInTheDocument());
    expect((screen.getByLabelText("Input text") as HTMLTextAreaElement).value).toBe("");
  });

  it("explains an unreachable server and can retry", async () => {
    let up = false;
    vi.stubGlobal("fetch", vi.fn(async () => { if (!up) throw new TypeError("down"); return catalog(); }));
    render(<App />);
    expect(await screen.findByText(/server isn't reachable/i)).toBeInTheDocument();
    up = true;
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("What shall we make today?")).toBeInTheDocument();
  });

  it("copes with unexpected non-API errors while loading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 502 })));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/status 502/);
  });

  it("singular footer text for a single tool", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => catalog([textTool()])));
    render(<App />);
    expect(await screen.findByRole("contentinfo")).toHaveTextContent("1 tool installed");
  });
});
