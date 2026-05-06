#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const wrapper = path.join(repoRoot, "build-tools", "tools", "bin", "cd-worktree");
const scratchRoot = path.join(repoRoot, "buck-out", "tmp");

async function writeExecutable(file: string, text: string): Promise<void> {
  await fsp.writeFile(file, text, "utf8");
  await fsp.chmod(file, 0o755);
}

async function makeFakeGit(tmp: string, gitRoot: string): Promise<string> {
  const bin = path.join(tmp, "bin");
  await fsp.mkdir(bin, { recursive: true });
  await writeExecutable(
    path.join(bin, "git"),
    `#!/usr/bin/env bash
if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then
  printf '%s\\n' "${gitRoot}"
  exit 0
fi
if [ "$1" = "-C" ]; then
  workdir="$2"
  shift 2
  if [ "$1" = "rev-parse" ] && [ "$2" = "--is-inside-work-tree" ]; then
    [ -e "$workdir/.git" ]
    exit $?
  fi
fi
exit 1
`,
  );
  return bin;
}

test("cd-worktree --print resolves a named Claude worktree", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "cd-worktree-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const worktree = path.join(gitRoot, ".claude", "worktrees", "alpha");
    await fsp.mkdir(worktree, { recursive: true });
    await fsp.writeFile(path.join(worktree, ".git"), "gitdir: fake\n", "utf8");
    const fakeBin = await makeFakeGit(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin` },
    })`${wrapper} --print alpha`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    assert.equal(String(res.stdout).trim(), worktree);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("cd-worktree reports missing and duplicate worktree names", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "cd-worktree-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const fakeBin = await makeFakeGit(tmp, gitRoot);
    await fsp.mkdir(gitRoot, { recursive: true });
    const missing = await $({
      cwd: gitRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin` },
    })`${wrapper} --print nope`;

    assert.equal(missing.exitCode, 1);
    assert.match(String(missing.stderr), /worktree not found: nope/);

    for (const kind of [".claude", ".codex"]) {
      const worktree = path.join(gitRoot, kind, "worktrees", "dupe");
      await fsp.mkdir(worktree, { recursive: true });
      await fsp.writeFile(path.join(worktree, ".git"), "gitdir: fake\n", "utf8");
    }
    const duplicate = await $({
      cwd: gitRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin` },
    })`${wrapper} --print dupe`;

    assert.equal(duplicate.exitCode, 2);
    assert.match(String(duplicate.stderr), /multiple worktrees named dupe/);

    const claude = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin` },
    })`${wrapper} --print --claude dupe`;
    assert.equal(String(claude.stdout).trim(), path.join(gitRoot, ".claude", "worktrees", "dupe"));

    const codex = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin` },
    })`${wrapper} --print --codex dupe`;
    assert.equal(String(codex.stdout).trim(), path.join(gitRoot, ".codex", "worktrees", "dupe"));

    const combined = await $({
      cwd: gitRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin` },
    })`${wrapper} --print --claude --codex dupe`;
    assert.equal(combined.exitCode, 2);
    assert.match(String(combined.stderr), /cannot be combined/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
