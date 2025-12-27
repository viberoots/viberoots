#!/usr/bin/env zx-wrapper
import process from "node:process";
import { getArgvTokens } from "../lib/cli.ts";
import { parseTailLogArgs } from "./tail-log/args.ts";
import { resolveLatest, pidAlive } from "./tail-log/resolve.ts";
import { renderStatusWatchLoop, runStatusOnce } from "./tail-log/status.ts";
import { followLatestTail, tailPidLog } from "./tail-log/tail.ts";

async function main() {
  const args = parseTailLogArgs(getArgvTokens());
  if (args.help) {
    process.stderr.write(args.usage);
    process.exit(2);
    return;
  }

  if (args.mode === "status") {
    if (args.watch) {
      await renderStatusWatchLoop(args);
      return;
    }
    await runStatusOnce(args);
    return;
  }

  if (args.selection.kind === "pid") {
    if (!(await pidAlive(args.selection.pid))) {
      process.stderr.write(`error: pid ${args.selection.pid} is not running\n`);
      process.exit(2);
      return;
    }
    await tailPidLog(args.selection.pid, args.lines);
    return;
  }

  // Tail mode, latest selection
  await followLatestTail(resolveLatest, args.lines);
}

main().catch((e) => {
  process.stderr.write(String((e as any)?.stack || e) + "\n");
  process.exit(2);
});
