import { createInterface } from "node:readline";
import path from "node:path";

/** Line reader that works for TTYs and piped/test streams; `ask` resolves null at end of input. */
function lineReader(stdin, stdout) {
  const rl = createInterface({ input: stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(prompt) {
      stdout.write(prompt);
      const { value, done } = await lines.next();
      return done ? null : value.trim();
    },
    close: () => rl.close(),
  };
}

const defaultOutput = (inputPath, extension) => {
  const { dir, name } = path.parse(inputPath);
  return path.join(dir, `${name}.${extension}`);
};

/**
 * Interactive start menu: pick a tool, answer a few prompts, get the file.
 * Returns an exit code, or `{ ui }` when the user chose the web app.
 */
export async function runMenu({ tm, stdin, stdout, deps }) {
  const reader = lineReader(stdin, stdout);
  const say = (s = "") => stdout.write(`${s}\n`);
  try {
    for (;;) {
      const tools = tm.registry.list();
      const status = await tm.runner.status({ fresh: true });
      say("\nToolMaster: small tools that run on your machine. Nothing is uploaded.\n");
      say("  1) Open the web app (all tools, drag and drop, live preview)");
      tools.forEach((t, i) => {
        const ready = status[t.manifest.id].ready;
        say(`  ${i + 2}) ${t.manifest.name}${ready ? "" : "   [engine missing: choose i]"}`);
      });
      say("  i) Install or repair engines");
      say("  q) Quit\n");
      const answer = await reader.ask("Choose: ");
      if (answer === null) return 0;
      const choice = answer.toLowerCase();
      if (choice === "q" || choice === "quit") return 0;

      if (choice === "1") return { ui: await deps.launchUi({ tm, open: true }) };

      if (choice === "i") {
        for (const spec of new Map(tools.flatMap((t) => (t.manifest.engines ?? []).map((e) => [e.id, e]))).values()) {
          await deps.installEngine({ config: tm.config, spec, log: say }).catch((e) => say(`  could not install ${spec.id}: ${e.message}`));
        }
        continue;
      }

      const tool = tools[Number(choice) - 2];
      if (!tool || !/^\d+$/.test(choice)) {
        say("Please type one of the numbers or letters above.");
        continue;
      }
      const m = tool.manifest;
      say(`\n${m.name}: ${m.description}`);
      const input = await reader.ask(`Input file (${m.input.accept.join(", ")}): `);
      if (!input) continue;
      const suggested = defaultOutput(input, m.output.extension);
      const output = (await reader.ask(`Output file [${suggested}]: `)) || suggested;
      const options = {};
      for (const o of m.options ?? []) {
        const hint = o.type === "enum" ? o.values.join("/") : "true/false";
        const answer = await reader.ask(`${o.label} [${o.default}] (${hint}): `);
        if (answer) options[o.id] = answer;
      }
      try {
        const r = await tm.runner.runToFile({ tool: m.id, input, output, options });
        say(`\nDone: ${r.outputPath} (${r.bytes} bytes, ${r.durationMs} ms)`);
        for (const w of r.warnings) say(`  note: ${w}`);
      } catch (err) {
        say(`\nThat did not work [${err.code ?? "ERROR"}]: ${err.message}`);
        if (err.log) say(err.log.split("\n").slice(-12).join("\n"));
      }
    }
  } finally {
    reader.close();
  }
}
