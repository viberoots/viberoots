#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

export async function runNodeEval(
  cwd: string,
  code: string,
  args: string[],
  envOverrides: Record<string, string> = {},
): Promise<string> {
  const child = spawn(
    "node",
    ["--experimental-strip-types", "--input-type=module", "-e", code, ...args],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...envOverrides },
    },
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on("data", (chunk) => stdout.push(String(chunk || "")));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk || "")));
  const [codeExit] = (await once(child, "exit")) as [number | null];
  if ((codeExit ?? 1) !== 0) {
    throw new Error(`node eval failed (code=${String(codeExit)}):\n${stderr.join("")}`);
  }
  return stdout.join("").trim();
}

export async function readTsModuleMessageViaHelper(
  appAbs: string,
  helperRelativePath: string,
  moduleKey: string,
  moduleContractsDir = "",
): Promise<string> {
  const helperAbs = path.join(appAbs, helperRelativePath);
  const code = [
    'import { pathToFileURL } from "node:url";',
    "const helper = await import(pathToFileURL(process.argv[1]).href + `?t=${Date.now()}`);",
    "const ns = await helper.loadTsModule(process.argv[2]);",
    "if (typeof ns.moduleMessage !== 'function') throw new Error('moduleMessage() missing');",
    "process.stdout.write(String(ns.moduleMessage()));",
  ].join("\n");
  const env = moduleContractsDir ? { MODULE_CONTRACTS_DIR: moduleContractsDir } : {};
  return await runNodeEval(appAbs, code, [helperAbs, moduleKey], env);
}

export async function readWasmByteLengthViaHelper(
  appAbs: string,
  helperRelativePath: string,
  moduleKey: string,
  moduleContractsDir = "",
): Promise<number> {
  const helperAbs = path.join(appAbs, helperRelativePath);
  const code = [
    'import { pathToFileURL } from "node:url";',
    "const helper = await import(pathToFileURL(process.argv[1]).href + `?t=${Date.now()}`);",
    "const bytes = await helper.readServerWasmModuleByteLength(process.argv[2]);",
    "process.stdout.write(String(bytes));",
  ].join("\n");
  const env = moduleContractsDir ? { MODULE_CONTRACTS_DIR: moduleContractsDir } : {};
  const out = await runNodeEval(appAbs, code, [helperAbs, moduleKey], env);
  return Number(out);
}
