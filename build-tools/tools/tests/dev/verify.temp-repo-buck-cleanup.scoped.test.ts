#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cleanupRegisteredTempRepos } from "../../dev/verify/buck-orphan-cleanup.ts";
function psForkserversForToken(token: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn("ps", ["-A", "-o", "pid=,ppid=,command="], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (buf += d));
    child.on("error", () => resolve([]));
    child.on("close", () => {
      const lines = String(buf || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      resolve(
        lines.filter(
          (l) => l.includes("(buck2-forkserver)") && l.includes("--state-dir") && l.includes(token),
        ),
      );
    });
  });
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

function psLinesMatching(substr: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn("ps", ["-A", "-o", "pid=,ppid=,command="], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (buf += d));
    child.on("error", () => resolve([]));
    child.on("close", () => {
      const lines = String(buf || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      resolve(lines.filter((l) => l.includes(substr)));
    });
  });
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
        env: { ...process.env, BNX_BUCK_REAPER_STATE_FILE: "" },
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
    const foreignScript = path.join(foreignTmp, "projects/apps/demo-vite-ssr/server/dev.mjs");
    const mkScript = async (p: string) => {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, "setInterval(() => {}, 1000);", "utf8");
    };
    await mkScript(ownedScript);
    await mkScript(foreignScript);
    const owned = spawn(process.execPath, [ownedScript], { stdio: "ignore" });
    const foreign = spawn(process.execPath, [foreignScript], { stdio: "ignore" });
    const ownedKey = `${ownedTmp}/projects/apps/demo-vite-ssr/server/dev.mjs`;
    const foreignKey = `${foreignTmp}/projects/apps/demo-vite-ssr/server/dev.mjs`;
    let stateDir = "";
    try {
      await waitForProcess(ownedKey, 10_000);
      await waitForProcess(foreignKey, 10_000);
      stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-cleanup-state-"));
      const stateFile = path.join(stateDir, "state.txt");
      await fsp.writeFile(stateFile, `${ownedTmp}\n`, "utf8");
      await cleanupRegisteredTempRepos({ stateFile, maxKills: 50 });
      await waitForNoProcess(ownedKey, 10_000);
      await waitForProcess(foreignKey, 10_000);
    } finally {
      try {
        owned.kill("SIGKILL");
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
