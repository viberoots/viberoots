#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";

function valueOrEmpty(input: string): string {
  return String(input || "").trim();
}

function resolveFromFlagOrEnvOrDefault(
  cwd: string,
  flagName: string,
  envName: string,
  fallbackRelative: string,
): string {
  const fromFlag = valueOrEmpty(getFlagStr(flagName, ""));
  if (fromFlag) return path.resolve(cwd, fromFlag);
  const fromEnv = valueOrEmpty(process.env[envName] || "");
  if (fromEnv) return path.resolve(cwd, fromEnv);
  return path.resolve(cwd, fallbackRelative);
}

async function main() {
  const cwd = path.resolve(getFlagStr("cwd", process.cwd()) || process.cwd());
  const payloadPath = resolveFromFlagOrEnvOrDefault(
    cwd,
    "payload",
    "WASM_PRODUCER_PAYLOAD_PATH",
    path.join("src", "wasm-producer", "payload.txt"),
  );
  const outPath = resolveFromFlagOrEnvOrDefault(
    cwd,
    "out",
    "WASM_PRODUCER_OUT_PATH",
    path.join(".wasm-producer", "top.wasm"),
  );

  const payload = valueOrEmpty(await fsp.readFile(payloadPath, "utf8"));
  if (!payload) {
    throw new Error(`wasm producer payload is empty; write a non-empty value to ${payloadPath}`);
  }
  if (payload.toUpperCase().includes("FAIL")) {
    throw new Error(
      "wasm producer payload includes FAIL marker; remove FAIL and rerun pnpm run dev:wasm:watch",
    );
  }

  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  const bytes = new TextEncoder().encode(`wasm-producer:${payload}`);
  await fsp.writeFile(outPath, bytes);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
