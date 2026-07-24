// Shared helpers for codex-accounts.ts unit tests.
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { viberootsRoot } from "./agent-wrapper-test-helpers.ts";

export const helper = path.join(viberootsRoot, "build-tools", "tools", "dev", "codex-accounts.ts");

export function b64url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function makeJwt(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.`;
}

export async function scratch(): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), "codex-accts-test-"));
}

export async function writeAuth(
  dir: string,
  content: string | Record<string, unknown> | null,
): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  if (content === null) return;
  const text = typeof content === "string" ? content : JSON.stringify(content);
  await fsp.writeFile(path.join(dir, "auth.json"), text, "utf8");
}

export type HelperResult = { code: number; stdout: string; stderr: string };

export async function runHelper(
  args: string[],
  env?: Record<string, string>,
): Promise<HelperResult> {
  try {
    const res = await $({
      stdio: "pipe",
      nothrow: true,
      env: { ...process.env, ...(env || {}) },
    })`zx-wrapper ${helper} ${args}`;
    return {
      code: res.exitCode ?? 0,
      stdout: String(res.stdout || ""),
      stderr: String(res.stderr || ""),
    };
  } catch (e: any) {
    return {
      code: e?.exitCode ?? 1,
      stdout: String(e?.stdout || ""),
      stderr: String(e?.stderr || String(e)),
    };
  }
}
