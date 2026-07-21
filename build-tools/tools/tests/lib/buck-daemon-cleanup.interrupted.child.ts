#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { runInTemp } from "./test-helpers";

async function findForkserverDir(tmp: string): Promise<string | null> {
  const buckOut = path.join(tmp, "buck-out");
  const v2 = path.join(buckOut, "v2", "forkserver");
  try {
    await fsp.access(v2);
    return v2;
  } catch {}
  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = await fsp.readdir(buckOut, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const candidate = path.join(buckOut, ent.name, "forkserver");
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

// Keep the temp repo on disk so the detached reaper can locate buck-out/<iso>/forkserver.
process.env.TEST_KEEP_TMP = "1";
// Print TMP as early as possible (before temp repo seeding), so the parent can coordinate even if
// setup is slow or the process is interrupted mid-init.
process.env.TEST_EARLY_TMP_STDOUT = "1";

await runInTemp("buck-cleanup-interrupted", async (tmp, $) => {
  // Start a buck2 build and print READY once the forkserver state dir appears.
  // The parent test will SIGKILL this process to simulate interruption while buck2 is live.
  //
  // IMPORTANT: do not rely on zx's command stdio defaults here; the parent test expects READY on
  // the child's stdout stream.
  let certFile = process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE || "";
  if (!certFile) {
    const fallback = "/nix/var/nix/profiles/default/etc/ssl/certs/ca-bundle.crt";
    try {
      await fsp.access(fallback);
      certFile = fallback;
    } catch {}
  }
  const buck = spawn("buck2", ["build", "//.viberoots/workspace:flake.lock"], {
    cwd: tmp,
    env: {
      ...process.env,
      HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
      SSL_CERT_FILE: certFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let buckOut = "";
  let buckErr = "";
  if (buck.stdout) {
    buck.stdout.setEncoding("utf8");
    buck.stdout.on("data", (d) => (buckOut += d));
  }
  if (buck.stderr) {
    buck.stderr.setEncoding("utf8");
    buck.stderr.on("data", (d) => (buckErr += d));
  }
  buck.on("error", (err) => {
    buckErr += `\n[spawn error] ${String(err)}\n`;
  });
  const t0 = Date.now();
  let forkserverReady = false;
  let forkserverPath = "";
  const waitMs = 60_000;
  while (Date.now() - t0 < waitMs) {
    const found = await findForkserverDir(tmp);
    if (found) {
      forkserverPath = found;
      forkserverReady = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!forkserverReady) {
    console.error(
      `buck cleanup child: forkserver dir did not appear within ${Math.round(waitMs / 1000)}s`,
    );
    if (buckOut.trim() || buckErr.trim()) {
      console.error("buck2 stdout:\n" + buckOut.trim());
      console.error("buck2 stderr:\n" + buckErr.trim());
    }
    console.error(`buck2 HOME: ${process.env.BUCK2_REAL_HOME || process.env.HOME || ""}`);
    console.error(
      `buck2 SSL_CERT_FILE: ${process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE || ""}`,
    );
    console.error(`buck2 PATH: ${process.env.PATH || ""}`);
    if (buck.exitCode !== null) {
      console.error(`buck2 exit code: ${buck.exitCode}`);
    }
    process.exit(2);
  }
  if (forkserverPath) {
    console.error(`buck cleanup child: forkserver ready at ${forkserverPath}`);
  }
  console.log("READY");
  // Keep a real event-loop handle alive so the parent must SIGKILL us. A pending Promise alone
  // does not keep Node running once the detached Buck child's stdio closes.
  while (true) await new Promise((resolve) => setTimeout(resolve, 1_000));
});
