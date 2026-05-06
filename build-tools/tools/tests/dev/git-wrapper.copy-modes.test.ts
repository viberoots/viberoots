#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const wrapper = path.join(repoRoot, "build-tools", "tools", "bin", "git");
const scratchRoot = path.join(repoRoot, "buck-out", "tmp");

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
  await fsp.writeFile(path.join(root, ".gitignore"), "buck-out/\n", "utf8");
  await fsp.writeFile(path.join(root, "tracked.txt"), "tracked\n", "utf8");
  await $({ cwd: root, stdio: "pipe" })`${gitPath} add .gitignore tracked.txt`;
  await $({ cwd: root, stdio: "pipe" })`${gitPath} commit -qm initial`;
}

async function buildApfsCloneChecker(tmp: string): Promise<string> {
  const source = path.join(tmp, "apfs-clone-checker.c");
  const binary = path.join(tmp, "apfs-clone-checker");
  await fsp.writeFile(
    source,
    String.raw`
#include <sys/attr.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

typedef struct __attribute__((packed)) {
  uint32_t length;
  attribute_set_t returned;
  uint64_t cloneid;
} clone_attrs_t;

static int clone_id(const char *path, uint64_t *out) {
  struct attrlist attrs;
  memset(&attrs, 0, sizeof(attrs));
  attrs.bitmapcount = ATTR_BIT_MAP_COUNT;
  attrs.commonattr = ATTR_CMN_RETURNED_ATTRS;
  attrs.forkattr = ATTR_CMNEXT_CLONEID;

  clone_attrs_t buf;
  memset(&buf, 0, sizeof(buf));
  if (getattrlist(path, &attrs, &buf, sizeof(buf), FSOPT_ATTR_CMN_EXTENDED) != 0) {
    perror(path);
    return 2;
  }
  if ((buf.returned.forkattr & ATTR_CMNEXT_CLONEID) == 0) {
    fprintf(stderr, "%s: ATTR_CMNEXT_CLONEID unavailable\n", path);
    return 3;
  }
  *out = buf.cloneid;
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: %s SOURCE CLONE\n", argv[0]);
    return 2;
  }
  uint64_t a = 0, b = 0;
  int rc = clone_id(argv[1], &a);
  if (rc != 0) return rc;
  rc = clone_id(argv[2], &b);
  if (rc != 0) return rc;
  puts((a != 0 && a == b) ? "1" : "0");
  return 0;
}
`,
    "utf8",
  );
  await $({
    stdio: "pipe",
    env: { ...process.env, TMPDIR: tmp },
  })`clang -Wall -Wextra -O2 -o ${binary} ${source}`;
  return binary;
}

test("git wrapper Darwin path creates an actual APFS CoW clone", async () => {
  if (process.platform !== "darwin") return;

  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "git-wrapper-"));
  const gitPath = await realGit();
  try {
    const source = path.join(tmp, "source");
    const target = path.join(source, ".claude", "worktrees", "target");
    const plainCopy = path.join(tmp, "plain-copy.bin");
    const marker = path.join(source, "large-untracked.bin");
    const cloneChecker = await buildApfsCloneChecker(tmp);
    await fsp.mkdir(source);
    await initRepo(source, gitPath);
    await fsp.mkdir(path.join(source, ".codex", "worktrees", "old-agent"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(source, ".codex", "worktrees", "old-agent", "sentinel.txt"),
      "old worktree\n",
      "utf8",
    );
    await fsp.mkdir(path.join(source, "buck-out"), { recursive: true });
    await fsp.writeFile(path.join(source, "buck-out", "cache.txt"), "cache\n", "utf8");
    await $({ stdio: "pipe" })`dd if=/dev/urandom of=${marker} bs=1048576 count=16`;

    const res = await $({
      cwd: source,
      stdio: "pipe",
      env: {
        ...process.env,
        BNX_REAL_GIT: gitPath,
        BNX_GIT_COW_OSTYPE: "darwin-test",
      },
    })`${wrapper} worktree add ${target} HEAD`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    await $({ stdio: "pipe" })`/bin/cp ${marker} ${plainCopy}`;

    await $({ stdio: "pipe" })`cmp -s ${path.join(target, "large-untracked.bin")} ${marker}`;
    const cloned = await $({
      stdio: "pipe",
    })`${cloneChecker} ${marker} ${path.join(target, "large-untracked.bin")}`;
    const copied = await $({ stdio: "pipe" })`${cloneChecker} ${marker} ${plainCopy}`;
    assert.equal(
      String(cloned.stdout).trim(),
      "1",
      "expected worktree file to share an APFS clone-id with the source",
    );
    assert.equal(
      String(copied.stdout).trim(),
      "0",
      "expected plain /bin/cp file not to share the APFS clone-id",
    );
    await assert.rejects(
      fsp.stat(path.join(target, ".codex", "worktrees", "old-agent", "sentinel.txt")),
      /ENOENT/,
      "expected generated agent worktree roots not to be recursively copied",
    );
    await assert.rejects(
      fsp.stat(path.join(target, "buck-out", "cache.txt")),
      /ENOENT/,
      "expected ignored cache output not to be copied",
    );
  } finally {
    await $({ stdio: "pipe", reject: false, nothrow: true })`chmod -R u+w ${tmp}`;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("git wrapper Linux path creates direct reflink CoW copies", async () => {
  if (process.platform !== "linux") return;

  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "git-wrapper-"));
  const gitPath = await realGit();
  try {
    const source = path.join(tmp, "source");
    const target = path.join(tmp, "target");
    const marker = path.join(source, "large-untracked.bin");
    await fsp.mkdir(source);
    await initRepo(source, gitPath);
    await fsp.mkdir(path.join(source, ".codex", "worktrees", "old-agent"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(source, ".codex", "worktrees", "old-agent", "sentinel.txt"),
      "old worktree\n",
      "utf8",
    );
    await fsp.mkdir(path.join(source, "buck-out"), { recursive: true });
    await fsp.writeFile(path.join(source, "buck-out", "cache.txt"), "cache\n", "utf8");
    await $({ stdio: "pipe" })`dd if=/dev/urandom of=${marker} bs=1048576 count=16`;

    const res = await $({
      cwd: source,
      stdio: "pipe",
      env: {
        ...process.env,
        BNX_REAL_GIT: gitPath,
        BNX_GIT_COW_OSTYPE: "linux-test",
      },
    })`${wrapper} worktree add ${target} HEAD`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    assert.equal(await fsp.readFile(path.join(target, "tracked.txt"), "utf8"), "tracked\n");
    await $({ stdio: "pipe" })`cmp -s ${path.join(target, "large-untracked.bin")} ${marker}`;
    await assert.rejects(
      fsp.stat(path.join(target, ".codex", "worktrees", "old-agent", "sentinel.txt")),
      /ENOENT/,
      "expected generated agent worktree roots not to be recursively copied",
    );
    await assert.rejects(
      fsp.stat(path.join(target, "buck-out", "cache.txt")),
      /ENOENT/,
      "expected ignored cache output not to be copied",
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
