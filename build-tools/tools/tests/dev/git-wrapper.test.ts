#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const wrapper = path.join(repoRoot, "build-tools", "tools", "bin", "git");
const scratchRoot = path.join(repoRoot, "buck-out", "tmp");

async function writeExecutable(file: string, text: string): Promise<void> {
  await fsp.writeFile(file, text, "utf8");
  await fsp.chmod(file, 0o755);
}

async function realGit(): Promise<string> {
  const filteredPath = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter((entry) => path.resolve(entry || ".") !== path.dirname(wrapper))
    .join(path.delimiter);
  const out = await $({
    stdio: "pipe",
    env: { ...process.env, PATH: filteredPath },
  })`bash --noprofile --norc -c 'type -a -p git'`;
  const candidates = String(out.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return candidates.find((candidate) => candidate.startsWith("/nix/store/")) || candidates[0] || "";
}

async function initRepo(root: string, gitPath: string): Promise<void> {
  await $({ cwd: root, stdio: "pipe" })`${gitPath} init -q`;
  await $({ cwd: root, stdio: "pipe" })`${gitPath} config user.email test@example.com`;
  await $({ cwd: root, stdio: "pipe" })`${gitPath} config user.name Test`;
  await fsp.writeFile(path.join(root, "tracked.txt"), "tracked\n", "utf8");
  await fsp.mkdir(path.join(root, "dir"));
  await fsp.writeFile(path.join(root, "dir", ".hidden"), "hidden\n", "utf8");
  await $({ cwd: root, stdio: "pipe" })`${gitPath} add tracked.txt dir/.hidden`;
  await $({ cwd: root, stdio: "pipe" })`${gitPath} commit -qm initial`;
}

test("git wrapper delegates unsupported commands to the configured real git", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "git-wrapper-"));
  try {
    const fakeGit = path.join(tmp, "real-git");
    const log = path.join(tmp, "git.log");
    await writeExecutable(
      fakeGit,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$BNX_FAKE_GIT_LOG"
`,
    );

    const res = await $({
      cwd: repoRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        BNX_REAL_GIT: fakeGit,
        BNX_FAKE_GIT_LOG: log,
        PATH: `${path.dirname(wrapper)}:${process.env.PATH || ""}`,
      },
    })`${wrapper} status --short`;

    assert.equal(res.exitCode, 0);
    assert.equal((await fsp.readFile(log, "utf8")).trim(), "status --short");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("git wrapper delegates unsupported worktree add forms unchanged", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "git-wrapper-"));
  try {
    const fakeGit = path.join(tmp, "real-git");
    const log = path.join(tmp, "git.log");
    await writeExecutable(
      fakeGit,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$BNX_FAKE_GIT_LOG"
`,
    );

    const res = await $({
      cwd: repoRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        BNX_REAL_GIT: fakeGit,
        BNX_FAKE_GIT_LOG: log,
      },
    })`${wrapper} worktree add --checkout ../wt main`;

    assert.equal(res.exitCode, 0);
    assert.equal((await fsp.readFile(log, "utf8")).trim(), "worktree add --checkout ../wt main");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("git wrapper preserves linked-worktree .git while copying tracked and untracked files", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "git-wrapper-"));
  const gitPath = await realGit();
  try {
    const source = path.join(tmp, "source");
    const target = path.join(tmp, "target");
    const copyProg = path.join(tmp, "copy-tree");
    await fsp.mkdir(source);
    await initRepo(source, gitPath);
    await fsp.writeFile(path.join(source, "untracked.txt"), "untracked\n", "utf8");
    await writeExecutable(
      copyProg,
      `#!/usr/bin/env bash
cp -R "$1" "$2"
`,
    );

    const res = await $({
      cwd: source,
      stdio: "pipe",
      env: {
        ...process.env,
        BNX_REAL_GIT: gitPath,
        BNX_GIT_COW_COPY_PROG_FOR_TEST: copyProg,
      },
    })`${wrapper} worktree add ${target} HEAD`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const dotGit = await fsp.stat(path.join(target, ".git"));
    assert.equal(dotGit.isFile(), true);
    assert.match(await fsp.readFile(path.join(target, ".git"), "utf8"), /^gitdir: /);
    await assert.rejects(fsp.stat(path.join(target, ".git", "config")));
    assert.equal(await fsp.readFile(path.join(target, "tracked.txt"), "utf8"), "tracked\n");
    assert.equal(await fsp.readFile(path.join(target, "dir", ".hidden"), "utf8"), "hidden\n");
    assert.equal(await fsp.readFile(path.join(target, "untracked.txt"), "utf8"), "untracked\n");

    const status = await $({ cwd: target, stdio: "pipe" })`${gitPath} status --porcelain`;
    assert.doesNotMatch(String(status.stdout), /(^|\n).. tracked\.txt(\n|$)/);
    assert.match(String(status.stdout), /\?\? untracked\.txt/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("git wrapper removes partial worktrees when CoW copy fails", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "git-wrapper-"));
  const gitPath = await realGit();
  try {
    const source = path.join(tmp, "source");
    const target = path.join(tmp, "target");
    const copyProg = path.join(tmp, "copy-fail");
    await fsp.mkdir(source);
    await initRepo(source, gitPath);
    await writeExecutable(
      copyProg,
      `#!/usr/bin/env bash
exit 23
`,
    );

    const res = await $({
      cwd: source,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        BNX_REAL_GIT: gitPath,
        BNX_GIT_COW_COPY_PROG_FOR_TEST: copyProg,
      },
    })`${wrapper} worktree add ${target} HEAD`;

    assert.equal(res.exitCode, 23);
    await assert.rejects(fsp.stat(target));
    const worktrees = await $({ cwd: source, stdio: "pipe" })`${gitPath} worktree list --porcelain`;
    assert.doesNotMatch(
      String(worktrees.stdout),
      new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    const entries = await fsp.readdir(tmp);
    assert.equal(
      entries.some((entry) => entry.startsWith(".git-cow-stage.")),
      false,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
