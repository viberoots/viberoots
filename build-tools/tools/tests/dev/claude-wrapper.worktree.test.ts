#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  binWrapper,
  escapeRegExp,
  makeFakeAgentTools,
  repoRoot,
  safehouseLaunchPattern,
  scratchRoot,
} from "./agent-wrapper-test-helpers.ts";

const wrapper = binWrapper("claude");
const makeFakeTools = (tmp: string, gitRoot: string) => makeFakeAgentTools(tmp, gitRoot, "claude");
test("claude --worktree attaches to an existing named worktree", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const worktreeRoot = path.join(gitRoot, ".claude", "worktrees", "existing-worker");
    await fsp.mkdir(worktreeRoot, { recursive: true });
    await fsp.writeFile(path.join(worktreeRoot, ".git"), "gitdir: fake\n", "utf8");
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin`,
        VBR_CLAUDE_GIT_WRAPPER_FOR_TEST: path.join(fake.bin, "git"),
      },
    })`${wrapper} --worktree existing-worker -p hello`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const worktreeRealRoot = await fsp.realpath(worktreeRoot);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.doesNotMatch(log, /git worktree add/);
    assert.match(log, new RegExp(safehouseLaunchPattern(worktreeRealRoot)));
    assert.match(log, /claude --dangerously-skip-permissions -p hello/);
    assert.doesNotMatch(log, /claude .*--worktree/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("claude --worktree recreates a missing worktree from an existing branch", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    await fsp.mkdir(gitRoot, { recursive: true });
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin`,
        VBR_CLAUDE_GIT_WRAPPER_FOR_TEST: path.join(fake.bin, "git"),
      },
    })`${wrapper} --worktree branch-only -p hello`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const worktreeRoot = path.join(gitRoot, ".claude", "worktrees", "branch-only");
    const worktreeRealRoot = await fsp.realpath(worktreeRoot);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, /git worktree add .*branch-only worktree-branch-only/);
    assert.doesNotMatch(log, /git worktree add -b worktree-branch-only/);
    assert.match(log, new RegExp(safehouseLaunchPattern(worktreeRealRoot)));
    assert.match(log, /claude --dangerously-skip-permissions -p hello/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("claude --list-worktrees prints valid named worktrees without launching", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const alpha = path.join(gitRoot, ".claude", "worktrees", "alpha");
    const stale = path.join(gitRoot, ".claude", "worktrees", "stale");
    await fsp.mkdir(alpha, { recursive: true });
    await fsp.mkdir(stale, { recursive: true });
    await fsp.writeFile(path.join(alpha, ".git"), "gitdir: fake\n", "utf8");
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin`,
      },
    })`${wrapper} --list-worktrees`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    assert.equal(String(res.stdout), `alpha\t${alpha}\n`);
    await assert.rejects(fsp.stat(fake.log), /ENOENT/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("claude --list-worktrees ignores launch arguments", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    await fsp.mkdir(gitRoot, { recursive: true });
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin`,
      },
    })`${wrapper} --list-worktrees -p hello`;

    assert.equal(res.exitCode, 0);
    assert.equal(String(res.stdout), "");
    await assert.rejects(fsp.stat(fake.log), /ENOENT/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
