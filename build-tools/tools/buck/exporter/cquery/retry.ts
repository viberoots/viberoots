#!/usr/bin/env zx-wrapper

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
    await $({
      cwd,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
      },
    })`buck2 --isolation-dir ${iso} kill`.nothrow();
  } catch {}
}
