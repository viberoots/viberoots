#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  cleanupOrphanRegisteredTempRepos,
  cleanupRegisteredBuckIsolations,
  cleanupRegisteredTempRepos,
} from "../../dev/verify/buck-orphan-cleanup";
import { registeredIsolationProcessPidsFromLines } from "../../dev/verify/registered-buck-cleanup";
import { parseVerifyOwnedState } from "../../dev/verify/owned-process-state";
import { buckProcessTableLines, processCommandLines } from "../../lib/process-inspection";
import { terminateChildTree } from "../lib/process-tree";

async function psForkserversForToken(token: string): Promise<string[]> {
  const lines = await buckProcessTableLines(2000);
  return lines.filter(
    (line) =>
      line.includes("(buck2-forkserver)") && line.includes("--state-dir") && line.includes(token),
  );
}

async function waitForForkserver(token: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lines = await psForkserversForToken(token);
    if (lines.length > 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  const lines = await psForkserversForToken(token);
  throw new Error(
    `expected buck2-forkserver for token=${token} to appear, got:\n${lines.join("\n")}`,
  );
}

async function waitForNoForkserver(token: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lines = await psForkserversForToken(token);
    if (lines.length === 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  const lines = await psForkserversForToken(token);
  throw new Error(
    `expected buck2-forkserver for token=${token} to disappear, got:\n${lines.join("\n")}`,
  );
}

async function psLinesMatching(substr: string): Promise<string[]> {
  const pattern = substr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    await processCommandLines({
      timeoutMs: 2000,
      pgrepPattern: pattern,
    })
  ).filter((line) => line.includes(substr));
}

async function waitForProcess(substr: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lines = await psLinesMatching(substr);
    if (lines.length > 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`expected process containing '${substr}'`);
}

async function waitForNoProcess(substr: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lines = await psLinesMatching(substr);
    if (lines.length === 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`expected no process containing '${substr}'`);
}

test("verify cleanup: process tree termination reaps node grandchildren without ps", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-process-tree-"));
  const token = `process-tree-${process.pid}-${Date.now()}`;
  const parentScript = path.join(tmp, `${token}-parent.mjs`);
  const childScript = path.join(tmp, `${token}-child.mjs`);
  await fsp.writeFile(childScript, "setInterval(() => {}, 1000);\n", "utf8");
  await fsp.writeFile(
    parentScript,
    [
      "import { spawn } from 'node:child_process';",
      `spawn(process.execPath, [${JSON.stringify(childScript)}], { stdio: 'ignore' });`,
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    "utf8",
  );
  const parent = spawn(process.execPath, [parentScript], { stdio: "ignore" });
  try {
    await waitForProcess(childScript, 10_000);
    await terminateChildTree(parent, 2000);
    await waitForNoProcess(childScript, 10_000);
  } finally {
    try {
      parent.kill("SIGKILL");
    } catch {}
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

test(
  "verify cleanup: scoped temp repo buck cleanup does not kill other temp repos",
  { timeout: 240_000 },
  async () => {
    const nodeBin = process.execPath;
    const childScript = new URL(
      "../lib/buck-daemon-cleanup.non-disruptive.child.ts",
      import.meta.url,
    ).pathname;
    const zxInit = new URL("../../dev/zx-init.mjs", import.meta.url).pathname;

    const spawnChild = () =>
      spawn(nodeBin, ["--experimental-strip-types", "--import", zxInit, childScript], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, VBR_BUCK_REAPER_STATE_FILE: "" },
      });

    const attachReady = (child: ReturnType<typeof spawnChild>) => {
      let tmp = "";
      let out = "";
      let err = "";
      let ready = false;
      let exitCode: number | null = null;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d) => {
        out += d;
        const m = out.match(/TMP\s+(\S+)/);
        if (m && m[1]) tmp = String(m[1]).trim();
        if (out.includes("\nREADY\n") || out.trimEnd().endsWith("READY")) ready = true;
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (d) => {
        err += d;
      });
      child.on("close", (code) => {
        exitCode = code;
      });
      return {
        getTmp: () => tmp,
        getReady: () => ready,
        getOut: () => out,
        getErr: () => err,
        getExitCode: () => exitCode,
      };
    };

    const foreign = spawnChild();
    const foreignState = attachReady(foreign);
    const owned = spawnChild();
    const ownedState = attachReady(owned);
    let stateDir = "";

    try {
      const t0 = Date.now();
      while (
        (!foreignState.getTmp() ||
          !foreignState.getReady() ||
          !ownedState.getTmp() ||
          !ownedState.getReady()) &&
        Date.now() - t0 < 120_000
      ) {
        if (foreignState.getExitCode() !== null || ownedState.getExitCode() !== null) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const foreignTmp = foreignState.getTmp();
      const ownedTmp = ownedState.getTmp();
      assert.ok(
        foreignTmp,
        `expected foreign tmp path; got stdout:\n${foreignState.getOut()}\nstderr:\n${foreignState.getErr()}`,
      );
      assert.ok(
        ownedTmp,
        `expected owned tmp path; got stdout:\n${ownedState.getOut()}\nstderr:\n${ownedState.getErr()}`,
      );
      assert.ok(
        foreignState.getReady(),
        `expected foreign READY; got stdout:\n${foreignState.getOut()}\nstderr:\n${foreignState.getErr()}`,
      );
      assert.ok(
        ownedState.getReady(),
        `expected owned READY; got stdout:\n${ownedState.getOut()}\nstderr:\n${ownedState.getErr()}`,
      );

      const foreignBase = path.basename(foreignTmp);
      const ownedBase = path.basename(ownedTmp);
      await waitForForkserver(foreignBase, 30_000);
      await waitForForkserver(ownedBase, 30_000);

      stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-cleanup-state-"));
      const stateFile = path.join(stateDir, "state.txt");
      await fsp.writeFile(stateFile, `${ownedTmp}\n`, "utf8");

      await cleanupRegisteredTempRepos({ stateFile, maxKills: 50 });
      await waitForNoForkserver(ownedBase, 30_000);
      await waitForForkserver(foreignBase, 10_000);
    } finally {
      try {
        foreign.kill("SIGKILL");
      } catch {}
      try {
        owned.kill("SIGKILL");
      } catch {}
      if (stateDir) {
        await fsp.rm(stateDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  },
);

test(
  "verify cleanup: scoped temp repo process cleanup does not kill foreign temp repo dev servers",
  { timeout: 120_000 },
  async () => {
    const ownedTmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-owned-dev-"));
    const foreignTmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-foreign-dev-"));
    const ownedScript = path.join(ownedTmp, "projects/apps/demo-vite-ssr/server/dev.mjs");
    const ownedWasmScript = path.join(
      ownedTmp,
      "build-tools/tools/dev/wasm-watch-coordinator-daemon.ts",
    );
    const foreignScript = path.join(foreignTmp, "projects/apps/demo-vite-ssr/server/dev.mjs");
    const mkScript = async (p: string) => {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, "setInterval(() => {}, 1000);", "utf8");
    };
    await mkScript(ownedScript);
    await mkScript(ownedWasmScript);
    await mkScript(foreignScript);
    const owned = spawn(process.execPath, [ownedScript], { stdio: "ignore" });
    const ownedWasm = spawn(process.execPath, [ownedWasmScript], { stdio: "ignore" });
    const foreign = spawn(process.execPath, [foreignScript], { stdio: "ignore" });
    const ownedKey = `${ownedTmp}/projects/apps/demo-vite-ssr/server/dev.mjs`;
    const ownedWasmKey = `${ownedTmp}/build-tools/tools/dev/wasm-watch-coordinator-daemon.ts`;
    const foreignKey = `${foreignTmp}/projects/apps/demo-vite-ssr/server/dev.mjs`;
    let stateDir = "";
    try {
      await waitForProcess(ownedKey, 10_000);
      await waitForProcess(ownedWasmKey, 10_000);
      await waitForProcess(foreignKey, 10_000);
      stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-cleanup-state-"));
      const stateFile = path.join(stateDir, "state.txt");
      await fsp.writeFile(stateFile, `${ownedTmp}\n`, "utf8");
      await cleanupRegisteredTempRepos({ stateFile, maxKills: 50 });
      await waitForNoProcess(ownedKey, 10_000);
      await waitForNoProcess(ownedWasmKey, 10_000);
      await waitForProcess(foreignKey, 10_000);
    } finally {
      try {
        owned.kill("SIGKILL");
      } catch {}
      try {
        ownedWasm.kill("SIGKILL");
      } catch {}
      try {
        foreign.kill("SIGKILL");
      } catch {}
      if (stateDir) {
        await fsp.rm(stateDir, { recursive: true, force: true }).catch(() => {});
      }
      await fsp.rm(ownedTmp, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(foreignTmp, { recursive: true, force: true }).catch(() => {});
    }
  },
);

test(
  "verify cleanup: removing registered temp repos only deletes owned roots",
  { timeout: 30_000 },
  async () => {
    const ownedTmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-owned-root-"));
    const foreignTmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-foreign-root-"));
    const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-cleanup-state-"));
    try {
      await fsp.writeFile(path.join(ownedTmp, "owned.txt"), "owned\n", "utf8");
      await fsp.writeFile(path.join(foreignTmp, "foreign.txt"), "foreign\n", "utf8");
      const stateFile = path.join(stateDir, "state.txt");
      await fsp.writeFile(stateFile, `${ownedTmp}\n`, "utf8");

      await cleanupRegisteredTempRepos({ stateFile, maxKills: 10, removeRoots: true });

      await assert.rejects(fsp.access(ownedTmp));
      await fsp.access(foreignTmp);
    } finally {
      await fsp.rm(stateDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(ownedTmp, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(foreignTmp, { recursive: true, force: true }).catch(() => {});
    }
  },
);

test("verify cleanup: process state records are not treated as temp repo roots", async () => {
  const ownedTmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-owned-root-"));
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-cleanup-state-"));
  try {
    await fsp.writeFile(path.join(ownedTmp, "owned.txt"), "owned\n", "utf8");
    const stateFile = path.join(stateDir, "state.txt");
    const processRecord = {
      pid: 999_999,
      pgid: 999_999,
      startSig: "Mon Apr 27 00:00:00 2026",
      logFile: path.join(stateDir, "verify.log"),
      target: "root//:example",
    };
    await fsp.writeFile(
      stateFile,
      `${ownedTmp}\nprocess\t${JSON.stringify(processRecord)}\n`,
      "utf8",
    );

    const result = await cleanupRegisteredTempRepos({
      stateFile,
      maxKills: 10,
      removeRoots: true,
    });

    assert.equal(result.roots, 1);
    await assert.rejects(fsp.access(ownedTmp));
  } finally {
    await fsp.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(ownedTmp, { recursive: true, force: true }).catch(() => {});
  }
});

test("verify cleanup: registered buck isolations are not treated as temp repo roots", async () => {
  const ownedTmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-owned-root-"));
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-cleanup-state-"));
  try {
    await fsp.writeFile(path.join(ownedTmp, "owned.txt"), "owned\n", "utf8");
    const stateFile = path.join(stateDir, "state.txt");
    const isolationRecord = {
      iso: "verify-nested-999999-deadbeefcafe",
      repoRoot: path.join(stateDir, "missing-repo"),
      ownerPid: 999_999,
      kind: "verify-nested",
      createdAtMs: 1,
    };
    await fsp.writeFile(
      stateFile,
      `${ownedTmp}\nisolation\t${JSON.stringify(isolationRecord)}\n`,
      "utf8",
    );

    const parsed = parseVerifyOwnedState(await fsp.readFile(stateFile, "utf8"));
    assert.deepEqual(parsed.roots, [ownedTmp]);
    assert.deepEqual(parsed.isolations, [isolationRecord]);

    const isoResult = await cleanupRegisteredBuckIsolations({ stateFile, maxKills: 10 });
    assert.equal(isoResult.scanned, 1);
    assert.equal(isoResult.killed, 0);

    const rootResult = await cleanupRegisteredTempRepos({
      stateFile,
      maxKills: 10,
      removeRoots: true,
    });
    assert.equal(rootResult.roots, 1);
    await assert.rejects(fsp.access(ownedTmp));
  } finally {
    await fsp.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(ownedTmp, { recursive: true, force: true }).catch(() => {});
  }
});

test("verify cleanup: registered buck isolation matching accepts pgrep-style full command lines", () => {
  const repoRoot = "/Users/example/repo";
  const entry = {
    iso: "deployment-query-abcdef1234",
    repoRoot,
    ownerPid: 1234,
    kind: "deployment-query",
    createdAtMs: 1,
  };
  const pids = registeredIsolationProcessPidsFromLines(entry, [
    "42 0 00:00 buck2d[repo] --isolation-dir deployment-query-abcdef1234 daemon {}",
    "43 0 00:00 (buck2-forkserver) forkserver --fd 23 --state-dir /Users/example/repo/buck-out/deployment-query-abcdef1234/forkserver",
    "44 0 00:00 buck2d[repo] --isolation-dir v2 daemon {}",
  ]);

  assert.deepEqual(pids, [42, 43]);
});

test("verify cleanup: stale verify state files remove registered temp roots", async () => {
  const ownedTmp = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-owned-stale-root-"));
  const originalUser = process.env.USER;
  const user = `verify-stale-${process.pid}-${Date.now()}`;
  const scanRoot = path.resolve("/tmp", `viberoots-verify-${user}.noindex`);
  const scanDir = path.join(scanRoot, "tmpdir");
  const stateFile = path.join(scanDir, "viberoots-buck-reaper-v-999999-1700000000000.txt");
  try {
    process.env.USER = user;
    await fsp.mkdir(scanDir, { recursive: true });
    await fsp.writeFile(path.join(ownedTmp, "owned.txt"), "owned\n", "utf8");
    await fsp.writeFile(stateFile, `${ownedTmp}\n`, "utf8");

    const result = await cleanupOrphanRegisteredTempRepos({ maxKills: 10 });

    assert.ok(result.scanned >= 1);
    assert.ok(result.candidates >= 1);
    await assert.rejects(fsp.access(ownedTmp));
  } finally {
    if (originalUser === undefined) {
      delete process.env.USER;
    } else {
      process.env.USER = originalUser;
    }
    await fsp.rm(stateFile, { force: true }).catch(() => {});
    await fsp.rm(scanRoot, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(ownedTmp, { recursive: true, force: true }).catch(() => {});
  }
});

test("verify cleanup: prunes dead-owner state files with missing roots despite pid fallback reuse", async () => {
  const originalUser = process.env.USER;
  const user = `verify-stale-prune-${process.pid}-${Date.now()}`;
  const scanRoot = path.resolve("/tmp", `viberoots-verify-${user}.noindex`);
  const scanDir = path.join(scanRoot, "tmpdir");
  const stateFile = path.join(scanDir, "viberoots-buck-reaper-v-999997-1700000000000.txt");
  const missingRoot = path.join(scanRoot, "missing-root");
  const processRecord = {
    pid: process.pid,
    pgid: process.pid,
    startSig: `pid:${process.pid}`,
    logFile: path.join(scanDir, "verify.log"),
    target: "root//:stale_pid_fallback",
  };
  try {
    process.env.USER = user;
    await fsp.mkdir(scanDir, { recursive: true });
    await fsp.writeFile(
      stateFile,
      `${missingRoot}\nprocess\t${JSON.stringify(processRecord)}\n`,
      "utf8",
    );

    const result = await cleanupOrphanRegisteredTempRepos({ maxKills: 0 });

    assert.ok(result.scanned >= 1);
    assert.equal(result.candidates, 0);
    await assert.rejects(fsp.access(stateFile));
  } finally {
    if (originalUser === undefined) {
      delete process.env.USER;
    } else {
      process.env.USER = originalUser;
    }
    await fsp.rm(scanRoot, { recursive: true, force: true }).catch(() => {});
  }
});
