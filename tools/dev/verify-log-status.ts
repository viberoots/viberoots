#!/usr/bin/env zx-wrapper
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import {
  computeVerifyStatusFromLogText,
  formatVerifyStatusJsonLine,
  formatVerifyStatusText,
} from "../lib/verify-log-status.ts";

function parseIntOpt(s: string | undefined): number | undefined {
  const t = (s || "").trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

async function main() {
  const logPath = getFlagStr("log", "").trim();
  const json = getFlagBool("json");
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
    process.stdout.write(`${formatVerifyStatusJsonLine(st)}\n`);
    return;
  }

  const isTty = Boolean(process.stdout.isTTY) || (process.env.FORCE_COLOR || "") === "1";
  process.stdout.write(formatVerifyStatusText(st, { isTty }) + "\n");
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(2);
});
