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

process.env.TEST_KEEP_TMP = "1";
// Print TMP before expensive seeding so the parent can coordinate without waiting on repo setup.
process.env.TEST_EARLY_TMP_STDOUT = "1";

await runInTemp("buck-cleanup-nondisruptive-child", async (tmp, $) => {
  console.log(`TMP ${tmp}`);
  const buck = spawn("buck2", ["build", "//:flake.lock"], {
    cwd: tmp,
    env: {
      ...process.env,
      HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
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
    if (buck.exitCode !== null) {
      console.error(`buck2 exit code: ${buck.exitCode}`);
    }
    process.exit(2);
  }
  if (forkserverPath) {
    console.error(`buck cleanup child: forkserver ready at ${forkserverPath}`);
  }
  console.log("READY");

  const signal = path.join(tmp, "go.signal");
  while (true) {
    try {
      await fsp.access(signal);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // If cleanup from other runs is too broad, this build can fail (repo broken / daemon killed mid-flight).
  await $`buck2 build //:flake.lock`;
  console.log("PING_OK");

  await new Promise(() => {});
});
