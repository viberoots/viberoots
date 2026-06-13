import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { activateWorkspace } from "../../lib/workspace-activation";

const execFileAsync = promisify(execFile);
const COMMAND = "build-tools/tools/dev/viberoots.ts";

async function workspace(prefix: string, localInput = true): Promise<string> {
  const tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  const flake = localInput
    ? '{ inputs.viberoots.url = "path:./viberoots"; outputs = _: {}; }\n'
    : "{ outputs = _: {}; }\n";
  await fsp.writeFile(path.join(tmp, "flake.nix"), flake, "utf8");
  await fsp.writeFile(path.join(tmp, ".buckroot"), ".\n", "utf8");
  return tmp;
}

async function makeSource(root: string, rel = "viberoots"): Promise<string> {
  const source = path.join(root, rel);
  await fsp.mkdir(source, { recursive: true });
  await fsp.writeFile(path.join(source, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  return source;
}

async function readlink(root: string): Promise<string> {
  return await fsp.readlink(path.join(root, ".viberoots", "current"));
}

async function runInit(root: string, args: string[] = []) {
  const { stdout } = await execFileAsync(
    "zx-wrapper",
    [COMMAND, "init-workspace", "--json", ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, WORKSPACE_ROOT: root, VIBEROOTS_ROOT: "", NO_DEV_SHELL: "1" },
    },
  );
  return JSON.parse(String(stdout));
}

test("init-workspace creates local current symlink and workspace state dirs", async () => {
  const root = await workspace("vbr-activate-local");
  try {
    const flakeBefore = await fsp.readFile(path.join(root, "flake.nix"), "utf8");
    await makeSource(root);

    const result = await runInit(root);

    assert.equal(result.workspaceRoot, root);
    assert.equal(await readlink(root), "../viberoots");
    assert.equal(
      await fsp.realpath(path.join(root, ".viberoots/current")),
      path.join(root, "viberoots"),
    );
    for (const rel of [".viberoots/workspace/providers", ".viberoots/workspace/buck"]) {
      assert.equal((await fsp.stat(path.join(root, rel))).isDirectory(), true);
    }
    assert.equal(await fsp.readFile(path.join(root, "flake.nix"), "utf8"), flakeBefore);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("activateWorkspace is idempotent on an already activated workspace", async () => {
  const root = await workspace("vbr-activate-idempotent");
  try {
    await makeSource(root);

    const first = await activateWorkspace({ start: root, env: { WORKSPACE_ROOT: root } });
    const firstLink = await readlink(root);
    const firstReal = await fsp.realpath(path.join(root, ".viberoots/current"));
    const second = await activateWorkspace({ start: root, env: { WORKSPACE_ROOT: root } });

    assert.deepEqual(second, first);
    assert.equal(await readlink(root), firstLink);
    assert.equal(await fsp.realpath(path.join(root, ".viberoots/current")), firstReal);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("activateWorkspace rejects stale local current symlink", async () => {
  const root = await workspace("vbr-activate-stale-local");
  try {
    await makeSource(root);
    await makeSource(root, "stale-viberoots");
    await fsp.mkdir(path.join(root, ".viberoots"), { recursive: true });
    await fsp.symlink("../stale-viberoots", path.join(root, ".viberoots", "current"));

    await assert.rejects(
      activateWorkspace({ start: root, env: { WORKSPACE_ROOT: root } }),
      /expected local viberoots/,
    );

    assert.equal(await readlink(root), "../stale-viberoots");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("activateWorkspace rejects dangling local current symlink", async () => {
  const root = await workspace("vbr-activate-dangling-local");
  try {
    await makeSource(root);
    await fsp.mkdir(path.join(root, ".viberoots"), { recursive: true });
    await fsp.symlink("../missing-viberoots", path.join(root, ".viberoots", "current"));

    await assert.rejects(
      activateWorkspace({ start: root, env: { WORKSPACE_ROOT: root } }),
      /expected local viberoots/,
    );

    assert.equal(await readlink(root), "../missing-viberoots");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("shell-entry activation touches only ignored activation state", async () => {
  const root = await workspace("vbr-activate-shell-entry");
  try {
    await makeSource(root);
    await fsp.writeFile(path.join(root, "TARGETS"), "# product file\n", "utf8");
    const flakeBefore = await fsp.readFile(path.join(root, "flake.nix"), "utf8");
    const targetsBefore = await fsp.readFile(path.join(root, "TARGETS"), "utf8");

    await activateWorkspace({ start: root, env: { WORKSPACE_ROOT: root }, shellEntry: true });

    assert.equal(await readlink(root), "../viberoots");
    assert.equal((await fsp.stat(path.join(root, ".viberoots/cache"))).isDirectory(), true);
    await assert.rejects(fsp.stat(path.join(root, ".viberoots/workspace/providers")));
    assert.equal(await fsp.readFile(path.join(root, "flake.nix"), "utf8"), flakeBefore);
    assert.equal(await fsp.readFile(path.join(root, "TARGETS"), "utf8"), targetsBefore);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("init-workspace points current at a remote-shaped source path", async () => {
  const root = await workspace("vbr-activate-remote", false);
  const source = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "nix-store-vbr-source-")),
  );
  try {
    await fsp.writeFile(path.join(source, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");

    await runInit(root, ["--source", source]);

    assert.equal(await fsp.realpath(path.join(root, ".viberoots/current")), source);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(source, { recursive: true, force: true });
  }
});

test("activateWorkspace fails with targeted setup errors", async () => {
  const missingBuckroot = await workspace("vbr-activate-no-buckroot");
  const missingFlake = await workspace("vbr-activate-no-source");
  try {
    await fsp.rm(path.join(missingBuckroot, ".buckroot"));
    await assert.rejects(
      activateWorkspace({ start: missingBuckroot, env: { WORKSPACE_ROOT: missingBuckroot } }),
      /requires \.buckroot/,
    );
    await assert.rejects(
      activateWorkspace({ start: missingFlake, env: { WORKSPACE_ROOT: missingFlake } }),
      /missing flake\.nix/,
    );
  } finally {
    await fsp.rm(missingBuckroot, { recursive: true, force: true });
    await fsp.rm(missingFlake, { recursive: true, force: true });
  }
});

test("activateWorkspace reports stale buck cell paths", async () => {
  const root = await workspace("vbr-activate-buckconfig");
  try {
    await makeSource(root);
    await fsp.writeFile(
      path.join(root, ".buckconfig"),
      "[cells]\nviberoots = ./.viberoots/current\nprelude = ./.viberoots/current/prelude\n",
      "utf8",
    );
    await assert.rejects(
      activateWorkspace({ start: root, env: { WORKSPACE_ROOT: root } }),
      /missing viberoots cell path/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("activation does not make current a tool installation search path", async () => {
  const root = await workspace("vbr-activate-no-tools");
  try {
    const source = await makeSource(root);
    await fsp.mkdir(path.join(source, "bin"), { recursive: true });
    await fsp.writeFile(path.join(source, "bin", "vbr-fake-tool"), "#!/usr/bin/env bash\n", {
      mode: 0o755,
    });
    await activateWorkspace({ start: root, env: { WORKSPACE_ROOT: root, PATH: "/usr/bin:/bin" } });

    assert.throws(
      () => resolveToolPathSync("vbr-fake-tool", { PATH: "/usr/bin:/bin" }),
      /required tool not found on PATH/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
