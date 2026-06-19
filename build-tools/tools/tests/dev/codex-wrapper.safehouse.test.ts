#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  binWrapper,
  escapeRegExp,
  externalScratchRoot,
  makeFakeAgentTools,
  repoRoot,
  safehouseLaunchPattern,
  scratchRoot,
} from "./agent-wrapper-test-helpers.ts";

const wrapper = binWrapper("codex");
const makeFakeTools = (tmp: string, gitRoot: string) => makeFakeAgentTools(tmp, gitRoot, "codex");
test("codex --worktree creates through the CoW git wrapper and launches the worker in safehouse", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const home = path.join(tmp, "home");
    const knownHosts = path.join(home, ".ssh", "known_hosts");
    await fsp.mkdir(gitRoot, { recursive: true });
    await fsp.mkdir(path.dirname(knownHosts), { recursive: true });
    await fsp.writeFile(knownHosts, "github.com ssh-ed25519 AAAATEST\n", "utf8");
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin`,
        VBR_CODEX_GIT_WRAPPER_FOR_TEST: path.join(fake.bin, "git"),
        CODEX_HOME: path.join(home, ".codex"),
      },
    })`${wrapper} --worktree native-worker exec task`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const worktreeRoot = path.join(gitRoot, ".codex", "worktrees", "native-worker");
    const worktreeRealRoot = await fsp.realpath(worktreeRoot);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, /git worktree add -b worktree-native-worker /);
    assert.match(log, new RegExp(escapeRegExp(worktreeRoot)));
    assert.match(log, new RegExp(safehouseLaunchPattern(worktreeRealRoot)));
    assert.match(log, /safehouse .* --add-dirs=[^ ]+\/\.codex /);
    assert.match(log, new RegExp(`--add-dirs-ro=${escapeRegExp(knownHosts)}`));
    assert.match(
      log,
      new RegExp(`\\(allow file-read\\* \\(literal "${escapeRegExp(knownHosts)}"\\)\\)`),
    );
    assert.match(
      log,
      /\(allow file-read\* .* \(literal "\/etc\/bashrc"\) \(literal "\/private\/etc\/bashrc"\)/,
    );
    assert.match(log, /\(allow mach-lookup \(global-name "com\.apple\.sysmond"\)\)/);
    assert.match(log, /\(allow process-info\*\)/);
    assert.match(log, /\(allow signal\)/);
    assert.match(log, /codex --dangerously-bypass-approvals-and-sandbox exec task/);
    assert.match(log, /HOME=.*\/buck-out\/tmp\/safehouse-home/);
    assert.match(log, /CODEX_HOME=.*\/\.codex/);
    assert.doesNotMatch(log, /codex .*--worktree/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex -w is an alias for the wrapper worktree path", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-wrapper-"));
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
        VBR_CODEX_GIT_WRAPPER_FOR_TEST: path.join(fake.bin, "git"),
      },
    })`${wrapper} -w shortcut-worker exec task`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const worktreeRoot = path.join(gitRoot, ".codex", "worktrees", "shortcut-worker");
    const worktreeRealRoot = await fsp.realpath(worktreeRoot);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, /git worktree add -b worktree-shortcut-worker /);
    assert.match(log, new RegExp(safehouseLaunchPattern(worktreeRealRoot)));
    assert.match(log, /codex --dangerously-bypass-approvals-and-sandbox exec task/);
    assert.doesNotMatch(log, /^codex .*-w/m);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper runs worktree agents through safehouse with unsafe flags", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-wrapper-"));
  try {
    const worktreeRoot = path.join(tmp, ".codex", "worktrees", "worker-a");
    await fsp.mkdir(worktreeRoot, { recursive: true });
    const fake = await makeFakeTools(tmp, worktreeRoot);
    const res = await $({
      cwd: worktreeRoot,
      stdio: "pipe",
      env: { ...process.env, PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin` },
    })`${wrapper} exec task`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const worktreeRealRoot = await fsp.realpath(worktreeRoot);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, new RegExp(safehouseLaunchPattern(worktreeRealRoot)));
    assert.match(log, /codex --dangerously-bypass-approvals-and-sandbox exec task/);
    assert.match(log, /VBR_CODEX_SAFEHOUSE_ACTIVE=1/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper launches the main repo with full-access sandbox by default", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    await fsp.mkdir(gitRoot, { recursive: true });
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: { ...process.env, PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin` },
    })`${wrapper} exec parent`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.doesNotMatch(log, /safehouse /);
    assert.match(log, /codex --sandbox danger-full-access exec parent/);
    assert.doesNotMatch(log, /dangerously-bypass-approvals-and-sandbox/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper preserves an explicit sandbox argument", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    await fsp.mkdir(gitRoot, { recursive: true });
    const fake = await makeFakeTools(tmp, gitRoot);
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: { ...process.env, PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin` },
    })`${wrapper} --sandbox workspace-write exec parent`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, /codex --sandbox workspace-write exec parent/);
    assert.doesNotMatch(log, /danger-full-access/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
