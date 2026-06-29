#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { findRepoRoot, resolveWorkspaceRootsSync } from "../../lib/repo";
import { runInTemp } from "./test-helpers";

const execFileAsync = promisify(execFile);
const VERSION_SCRIPT = "viberoots/build-tools/tools/dev/viberoots.ts";

async function exists(p: string): Promise<boolean> {
  return await fsp.access(p).then(
    () => true,
    () => false,
  );
}

async function workspace(prefix: string): Promise<string> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  await fsp.writeFile(path.join(tmp, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  return await fsp.realpath(tmp);
}

async function extractedWorkspace(prefix: string): Promise<string> {
  const tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  await fsp.mkdir(path.join(tmp, ".viberoots", "workspace"), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, ".viberoots", "workspace", "flake.nix"),
    "{ outputs = _: {}; }\n",
    "utf8",
  );
  await fsp.mkdir(path.join(tmp, "viberoots"), { recursive: true });
  await fsp.writeFile(path.join(tmp, "viberoots", "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  return tmp;
}

async function realTemp(prefix: string): Promise<string> {
  return await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return String(stdout || "").trim();
}

async function initGitRepo(root: string): Promise<string> {
  await git(["init"], root);
  await fsp.writeFile(path.join(root, "README.md"), "fixture\n", "utf8");
  await git(["add", "README.md"], root);
  await git(
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"],
    root,
  );
  return await git(["rev-parse", "HEAD"], root);
}

async function runVersion(workspaceRoot: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const { stdout } = await execFileAsync("zx-wrapper", [VERSION_SCRIPT, "version", "--json"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
      WORKSPACE_ROOT: workspaceRoot,
      NO_DEV_SHELL: "1",
    },
  });
  return JSON.parse(String(stdout));
}

test("findRepoRoot prefers WORKSPACE_ROOT when temp-workspace commands run under a nested repo path", async () => {
  await runInTemp("repo-find-root-workspace-env", async (tmp) => {
    await fsp.writeFile(path.join(tmp, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    const nested = path.join(tmp, "projects", "deployments", "demo");
    await fsp.mkdir(nested, { recursive: true });
    const previous = process.env.WORKSPACE_ROOT;
    process.env.WORKSPACE_ROOT = tmp;
    try {
      assert.equal(await findRepoRoot(nested), tmp);
    } finally {
      if (typeof previous === "string") process.env.WORKSPACE_ROOT = previous;
      else delete process.env.WORKSPACE_ROOT;
    }
  });
});

test("workspace root detection prefers extracted parent workspace over nested viberoots flake", async () => {
  const tmp = await extractedWorkspace("vbr-roots-extracted");
  const previousWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const previousDevshellRoot = process.env._VIBEROOTS_DEVSHELL_ROOT;
  const previousLiveRoot = process.env.LIVE_ROOT;
  try {
    delete process.env.WORKSPACE_ROOT;
    delete process.env._VIBEROOTS_DEVSHELL_ROOT;
    delete process.env.LIVE_ROOT;
    const nested = path.join(tmp, "viberoots", "build-tools", "tools", "dev");
    await fsp.mkdir(nested, { recursive: true });
    assert.equal(await findRepoRoot(nested), tmp);
    const roots = resolveWorkspaceRootsSync({ start: nested, env: {} });
    assert.equal(roots.workspaceRoot, tmp);
    assert.equal(roots.viberootsWorkspace, path.join(tmp, ".viberoots", "workspace"));
  } finally {
    if (typeof previousWorkspaceRoot === "string")
      process.env.WORKSPACE_ROOT = previousWorkspaceRoot;
    else delete process.env.WORKSPACE_ROOT;
    if (typeof previousDevshellRoot === "string")
      process.env._VIBEROOTS_DEVSHELL_ROOT = previousDevshellRoot;
    else delete process.env._VIBEROOTS_DEVSHELL_ROOT;
    if (typeof previousLiveRoot === "string") process.env.LIVE_ROOT = previousLiveRoot;
    else delete process.env.LIVE_ROOT;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("workspace root detection treats generated workspace flake as parent workspace state", async () => {
  const tmp = await extractedWorkspace("vbr-roots-hidden-workspace");
  const previousWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const previousDevshellRoot = process.env._VIBEROOTS_DEVSHELL_ROOT;
  const previousLiveRoot = process.env.LIVE_ROOT;
  try {
    delete process.env.WORKSPACE_ROOT;
    delete process.env._VIBEROOTS_DEVSHELL_ROOT;
    delete process.env.LIVE_ROOT;
    const generatedFlakeRoot = path.join(tmp, ".viberoots", "workspace");
    assert.equal(await findRepoRoot(generatedFlakeRoot), tmp);
    const roots = resolveWorkspaceRootsSync({ start: generatedFlakeRoot, env: {} });
    assert.equal(roots.workspaceRoot, tmp);
    assert.equal(roots.viberootsWorkspace, generatedFlakeRoot);
  } finally {
    if (typeof previousWorkspaceRoot === "string")
      process.env.WORKSPACE_ROOT = previousWorkspaceRoot;
    else delete process.env.WORKSPACE_ROOT;
    if (typeof previousDevshellRoot === "string")
      process.env._VIBEROOTS_DEVSHELL_ROOT = previousDevshellRoot;
    else delete process.env._VIBEROOTS_DEVSHELL_ROOT;
    if (typeof previousLiveRoot === "string") process.env.LIVE_ROOT = previousLiveRoot;
    else delete process.env.LIVE_ROOT;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("resolveWorkspaceRootsSync resolves local viberoots current symlink", async () => {
  const tmp = await workspace("vbr-roots-local");
  try {
    const viberoots = path.join(tmp, "viberoots");
    await fsp.mkdir(path.join(tmp, ".viberoots"), { recursive: true });
    await fsp.mkdir(viberoots, { recursive: true });
    await fsp.symlink("../viberoots", path.join(tmp, ".viberoots", "current"));

    const roots = resolveWorkspaceRootsSync({ start: tmp, env: { WORKSPACE_ROOT: tmp } });
    assert.equal(roots.workspaceRoot, tmp);
    assert.equal(roots.viberootsRoot, viberoots);
    assert.equal(roots.sourceMode, "local");
    assert.equal(roots.currentStatus, "present");
    assert.equal(roots.currentPointsToLiveCheckout, true);
    assert.equal(roots.viberootsWorkspace, path.join(tmp, ".viberoots", "workspace"));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("resolveWorkspaceRootsSync keeps workspace usable when current symlink is missing", async () => {
  const tmp = await workspace("vbr-roots-missing");
  try {
    const roots = resolveWorkspaceRootsSync({ start: tmp, env: { WORKSPACE_ROOT: tmp } });
    assert.equal(roots.viberootsRoot, tmp);
    assert.equal(roots.sourceMode, "local");
    assert.equal(roots.currentStatus, "missing");
    assert.equal(roots.currentPointsToLiveCheckout, false);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("resolveWorkspaceRootsSync reports remote-shaped current source", async () => {
  const tmp = await workspace("vbr-roots-remote");
  try {
    const source = path.join(tmp, "nix", "store", "abc-viberoots-source");
    await fsp.mkdir(path.join(tmp, ".viberoots"), { recursive: true });
    await fsp.mkdir(source, { recursive: true });
    await fsp.symlink(source, path.join(tmp, ".viberoots", "current"));

    const roots = resolveWorkspaceRootsSync({ start: tmp, env: { WORKSPACE_ROOT: tmp } });
    assert.equal(roots.viberootsRoot, source);
    assert.equal(roots.sourceMode, "remote");
    assert.equal(roots.currentStatus, "present");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("resolveWorkspaceRootsSync honors explicit workspace and viberoots root overrides", async () => {
  const tmp = await workspace("vbr-roots-override");
  const viberoots = await realTemp("vbr-root-override-source-");
  try {
    const roots = resolveWorkspaceRootsSync({
      start: path.join(tmp, "nested"),
      env: { WORKSPACE_ROOT: tmp, VIBEROOTS_ROOT: viberoots },
    });
    assert.equal(roots.workspaceRoot, tmp);
    assert.equal(roots.viberootsRoot, viberoots);
    assert.equal(roots.sourceMode, "local");
    assert.equal(roots.currentStatus, "missing");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.rm(viberoots, { recursive: true, force: true });
  }
});

test("viberoots wrapper resolves command source from VIBEROOTS_ROOT", async () => {
  const tmp = await workspace("vbr-version-command");
  try {
    const { stdout } = await execFileAsync(
      "viberoots/build-tools/tools/bin/viberoots",
      ["version", "--json"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NO_DEV_SHELL: "1",
          WORKSPACE_ROOT: tmp,
          VIBEROOTS_ROOT: path.join(process.cwd(), "viberoots"),
        },
      },
    );
    const status = JSON.parse(String(stdout));
    assert.equal(status.sourceMode, "local");
    assert.equal(status.workspaceRoot, tmp);
    assert.equal(status.viberootsRoot, path.join(process.cwd(), "viberoots"));
    assert.equal(status.revisionSource, "git");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("vbr wrapper resolves command source from nested consumer directories", async () => {
  const tmp = await workspace("vbr-alias-command");
  try {
    const nested = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(nested, { recursive: true });
    const viberootsRoot = path.join(process.cwd(), "viberoots");
    const binDir = path.join(viberootsRoot, "build-tools", "tools", "bin");
    const { stdout } = await execFileAsync("vbr", ["version", "--json"], {
      cwd: nested,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        NO_DEV_SHELL: "1",
        WORKSPACE_ROOT: tmp,
        VIBEROOTS_ROOT: viberootsRoot,
      },
    });
    const status = JSON.parse(String(stdout));
    assert.equal(status.sourceMode, "local");
    assert.equal(status.workspaceRoot, tmp);
    assert.equal(status.viberootsRoot, viberootsRoot);
    assert.equal(status.revisionSource, "git");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("vbr develop prints relative workspace flake refs from nested consumer directories", async () => {
  const tmp = await extractedWorkspace("vbr-develop-command");
  try {
    const nested = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(nested, { recursive: true });
    const viberootsRoot = path.join(process.cwd(), "viberoots");
    const binDir = path.join(viberootsRoot, "build-tools", "tools", "bin");
    const { stdout } = await execFileAsync("vbr", ["develop", "--print", "--command", "true"], {
      cwd: nested,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        NO_DEV_SHELL: "1",
        WORKSPACE_ROOT: tmp,
        VIBEROOTS_ROOT: viberootsRoot,
      },
    });
    const command = String(stdout).trim();
    assert.equal(
      command,
      "nix develop --no-write-lock-file --accept-flake-config path:../../../.viberoots/workspace#default --override-input viberoots path:../../../viberoots --command true",
    );
    assert.doesNotMatch(command, new RegExp(tmp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(command, new RegExp(viberootsRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(await exists(path.join(nested, ".viberoots")), false);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("viberoots version reports local source mode and checked-out revision", async () => {
  const tmp = await workspace("vbr-version-local");
  try {
    const viberoots = path.join(tmp, "viberoots");
    await fsp.mkdir(path.join(tmp, ".viberoots"), { recursive: true });
    await fsp.mkdir(viberoots, { recursive: true });
    const rev = await initGitRepo(viberoots);
    await fsp.symlink("../viberoots", path.join(tmp, ".viberoots", "current"));

    const status = await runVersion(tmp, { VIBEROOTS_ROOT: "" });
    assert.equal(status.sourceMode, "local");
    assert.equal(status.viberootsRoot, viberoots);
    assert.equal(status.revision, rev);
    assert.equal(status.revisionSource, "git");
    assert.equal(status.dirtyState, "clean");
    assert.equal(status.currentPointsToLiveCheckout, true);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("viberoots version reports dirty local source mode", async () => {
  const tmp = await workspace("vbr-version-dirty");
  try {
    const viberoots = path.join(tmp, "viberoots");
    await fsp.mkdir(path.join(tmp, ".viberoots"), { recursive: true });
    await fsp.mkdir(viberoots, { recursive: true });
    await initGitRepo(viberoots);
    await fsp.writeFile(path.join(viberoots, "dirty.txt"), "dirty\n", "utf8");
    await fsp.symlink("../viberoots", path.join(tmp, ".viberoots", "current"));

    const status = await runVersion(tmp, { VIBEROOTS_ROOT: "" });
    assert.equal(status.sourceMode, "local");
    assert.equal(status.dirtyState, "dirty");
    assert.equal(status.revisionSource, "git");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("viberoots version reports missing current symlink", async () => {
  const tmp = await workspace("vbr-version-missing");
  try {
    const status = await runVersion(tmp, { VIBEROOTS_ROOT: "" });
    assert.equal(status.sourceMode, "local");
    assert.equal(status.viberootsRoot, tmp);
    assert.equal(status.currentStatus, "missing");
    assert.equal(status.currentPointsToLiveCheckout, false);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("viberoots version reports remote-shaped source and locked revision", async () => {
  const tmp = await workspace("vbr-version-remote");
  try {
    const source = path.join(tmp, "nix", "store", "abc-viberoots-source");
    const lockedRev = "0123456789abcdef0123456789abcdef01234567";
    await fsp.mkdir(path.join(tmp, ".viberoots"), { recursive: true });
    await fsp.mkdir(source, { recursive: true });
    await fsp.symlink(source, path.join(tmp, ".viberoots", "current"));
    await fsp.writeFile(
      path.join(tmp, "flake.lock"),
      JSON.stringify({ nodes: { viberoots: { locked: { rev: lockedRev } } } }, null, 2) + "\n",
      "utf8",
    );

    const status = await runVersion(tmp, { VIBEROOTS_ROOT: "" });
    assert.equal(status.sourceMode, "remote");
    assert.equal(status.viberootsRoot, source);
    assert.equal(status.revision, lockedRev);
    assert.equal(status.revisionSource, "flake-lock");
    assert.equal(status.dirtyState, "not-applicable");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
