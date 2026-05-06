#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  escapeRegExp,
  makeFakeAgentTools,
  repoRoot,
  scratchRoot,
} from "./agent-wrapper-test-helpers.ts";

const wrapper = path.join(repoRoot, "build-tools", "tools", "bin", "claude");
const makeFakeTools = (tmp: string, gitRoot: string) => makeFakeAgentTools(tmp, gitRoot, "claude");
test("claude --remove-all-worktrees removes every valid named worktree", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const alpha = path.join(gitRoot, ".claude", "worktrees", "alpha");
    const beta = path.join(gitRoot, ".claude", "worktrees", "beta");
    const stale = path.join(gitRoot, ".claude", "worktrees", "stale");
    await fsp.mkdir(alpha, { recursive: true });
    await fsp.mkdir(beta, { recursive: true });
    await fsp.mkdir(stale, { recursive: true });
    await fsp.writeFile(path.join(alpha, ".git"), "gitdir: fake\n", "utf8");
    await fsp.writeFile(path.join(beta, ".git"), "gitdir: fake\n", "utf8");
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin`,
      },
    })`${wrapper} --remove-all-worktrees`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    await assert.rejects(fsp.stat(alpha), /ENOENT/);
    await assert.rejects(fsp.stat(beta), /ENOENT/);
    assert.equal((await fsp.stat(stale)).isDirectory(), true);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, new RegExp(`git worktree remove ${escapeRegExp(alpha)}`));
    assert.match(log, new RegExp(`git worktree remove ${escapeRegExp(beta)}`));
    assert.match(log, /git branch -D worktree-alpha/);
    assert.match(log, /git branch -D worktree-beta/);
    assert.doesNotMatch(log, /worktree-stale/);
    assert.doesNotMatch(log, /claude /);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("claude --remove-all-worktrees ignores appended launch arguments", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const alpha = path.join(gitRoot, ".claude", "worktrees", "alpha");
    await fsp.mkdir(alpha, { recursive: true });
    await fsp.writeFile(path.join(alpha, ".git"), "gitdir: fake\n", "utf8");
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin`,
      },
    })`${wrapper} --remove-all-worktrees --settings injected --help`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    await assert.rejects(fsp.stat(alpha), /ENOENT/);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, new RegExp(`git worktree remove ${escapeRegExp(alpha)}`));
    assert.match(log, /git branch -D worktree-alpha/);
    assert.doesNotMatch(log, /claude /);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
