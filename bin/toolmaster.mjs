#!/usr/bin/env node
import { runCli } from "../core/cli/index.mjs";
import { finish } from "../core/cli/main.mjs";

finish(await runCli(process.argv.slice(2)));
