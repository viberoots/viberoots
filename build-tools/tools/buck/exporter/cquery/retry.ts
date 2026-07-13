#!/usr/bin/env zx-wrapper
import { runManagedCommand } from "../../../lib/managed-command";

export function isRetryableCqueryError(msg: string): boolean {
  const text = String(msg || "");
  if (
    text.includes("Error initializing DaemonStateData") ||
    text.includes("Error loading system root certificates native frameworks")
  ) {
    return true;
  }
  if (!text.includes("No such file or directory")) return false;
  return (
    text.includes("root//patches/") ||
    text.includes("`root//patches/") ||
    text.includes("/patches/cpp") ||
    text.includes("/patches/go") ||
    text.includes("/patches/node") ||
    text.includes("/patches/python") ||
    text.includes("/patches/rust")
  );
}

export async function resetBuckDaemon(cwd: string, iso: string): Promise<void> {
  if (!iso) return;
  try {
    await runManagedCommand({
      command: "buck2",
      args: ["--isolation-dir", iso, "kill"],
      cwd,
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
      },
      timeoutMs: 30_000,
    });
  } catch {}
}
