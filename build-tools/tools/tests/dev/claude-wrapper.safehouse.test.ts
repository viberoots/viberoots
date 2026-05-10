#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  escapeRegExp,
  externalScratchRoot,
  makeFakeAgentTools,
  repoRoot,
  safehouseLaunchPattern,
  scratchRoot,
  writeExecutable,
} from "./agent-wrapper-test-helpers.ts";

const wrapper = path.join(repoRoot, "build-tools", "tools", "bin", "claude");
const makeFakeTools = (tmp: string, gitRoot: string) => makeFakeAgentTools(tmp, gitRoot, "claude");
test("claude worktree flags create through CoW git and launch in safehouse", async () => {
  for (const { flag, name } of [
    { flag: "--worktree", name: "native-worker" },
    { flag: "-w", name: "shortcut-worker" },
  ]) {
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
          BNX_CLAUDE_GIT_WRAPPER_FOR_TEST: path.join(fake.bin, "git"),
          CLAUDE_CONFIG_DIR: path.join(tmp, "home", ".claude"),
        },
      })`${wrapper} ${flag} ${name} -p hello`;

      assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
      const worktreeRoot = path.join(gitRoot, ".claude", "worktrees", name);
      const worktreeRealRoot = await fsp.realpath(worktreeRoot);
      const log = await fsp.readFile(fake.log, "utf8");
      assert.match(log, new RegExp(`git worktree add -b worktree-${escapeRegExp(name)} `));
      assert.match(log, new RegExp(escapeRegExp(worktreeRoot)));
      assert.match(log, new RegExp(safehouseLaunchPattern(worktreeRealRoot)));
      assert.match(log, /safehouse .* --add-dirs=[^ ]+\/\.claude /);
      assert.match(
        log,
        /\(allow file-read\* .* \(literal "\/etc\/bashrc"\) \(literal "\/private\/etc\/bashrc"\)/,
      );
      assert.match(log, /\(allow mach-lookup \(global-name "com\.apple\.sysmond"\)\)/);
      assert.match(log, /\(allow process-info\*\)/);
      assert.match(log, /\(allow signal\)/);
      assert.match(log, /claude --dangerously-skip-permissions -p hello/);
      assert.match(log, /HOME=.*\/buck-out\/tmp\/safehouse-home/);
      assert.match(log, /CLAUDE_CONFIG_DIR=.*\/\.claude/);
      assert.doesNotMatch(log, /claude .*--worktree/);
      assert.doesNotMatch(log, /^claude .*-w/m);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  }
});

test("claude wrapper prefers native node_modules Claude over PATH wrappers", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-wrapper-"));
  try {
    const gitRoot = path.join(tmp, "repo");
    const nodeModulesBin = path.join(gitRoot, "node_modules", ".bin");
    const pnpmNativeDir = path.join(
      gitRoot,
      "node_modules",
      ".pnpm",
      "@anthropic-ai+claude-code-darwin-arm64@1.0.0",
      "node_modules",
      "@anthropic-ai",
      "claude-code-darwin-arm64",
    );
    await fsp.mkdir(gitRoot, { recursive: true });
    await fsp.mkdir(nodeModulesBin, { recursive: true });
    await fsp.mkdir(pnpmNativeDir, { recursive: true });
    const fake = await makeFakeTools(tmp, gitRoot);
    const nativeClaude = path.join(pnpmNativeDir, "claude");
    await writeExecutable(
      path.join(nodeModulesBin, "claude"),
      `#!/usr/bin/env bash
echo unexpected-node-modules-shim
`,
    );
    await writeExecutable(
      nativeClaude,
      `#!/usr/bin/env bash
printf 'native-claude %s\\n' "$*" >> "${fake.log}"
`,
    );

    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin`,
        BNX_CLAUDE_GIT_WRAPPER_FOR_TEST: path.join(fake.bin, "git"),
        BNX_CLAUDE_PLATFORM_KEY_FOR_TEST: "darwin-arm64",
      },
    })`${wrapper} --worktree native-resolution --help`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const worktreeRoot = path.join(gitRoot, ".claude", "worktrees", "native-resolution");
    const worktreeRealRoot = await fsp.realpath(worktreeRoot);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(
      log,
      new RegExp(`${safehouseLaunchPattern(worktreeRealRoot)}${escapeRegExp(nativeClaude)} `),
    );
    assert.match(log, /native-claude --dangerously-skip-permissions --help/);
    assert.doesNotMatch(log, /^claude /m);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("claude wrapper resumes sessions from worktrees through safehouse", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-wrapper-"));
  try {
    const worktreeRoot = path.join(tmp, ".claude", "worktrees", "resume-worker");
    await fsp.mkdir(worktreeRoot, { recursive: true });
    const fake = await makeFakeTools(tmp, worktreeRoot);
    const res = await $({
      cwd: worktreeRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin`,
      },
    })`${wrapper} --resume session-123 -p continue`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const worktreeRealRoot = await fsp.realpath(worktreeRoot);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, new RegExp(safehouseLaunchPattern(worktreeRealRoot)));
    assert.match(log, /claude --dangerously-skip-permissions --resume session-123 -p continue/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("claude wrapper runs worktree agents through safehouse", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-wrapper-"));
  try {
    const worktreeRoot = path.join(tmp, ".claude", "worktrees", "worker-a");
    await fsp.mkdir(worktreeRoot, { recursive: true });
    const fake = await makeFakeTools(tmp, worktreeRoot);
    const res = await $({
      cwd: worktreeRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin`,
      },
    })`${wrapper} --print hello`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const worktreeRealRoot = await fsp.realpath(worktreeRoot);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, new RegExp(safehouseLaunchPattern(worktreeRealRoot)));
    assert.match(log, /claude --dangerously-skip-permissions --print hello/);
    assert.match(log, /BNX_CLAUDE_SAFEHOUSE_ACTIVE=1/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("claude wrapper leaves main repo orchestration unsandboxed by default", async () => {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "claude-wrapper-"));
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
      },
    })`${wrapper} --print parent`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.doesNotMatch(log, /safehouse /);
    assert.match(log, /claude --print parent/);
    assert.doesNotMatch(log, /dangerously-skip-permissions/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("claude wrapper refuses unsandboxed worktree agents when safehouse is missing", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-wrapper-"));
  try {
    const worktreeRoot = path.join(tmp, ".claude", "worktrees", "worker-b");
    await fsp.mkdir(worktreeRoot, { recursive: true });
    const fake = await makeFakeTools(tmp, worktreeRoot);
    await fsp.rm(path.join(fake.bin, "safehouse"));
    const res = await $({
      cwd: worktreeRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin`,
      },
    })`${wrapper} --print hello`;

    assert.equal(res.exitCode, 127);
    assert.match(String(res.stderr), /refusing to launch unsandboxed Claude/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
