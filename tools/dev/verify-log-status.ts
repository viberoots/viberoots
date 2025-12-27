#!/usr/bin/env zx-wrapper
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { getFlagStr } from "../lib/cli.ts";
import { computeVerifyStatusFromLogText } from "../lib/verify-log-status.ts";

function parseIntOpt(s: string | undefined): number | undefined {
  const t = (s || "").trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

async function main() {
  const logPath = getFlagStr("log", "").trim();
  const json = getFlagStr("json", "").trim() === "1" || process.argv.includes("--json");
  const pid = parseIntOpt(getFlagStr("pid", "").trim());

  if (!logPath) {
    console.error("error: --log is required");
    process.exit(2);
  }

  const abs = path.isAbsolute(logPath) ? logPath : path.join(process.cwd(), logPath);
  let text = "";
  try {
    text = await fsp.readFile(abs, "utf8");
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code === "ENOENT") {
      console.error(`error: log file not found: ${abs}`);
      process.exit(2);
    }
    throw e;
  }
  const st = computeVerifyStatusFromLogText({ logPath: abs, pid, text });

  if (json) {
    // Stable JSON keys for scripting.
    const out = {
      pid: st.pid,
      pass: st.pass,
      fail: st.fail,
      fatal: st.fatal,
      skip: st.skip,
      build_failure: st.buildFailure,
      remaining: st.remaining ?? null,
      failed: st.failed,
      done: st.done,
      elapsed: st.elapsed ?? null,
      log: st.logPath,
      source: st.source,
    };
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return;
  }

  const elapsed = st.elapsed ? st.elapsed : "?";
  const remaining = st.remaining !== undefined ? String(st.remaining) : "?";
  const isTty = Boolean(process.stdout.isTTY) || (process.env.FORCE_COLOR || "") === "1";
  const anyFailures = st.fail > 0 || st.fatal > 0 || st.buildFailure > 0;

  // Color policy:
  // - orange if failures and still running
  // - yellow if no failures and still running
  // - green if done with no failures
  // - red if done with failures
  const RESET = "\u001b[0m";
  const YELLOW = "\u001b[33m";
  const GREEN = "\u001b[32m";
  const RED = "\u001b[31m";
  const ORANGE = "\u001b[38;5;208m";
  const color =
    st.done && anyFailures
      ? RED
      : st.done && !anyFailures
        ? GREEN
        : !st.done && anyFailures
          ? ORANGE
          : YELLOW;

  const DIM = "\u001b[2m";
  const label = (s: string) => (isTty ? `${DIM}${s}${RESET}` : s);
  const val = (s: string) => (isTty ? `${color}${s}${RESET}` : s);
  const red = (s: string) => (isTty ? `${RED}${s}${RESET}` : s);

  process.stdout.write(`${label("Time elapsed:")}    ${val(elapsed)}\n`);
  process.stdout.write(`${label(st.done ? "Tests finished:" : "Tests so far:")}\n`);
  process.stdout.write(`  ${val(`Pass:          ${st.pass}`)}\n`);
  process.stdout.write(`  ${val(`Fail:          ${st.fail}`)}\n`);
  process.stdout.write(`  ${val(`Fatal:         ${st.fatal}`)}\n`);
  process.stdout.write(`  ${val(`Skip:          ${st.skip}`)}\n`);
  process.stdout.write(`  ${val(`Build failure: ${st.buildFailure}`)}\n`);
  process.stdout.write(`${label("----------------------")}\n`);
  process.stdout.write(`${label("Tests remaining:")} ${val(remaining)}\n`);
  process.stdout.write(`${label("Log:")} ${st.logPath}\n`);

  if (st.failed.length > 0) {
    const cap = 10;
    const shown = st.failed.slice(0, cap);
    process.stdout.write(`\n${val(`Failing tests (${st.failed.length}):`)}\n`);
    for (const t of shown) {
      process.stdout.write(red(`  - ${t}`) + "\n");
    }
    if (st.failed.length > cap) {
      process.stdout.write(red(`  ... and ${st.failed.length - cap} more`) + "\n");
    }
    process.stdout.write(`\n`);
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(2);
});
