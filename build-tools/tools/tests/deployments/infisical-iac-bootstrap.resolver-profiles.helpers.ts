import assert from "node:assert/strict";
import * as fs from "node:fs/promises";

export const VAULT_PROFILE = {
  backend: "vault",
  addressEnv: "VBR_VAULT_ADDR",
  tokenEnv: "VBR_VAULT_TOKEN",
  mount: "secret",
  defaultPath: "/deployments",
};

export async function assertMissing(file: string) {
  await assert.rejects(() => fs.stat(file), /ENOENT/);
}

export async function captureConsole(run: () => Promise<void>) {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (value?: unknown) => stdout.push(String(value));
  console.error = (value?: unknown) => stderr.push(String(value));
  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}
