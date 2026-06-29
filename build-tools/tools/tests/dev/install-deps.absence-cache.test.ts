#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runGomod2nixGenerate, runGomod2nixScanAll } from "../../dev/install/gomod2nix";
import { runUvRefreshAll } from "../../dev/install/uv";

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

async function withTempCwd(name: string, fn: (tmp: string) => Promise<void>): Promise<void> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), name));
  const prevCwd = process.cwd();
  const prevWorkspaceRoot = process.env.WORKSPACE_ROOT;
  try {
    process.env.WORKSPACE_ROOT = tmp;
    process.chdir(tmp);
    await fn(tmp);
  } finally {
    process.chdir(prevCwd);
    if (prevWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = prevWorkspaceRoot;
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function withWorkspaceRootEnv(tmp: string, fn: () => Promise<void>): Promise<void> {
  const prevWorkspaceRoot = process.env.WORKSPACE_ROOT;
  try {
    process.env.WORKSPACE_ROOT = tmp;
    await fn();
  } finally {
    if (prevWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = prevWorkspaceRoot;
  }
}

test("uv absence cache skips repeated no-lock scans and invalidates on new uv.lock", async () => {
  await withTempCwd("uv-absence-cache-", async (tmp) => {
    const { logs, restore } = captureLogs();
    try {
      await fsp.mkdir(path.join(tmp, "projects", "apps", "py"), { recursive: true });

      await runUvRefreshAll(false, true);
      await runUvRefreshAll(false, true);
      assert.ok(logs.includes("[uv2nix] skip: no uv.lock present"));
      assert.ok(logs.includes("[uv2nix] scan skipped: no uv.lock present"));

      logs.length = 0;
      await fsp.writeFile(path.join(tmp, "projects", "apps", "py", "uv.lock"), "# uv\n", "utf8");
      await runUvRefreshAll(false, true);
      assert.ok(logs.some((line) => line.includes("[uv2nix] lock projects/apps/py/uv.lock")));
      assert.equal(logs.includes("[uv2nix] scan skipped: no uv.lock present"), false);
    } finally {
      restore();
    }
  });
});

test("gomod2nix absence cache skips repeated empty project scans and invalidates on new module", async () => {
  await withTempCwd("gomod2nix-absence-cache-", async (tmp) => {
    const { logs, restore } = captureLogs();
    try {
      const app = path.join(tmp, "projects", "apps", "goapp");
      await fsp.mkdir(app, { recursive: true });

      await runGomod2nixScanAll(false, true);
      await runGomod2nixScanAll(false, true);
      assert.ok(logs.includes("[gomod2nix] project scan skipped: no Go modules present"));

      logs.length = 0;
      await fsp.writeFile(
        path.join(app, "go.mod"),
        "module example.com/goapp\n\ngo 1.22\n",
        "utf8",
      );
      await fsp.writeFile(path.join(app, "go.sum"), "", "utf8");
      await runGomod2nixScanAll(false, true);
      assert.ok(logs.some((line) => line.includes("[gomod2nix] updated projects/apps/goapp")));
      assert.equal(logs.includes("[gomod2nix] project scan skipped: no Go modules present"), false);
      assert.match(await fsp.readFile(path.join(app, "gomod2nix.toml"), "utf8"), /schema = 3/);
    } finally {
      restore();
    }
  });
});

test("gomod2nix root absence cache skips repeated no-module checks", async () => {
  await withTempCwd("gomod2nix-root-absence-cache-", async (tmp) => {
    const { logs, restore } = captureLogs();
    try {
      await runGomod2nixGenerate(false, true);
      await runGomod2nixGenerate(false, true);
      assert.ok(logs.includes("[gomod2nix] skip: no go.mod or go.sum present"));
      assert.ok(logs.includes("[gomod2nix] scan skipped: no go.mod or go.sum present"));

      logs.length = 0;
      await fsp.writeFile(path.join(tmp, "go.mod"), "module example.com/root\n\ngo 1.22\n", "utf8");
      await fsp.writeFile(path.join(tmp, "go.sum"), "", "utf8");
      await runGomod2nixGenerate(false, true);
      assert.ok(logs.some((line) => line.includes("[gomod2nix] updated gomod2nix.toml")));
      assert.equal(logs.includes("[gomod2nix] scan skipped: no go.mod or go.sum present"), false);
    } finally {
      restore();
    }
  });
});

test("absence cache writes under workspace root when install runs from subdirectory", async () => {
  await withTempCwd("install-absence-subdir-", async (tmp) => {
    await withWorkspaceRootEnv(tmp, async () => {
      const projects = path.join(tmp, "projects");
      await fsp.mkdir(projects, { recursive: true });
      process.chdir(projects);

      await runGomod2nixGenerate(false, false);
      await runGomod2nixScanAll(false, false);
      await runUvRefreshAll(false, false);

      await fsp.access(
        path.join(tmp, ".viberoots", "workspace", "install-cache", "gomod2nix-root-absent.json"),
      );
      await fsp.access(
        path.join(tmp, ".viberoots", "workspace", "install-cache", "gomod2nix-absent.json"),
      );
      await fsp.access(
        path.join(tmp, ".viberoots", "workspace", "install-cache", "uv-locks-absent.json"),
      );
      await assert.rejects(fsp.stat(path.join(projects, ".viberoots")));
    });
  });
});
