#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { validateStartupWorkspaceState } from "../../dev/startup-check/workspace-state";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return String(stdout || "").trim();
}

async function workspace(prefix: string): Promise<string> {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  await fsp.writeFile(path.join(root, ".buckroot"), ".\n", "utf8");
  await fsp.mkdir(path.join(root, ".viberoots"), { recursive: true });
  await fsp.symlink("../viberoots", path.join(root, ".viberoots", "current"));
  await fsp.writeFile(
    path.join(root, ".buckconfig"),
    "[cells]\nprelude = ./.viberoots/current/prelude\n[repositories]\nprelude = ./.viberoots/current/prelude\n",
    "utf8",
  );
  await fsp.mkdir(path.join(root, "viberoots", "prelude"), { recursive: true });
  await fsp.writeFile(
    path.join(root, "viberoots", "prelude", "prelude.bzl"),
    "# prelude\n",
    "utf8",
  );
  return root;
}

async function writeFile(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text, "utf8");
}

async function commitAll(root: string, message: string): Promise<string> {
  await git(root, ["add", "-A"]);
  await git(root, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    message,
  ]);
  return await git(root, ["rev-parse", "HEAD"]);
}

async function captureWarningOutput(fn: () => Promise<void>): Promise<string> {
  const oldWarn = console.warn;
  const oldWrite = process.stderr.write;
  const chunks: string[] = [];
  console.warn = (message?: unknown) => {
    chunks.push(String(message || ""));
  };
  process.stderr.write = ((chunk: unknown, ..._args: unknown[]) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || ""));
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    console.warn = oldWarn;
    process.stderr.write = oldWrite;
  }
  return chunks.join("\n");
}

async function submoduleWorkspace(prefix: string): Promise<{ root: string; submodule: string }> {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  const submodule = path.join(root, "viberoots");
  await fsp.mkdir(path.join(root, ".viberoots"), { recursive: true });
  await fsp.symlink("../viberoots", path.join(root, ".viberoots", "current"));
  await writeFile(path.join(root, ".buckroot"), ".\n");
  await writeFile(
    path.join(root, ".buckconfig"),
    [
      "[cells]",
      "prelude = ./.viberoots/current/prelude",
      "[repositories]",
      "prelude = ./.viberoots/current/prelude",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, ".viberoots", "workspace", "flake.nix"),
    `{ inputs.viberoots.url = "path:${submodule}"; outputs = _: {}; }\n`,
  );
  await writeFile(
    path.join(root, ".viberoots", "workspace", "flake.lock"),
    JSON.stringify({
      nodes: {
        viberoots: {
          locked: { type: "path", path: submodule },
          original: { type: "path", path: submodule },
        },
      },
    }),
  );
  await fsp.mkdir(submodule, { recursive: true });
  await git(submodule, ["init", "-q"]);
  await writeFile(path.join(submodule, "flake.nix"), "{ outputs = _: {}; }\n");
  await writeFile(path.join(submodule, "prelude", "prelude.bzl"), "# prelude\n");
  await commitAll(submodule, "submodule init");
  await git(root, ["init", "-q"]);
  await writeFile(
    path.join(root, ".gitmodules"),
    '[submodule "viberoots"]\n\tpath = viberoots\n\turl = ../viberoots\n',
  );
  await commitAll(root, "parent init");
  return { root, submodule };
}

test("startup-check strict extraction blocker mode fails on old root layout", async () => {
  const root = await workspace("vbr-startup-extraction");
  const oldCwd = process.cwd();
  const oldStrict = process.env.VIBEROOTS_STRICT_EXTRACTION_BLOCKERS;
  try {
    await fsp.mkdir(path.join(root, "build-tools"), { recursive: true });
    process.chdir(root);
    process.env.VIBEROOTS_STRICT_EXTRACTION_BLOCKERS = "1";

    await assert.rejects(validateStartupWorkspaceState(), (e) => {
      assert.match(String((e as Error).message), /extraction old-layout blockers remain/);
      assert.match(String((e as Error).message), /path: build-tools/);
      return true;
    });
  } finally {
    process.chdir(oldCwd);
    if (oldStrict === undefined) delete process.env.VIBEROOTS_STRICT_EXTRACTION_BLOCKERS;
    else process.env.VIBEROOTS_STRICT_EXTRACTION_BLOCKERS = oldStrict;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("startup-check accepts a clean local viberoots submodule gitlink", async () => {
  const { root } = await submoduleWorkspace("vbr-startup-submodule-clean");
  const oldCwd = process.cwd();
  try {
    process.chdir(root);
    await validateStartupWorkspaceState();
  } finally {
    process.chdir(oldCwd);
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("startup-check accepts workspace lock resolved through VIBEROOTS_SOURCE_ROOT", async () => {
  const { root, submodule } = await submoduleWorkspace("vbr-startup-source-root-lock");
  const oldCwd = process.cwd();
  const oldSourceRoot = process.env.VIBEROOTS_SOURCE_ROOT;
  try {
    await writeFile(
      path.join(root, ".viberoots", "workspace", "flake.nix"),
      `{ inputs.viberoots.url = "path:${submodule}"; outputs = _: {}; }\n`,
    );
    await writeFile(
      path.join(root, ".viberoots", "workspace", "flake.lock"),
      JSON.stringify({
        nodes: {
          viberoots: {
            locked: { type: "path", path: submodule },
            original: { type: "path", path: submodule },
          },
        },
      }),
    );
    process.chdir(root);
    process.env.VIBEROOTS_SOURCE_ROOT = submodule;
    await validateStartupWorkspaceState();
  } finally {
    if (oldSourceRoot === undefined) delete process.env.VIBEROOTS_SOURCE_ROOT;
    else process.env.VIBEROOTS_SOURCE_ROOT = oldSourceRoot;
    process.chdir(oldCwd);
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("startup-check accepts hidden workspace lock paths relative to the hidden flake", async () => {
  const { root, submodule } = await submoduleWorkspace("vbr-startup-hidden-lock-relative");
  const oldCwd = process.cwd();
  try {
    await writeFile(
      path.join(root, ".viberoots", "workspace", "flake.nix"),
      `{ inputs.viberoots.url = "path:../../viberoots"; outputs = _: {}; }\n`,
    );
    await writeFile(
      path.join(root, ".viberoots", "workspace", "flake.lock"),
      JSON.stringify({
        nodes: {
          viberoots: {
            locked: { type: "path", path: submodule },
            original: { type: "path", path: "../../viberoots" },
          },
        },
      }),
    );
    process.chdir(root);
    await validateStartupWorkspaceState();
  } finally {
    process.chdir(oldCwd);
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("startup-check warns but allows dirty local viberoots submodule", async () => {
  const { root, submodule } = await submoduleWorkspace("vbr-startup-submodule-dirty");
  const oldCwd = process.cwd();
  try {
    await writeFile(path.join(submodule, "dirty.txt"), "dirty\n");
    process.chdir(root);
    const warnings = await captureWarningOutput(validateStartupWorkspaceState);
    assert.match(warnings, /submodule has uncommitted changes/);
  } finally {
    process.chdir(oldCwd);
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("startup-check strict mode rejects dirty local viberoots submodule", async () => {
  const { root, submodule } = await submoduleWorkspace("vbr-startup-submodule-dirty-strict");
  const oldCwd = process.cwd();
  const oldStrict = process.env.VIBEROOTS_STRICT_SUBMODULE_STATE;
  try {
    await writeFile(path.join(submodule, "dirty.txt"), "dirty\n");
    process.chdir(root);
    process.env.VIBEROOTS_STRICT_SUBMODULE_STATE = "1";
    await assert.rejects(validateStartupWorkspaceState(), /submodule has uncommitted changes/);
  } finally {
    if (oldStrict === undefined) delete process.env.VIBEROOTS_STRICT_SUBMODULE_STATE;
    else process.env.VIBEROOTS_STRICT_SUBMODULE_STATE = oldStrict;
    process.chdir(oldCwd);
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("startup-check rejects misaligned local viberoots flake lock", async () => {
  const { root } = await submoduleWorkspace("vbr-startup-lock-mismatch");
  const oldCwd = process.cwd();
  try {
    await writeFile(
      path.join(root, ".viberoots", "workspace", "flake.lock"),
      JSON.stringify({
        nodes: {
          viberoots: {
            locked: { type: "git", url: "https://example.invalid/viberoots.git" },
            original: { type: "git", url: "https://example.invalid/viberoots.git" },
          },
        },
      }),
    );
    process.chdir(root);
    await assert.rejects(
      validateStartupWorkspaceState(),
      /workspace flake\.lock is not aligned with local viberoots input/,
    );
  } finally {
    process.chdir(oldCwd);
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("startup-check warns but allows local viberoots checkout without parent gitlink", async () => {
  const { root } = await submoduleWorkspace("vbr-startup-local-checkout");
  const oldCwd = process.cwd();
  try {
    await git(root, ["rm", "--cached", "viberoots"]);
    process.chdir(root);
    const warnings = await captureWarningOutput(validateStartupWorkspaceState);
    assert.match(warnings, /not recorded as a git submodule gitlink/);
  } finally {
    process.chdir(oldCwd);
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("startup-check strict mode rejects local viberoots checkout without parent gitlink", async () => {
  const { root } = await submoduleWorkspace("vbr-startup-local-checkout-strict");
  const oldCwd = process.cwd();
  const oldStrict = process.env.VIBEROOTS_STRICT_SUBMODULE_STATE;
  try {
    await git(root, ["rm", "--cached", "viberoots"]);
    process.chdir(root);
    process.env.VIBEROOTS_STRICT_SUBMODULE_STATE = "1";
    await assert.rejects(
      validateStartupWorkspaceState(),
      /not recorded as a git submodule gitlink/,
    );
  } finally {
    if (oldStrict === undefined) delete process.env.VIBEROOTS_STRICT_SUBMODULE_STATE;
    else process.env.VIBEROOTS_STRICT_SUBMODULE_STATE = oldStrict;
    process.chdir(oldCwd);
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("startup-check warns but allows gitlink-mismatched local viberoots submodule", async () => {
  const { root, submodule } = await submoduleWorkspace("vbr-startup-submodule-mismatch");
  const oldCwd = process.cwd();
  try {
    await writeFile(path.join(submodule, "next.txt"), "next\n");
    await commitAll(submodule, "submodule next");
    process.chdir(root);
    const warnings = await captureWarningOutput(validateStartupWorkspaceState);
    assert.match(warnings, /does not match parent gitlink/);
  } finally {
    process.chdir(oldCwd);
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("startup-check strict mode rejects gitlink-mismatched local viberoots submodule", async () => {
  const { root, submodule } = await submoduleWorkspace("vbr-startup-submodule-mismatch-strict");
  const oldCwd = process.cwd();
  const oldStrict = process.env.VIBEROOTS_STRICT_SUBMODULE_STATE;
  try {
    await writeFile(path.join(submodule, "next.txt"), "next\n");
    await commitAll(submodule, "submodule next");
    process.chdir(root);
    process.env.VIBEROOTS_STRICT_SUBMODULE_STATE = "1";
    await assert.rejects(validateStartupWorkspaceState(), /does not match parent gitlink/);
  } finally {
    if (oldStrict === undefined) delete process.env.VIBEROOTS_STRICT_SUBMODULE_STATE;
    else process.env.VIBEROOTS_STRICT_SUBMODULE_STATE = oldStrict;
    process.chdir(oldCwd);
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("startup-check rejects uninitialized local viberoots submodule", async () => {
  const { root } = await submoduleWorkspace("vbr-startup-submodule-missing");
  const oldCwd = process.cwd();
  try {
    await fsp.rm(path.join(root, "viberoots"), { recursive: true, force: true });
    await fsp.mkdir(path.join(root, "viberoots"), { recursive: true });
    process.chdir(root);
    await assert.rejects(validateStartupWorkspaceState(), /submodule is missing or uninitialized/);
  } finally {
    process.chdir(oldCwd);
    await fsp.rm(root, { recursive: true, force: true });
  }
});
