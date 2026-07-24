#!/usr/bin/env zx-wrapper
// codex-accounts.ts — helper for the codex wrapper's multi-account layer.
// See docs/history/designs/codex-wrapper-accounts-design.md.
import { runMain } from "../lib/cli-wrap";
import { getArgvTokens } from "../lib/argv";
import { runList } from "./codex-accounts/list";
import { runEmail } from "./codex-accounts/email";
import { runPrepare } from "./codex-accounts/prepare";

const VERSION = "1.0.0";

const HELP = `codex-accounts.ts — helper for the codex wrapper's multi-account layer

Usage:
  codex-accounts.ts list  --root <path> [--legacy-root <path>] [--current <path>] --format text|json
  codex-accounts.ts email --root <path>
  codex-accounts.ts prepare -- <wrapper argv...>
  codex-accounts.ts --help
  codex-accounts.ts --version
`;

async function main(): Promise<void> {
  const raw = getArgvTokens();
  if (raw[0] === "--help" || raw[0] === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (raw[0] === "--version" || raw[0] === "-V") {
    process.stdout.write(`codex-accounts.ts ${VERSION}\n`);
    return;
  }
  const sub = raw[0] || "";
  if (sub.length === 0) {
    process.stderr.write(`error: missing subcommand (list|email|prepare)\n`);
    process.stderr.write(HELP);
    process.exitCode = 2;
    return;
  }
  let code = 0;
  if (sub === "list") code = await runList();
  else if (sub === "email") code = await runEmail();
  else if (sub === "prepare") code = await runPrepare();
  else {
    process.stderr.write(`error: unknown subcommand '${sub}'\n`);
    process.exitCode = 2;
    return;
  }
  process.exitCode = code;
}

runMain(main);
