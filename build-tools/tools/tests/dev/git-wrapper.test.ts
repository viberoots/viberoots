#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  initRepo,
  realGit,
  repoRoot,
  scratchRoot,
  wrapper,
  writeExecutable,
} from "./git-wrapper-test-helpers.ts";

test("git wrapper delegates unsupported commands to the configured real git", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "git-wrapper-"));
  try {
    const fakeGit = path.join(tmp, "real-git");
    const log = path.join(tmp, "git.log");
    await writeExecutable(
      fakeGit,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$VBR_FAKE_GIT_LOG"
`,
    );

    const res = await $({
      cwd: repoRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        VBR_REAL_GIT: fakeGit,
        VBR_FAKE_GIT_LOG: log,
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
printf '%s\\n' "$*" >> "$VBR_FAKE_GIT_LOG"
`,
    );

    const res = await $({
      cwd: repoRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        VBR_REAL_GIT: fakeGit,
        VBR_FAKE_GIT_LOG: log,
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
        VBR_REAL_GIT: gitPath,
        VBR_GIT_COW_COPY_PROG_FOR_TEST: copyProg,
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

test("git wrapper manifests tracked and non-ignored untracked files only", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "git-wrapper-"));
  const gitPath = await realGit();
  try {
    const source = path.join(tmp, "source");
    const target = path.join(tmp, "target");
    const copyProg = path.join(tmp, "copy-manifest");
    const manifestLog = path.join(tmp, "manifest.log");
    await fsp.mkdir(source);
    await initRepo(source, gitPath);
    await fsp.writeFile(path.join(source, ".gitignore"), "buck-out/\nignored-output/\n", "utf8");
    await $({ cwd: source, stdio: "pipe" })`${gitPath} add .gitignore`;
    await $({ cwd: source, stdio: "pipe" })`${gitPath} commit -qm ignore-output`;
    await fsp.writeFile(path.join(source, "untracked.txt"), "untracked\n", "utf8");
    await fsp.mkdir(path.join(source, "buck-out"), { recursive: true });
    await fsp.writeFile(path.join(source, "buck-out", "cache.txt"), "cache\n", "utf8");
    await fsp.mkdir(path.join(source, "ignored-output"), { recursive: true });
    await fsp.writeFile(path.join(source, "ignored-output", "cache.txt"), "cache\n", "utf8");
    await fsp.mkdir(path.join(source, ".codex", "worktrees", "old-agent"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(source, ".codex", "worktrees", "old-agent", "sentinel.txt"),
      "old worktree\n",
      "utf8",
    );
    await writeExecutable(
      copyProg,
      `#!/usr/bin/env bash
python3 - "$3" "$VBR_MANIFEST_LOG" <<'PY'
import pathlib
import sys

manifest = pathlib.Path(sys.argv[1])
log = pathlib.Path(sys.argv[2])
items = [raw.decode("utf-8", "surrogateescape") for raw in manifest.read_bytes().split(b"\\0") if raw]
log.write_text("\\n".join(items) + "\\n", encoding="utf-8")
PY
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
        VBR_REAL_GIT: gitPath,
        VBR_GIT_COW_COPY_PROG_FOR_TEST: copyProg,
        VBR_MANIFEST_LOG: manifestLog,
      },
    })`${wrapper} worktree add ${target} HEAD`;

    assert.equal(res.exitCode, 23);
    const entries = (await fsp.readFile(manifestLog, "utf8")).trim().split("\n").sort();
    assert(entries.includes(".gitignore"));
    assert(entries.includes("tracked.txt"));
    assert(entries.includes("dir/.hidden"));
    assert(entries.includes("untracked.txt"));
    assert(!entries.includes("buck-out/cache.txt"));
    assert(!entries.includes("ignored-output/cache.txt"));
    assert(!entries.includes(".codex/worktrees/old-agent/sentinel.txt"));
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
        VBR_REAL_GIT: gitPath,
        VBR_GIT_COW_COPY_PROG_FOR_TEST: copyProg,
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
