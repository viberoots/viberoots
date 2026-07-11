#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { processStartSignature } from "../../lib/process-inspection";
import { runHousekeeping } from "../../dev/dev-build/housekeeping";

async function writeExecutable(file: string, body: string): Promise<void> {
  await fsp.writeFile(file, body, "utf8");
  await fsp.chmod(file, 0o755);
}

function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (line?: unknown, ...args: unknown[]) => {
    logs.push([line, ...args].map(String).join(" "));
  };
  return {
    logs,
    restore: () => {
      console.log = originalLog;
    },
  };
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("dev-build housekeeping skips optimise by default when disk is healthy", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-build-housekeeping-"));
  const bin = path.join(root, "bin");
  const prevPath = process.env.PATH;
  const prevGcMode = process.env.VBR_GC_MODE;
  const prevHousekeeping = process.env.VBR_HOUSEKEEPING;
  const prevCleanCooldown = process.env.VBR_CLEAN_TEMP_OUTS_COOLDOWN_MINUTES;
  const prevOptimiseMode = process.env.VBR_OPTIMISE_MODE;
  const prevVerifyLockDir = process.env.VBR_VERIFY_LOCK_DIR;
  const prevVerbose = process.env.VBR_VERBOSE;
  const { logs, restore } = captureLogs();
  let cleanCount = 0;
  try {
    await fsp.mkdir(bin, { recursive: true });
    await writeExecutable(
      path.join(bin, "nix"),
      [
        "#!/usr/bin/env bash",
        `echo "$*" >> ${JSON.stringify(path.join(root, "nix.log"))}`,
        "exit 0",
        "",
      ].join("\n"),
    );
    process.env.PATH = `${bin}${path.delimiter}${prevPath || ""}`;
    process.env.VBR_GC_MODE = "off";
    process.env.VBR_HOUSEKEEPING = "1";
    process.env.VBR_VERBOSE = "1";
    delete process.env.VBR_OPTIMISE_MODE;
    delete process.env.VBR_VERIFY_LOCK_DIR;

    await runHousekeeping({
      cleanTempOuts: async () => {
        cleanCount += 1;
        return true;
      },
      diskStats: async () => ({ freeBytes: 900 * 1024 * 1024 * 1024, freePct: 90 }),
      isCI: false,
      root,
    });

    const stamp = path.join(root, "buck-out", ".housekeeping", ".optimize-stamp");
    await assert.rejects(fsp.stat(stamp));
    await assert.rejects(fsp.stat(path.join(root, "nix.log")));
    assert.equal(cleanCount, 1);
    assert.ok(logs.includes("[housekeeping] optimise: skipped (sufficient free space)"));
    assert.ok(logs.includes("[housekeeping] finished."));
  } finally {
    restore();
    restoreEnv({
      PATH: prevPath,
      VBR_CLEAN_TEMP_OUTS_COOLDOWN_MINUTES: prevCleanCooldown,
      VBR_GC_MODE: prevGcMode,
      VBR_HOUSEKEEPING: prevHousekeeping,
      VBR_OPTIMISE_MODE: prevOptimiseMode,
      VBR_VERIFY_LOCK_DIR: prevVerifyLockDir,
      VBR_VERBOSE: prevVerbose,
    });
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("dev-build housekeeping runs optimise under pressure and respects cooldown", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-build-housekeeping-"));
  const bin = path.join(root, "bin");
  const prevPath = process.env.PATH;
  const prevGcMode = process.env.VBR_GC_MODE;
  const prevHousekeeping = process.env.VBR_HOUSEKEEPING;
  const prevCleanCooldown = process.env.VBR_CLEAN_TEMP_OUTS_COOLDOWN_MINUTES;
  const prevOptimiseMode = process.env.VBR_OPTIMISE_MODE;
  const prevVerifyLockDir = process.env.VBR_VERIFY_LOCK_DIR;
  const prevVerbose = process.env.VBR_VERBOSE;
  const { logs, restore } = captureLogs();
  let cleanCount = 0;
  try {
    await fsp.mkdir(bin, { recursive: true });
    await writeExecutable(
      path.join(bin, "nix"),
      [
        "#!/usr/bin/env bash",
        `echo "$*" >> ${JSON.stringify(path.join(root, "nix.log"))}`,
        "exit 0",
        "",
      ].join("\n"),
    );
    process.env.PATH = `${bin}${path.delimiter}${prevPath || ""}`;
    process.env.VBR_GC_MODE = "off";
    process.env.VBR_HOUSEKEEPING = "1";
    process.env.VBR_VERBOSE = "1";
    delete process.env.VBR_OPTIMISE_MODE;
    delete process.env.VBR_VERIFY_LOCK_DIR;

    const pressureStats = async () => ({ freeBytes: 5 * 1024 * 1024 * 1024, freePct: 5 });
    const cleanTempOuts = async () => {
      cleanCount += 1;
      return true;
    };
    await runHousekeeping({ cleanTempOuts, diskStats: pressureStats, isCI: false, root });
    await runHousekeeping({ cleanTempOuts, diskStats: pressureStats, isCI: false, root });

    const stamp = path.join(root, "buck-out", ".housekeeping", ".optimize-stamp");
    assert.equal((await fsp.stat(stamp)).isFile(), true);
    assert.equal(cleanCount, 1);
    assert.match(await fsp.readFile(path.join(root, "nix.log"), "utf8"), /store optimise/);
    assert.ok(logs.includes("[housekeeping] optimise: running (<=60s)..."));
    assert.ok(logs.includes("[housekeeping] optimise: skipped (cooldown)"));
    assert.ok(logs.includes("[housekeeping] temp cleanup: skipped (cooldown)"));
  } finally {
    restore();
    restoreEnv({
      PATH: prevPath,
      VBR_CLEAN_TEMP_OUTS_COOLDOWN_MINUTES: prevCleanCooldown,
      VBR_GC_MODE: prevGcMode,
      VBR_HOUSEKEEPING: prevHousekeeping,
      VBR_OPTIMISE_MODE: prevOptimiseMode,
      VBR_VERIFY_LOCK_DIR: prevVerifyLockDir,
      VBR_VERBOSE: prevVerbose,
    });
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("dev-build housekeeping skips automatic nix GC while verify lock is live", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-build-housekeeping-"));
  const verifyRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-build-verify-root-"));
  const bin = path.join(root, "bin");
  const prevPath = process.env.PATH;
  const prevGcMode = process.env.VBR_GC_MODE;
  const prevHousekeeping = process.env.VBR_HOUSEKEEPING;
  const prevCleanCooldown = process.env.VBR_CLEAN_TEMP_OUTS_COOLDOWN_MINUTES;
  const prevOptimiseMode = process.env.VBR_OPTIMISE_MODE;
  const prevVerifyLockDir = process.env.VBR_VERIFY_LOCK_DIR;
  const prevVerbose = process.env.VBR_VERBOSE;
  const { logs, restore } = captureLogs();
  try {
    await fsp.mkdir(bin, { recursive: true });
    await writeExecutable(
      path.join(bin, "timeout"),
      [
        "#!/usr/bin/env bash",
        `echo "$*" >> ${JSON.stringify(path.join(root, "timeout.log"))}`,
        "exit 0",
        "",
      ].join("\n"),
    );
    await writeExecutable(
      path.join(bin, "nix-store"),
      [
        "#!/usr/bin/env bash",
        `echo "$*" >> ${JSON.stringify(path.join(root, "gc.log"))}`,
        "exit 0",
        "",
      ].join("\n"),
    );
    const lockDir = path.join(verifyRoot, ".viberoots", "workspace", "buck", "verify-lock");
    await fsp.mkdir(lockDir, { recursive: true });
    await fsp.writeFile(path.join(lockDir, "pid"), String(process.pid), "utf8");
    await fsp.writeFile(
      path.join(lockDir, "lstart"),
      (await processStartSignature(process.pid)) || "",
      "utf8",
    );
    process.env.PATH = `${bin}${path.delimiter}${prevPath || ""}`;
    process.env.VBR_GC_MODE = "auto";
    process.env.VBR_HOUSEKEEPING = "1";
    delete process.env.VBR_OPTIMISE_MODE;
    process.env.VBR_VERIFY_LOCK_DIR = lockDir;
    process.env.VBR_VERBOSE = "1";

    await runHousekeeping({
      cleanTempOuts: async () => true,
      diskStats: async () => ({ freeBytes: 5 * 1024 * 1024 * 1024, freePct: 5 }),
      isCI: false,
      root,
    });

    await assert.rejects(fsp.stat(path.join(root, "gc.log")));
    await assert.rejects(fsp.stat(path.join(root, "timeout.log")));
    await assert.rejects(fsp.stat(path.join(root, "buck-out", ".housekeeping", ".gc-stamp")));
    assert.ok(logs.includes("[housekeeping] optimise: skipped (verify running)"));
    assert.ok(logs.includes("[housekeeping] GC: skipped (verify running)"));
  } finally {
    restore();
    restoreEnv({
      PATH: prevPath,
      VBR_CLEAN_TEMP_OUTS_COOLDOWN_MINUTES: prevCleanCooldown,
      VBR_GC_MODE: prevGcMode,
      VBR_HOUSEKEEPING: prevHousekeeping,
      VBR_OPTIMISE_MODE: prevOptimiseMode,
      VBR_VERIFY_LOCK_DIR: prevVerifyLockDir,
      VBR_VERBOSE: prevVerbose,
    });
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(verifyRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("dev-build housekeeping resolves clean-temp-outs through build tool selector", async () => {
  const source = await fsp.readFile(
    path.join(
      process.cwd(),
      "viberoots",
      "build-tools",
      "tools",
      "dev",
      "dev-build",
      "housekeeping.ts",
    ),
    "utf8",
  );
  assert.match(source, /buildToolPath\(\s*opts\.root,\s*"tools\/dev\/clean-temp-outs\.ts"/s);
  assert.doesNotMatch(
    source,
    /path\.join\(\s*opts\.root,\s*"build-tools\/tools\/dev\/clean-temp-outs\.ts"/s,
  );
});
