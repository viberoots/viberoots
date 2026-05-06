#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const wrapper = path.join(repoRoot, "build-tools", "tools", "bin", "claude");
const scratchRoot = path.join(repoRoot, "buck-out", "tmp");

async function writeExecutable(file: string, text: string): Promise<void> {
  await fsp.writeFile(file, text, "utf8");
  await fsp.chmod(file, 0o755);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function makeFakeTools(tmp: string, gitRoot: string): Promise<{ bin: string; log: string }> {
  const bin = path.join(tmp, "bin");
  const log = path.join(tmp, "calls.log");
  await fsp.mkdir(bin, { recursive: true });
  await writeExecutable(
    path.join(bin, "git"),
    `#!/usr/bin/env bash
if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then
  case "$(pwd -P)" in
    */.claude/worktrees/*|*/.codex/worktrees/*)
      pwd -P
      exit 0
      ;;
  esac
  printf '%s\\n' "${gitRoot}"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--verify" ]; then
  exit 1
fi
if [ "$1" = "worktree" ] && [ "$2" = "add" ]; then
  printf 'git %s\\n' "$*" >> "${log}"
  target=""
  skip_next=0
  for arg in "$@"; do
    if [ "$skip_next" = 1 ]; then
      skip_next=0
      continue
    fi
    case "$arg" in
      worktree|add|HEAD|origin/HEAD) ;;
      -b|-B|--reason)
        skip_next=1
        ;;
      -*)
        ;;
      *)
        target="$arg"
        ;;
    esac
    if [ -n "$target" ]; then
      break
    fi
  done
  mkdir -p "$target"
  printf 'gitdir: fake\\n' > "$target/.git"
  exit 0
fi
printf 'git %s\\n' "$*" >> "${log}"
`,
  );
  await writeExecutable(
    path.join(bin, "claude"),
    `#!/usr/bin/env bash
printf 'claude %s\\n' "$*" >> "${log}"
printf 'BNX_CLAUDE_SAFEHOUSE_ACTIVE=%s\\n' "\${BNX_CLAUDE_SAFEHOUSE_ACTIVE:-}" >> "${log}"
`,
  );
  await writeExecutable(
    path.join(bin, "safehouse"),
    `#!/usr/bin/env bash
printf 'safehouse %s\\n' "$*" >> "${log}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --workdir=*|--add-dirs-ro=*|--append-profile=*|--env) shift ;;
    --workdir|--add-dirs-ro|--append-profile) shift 2 ;;
    *) exec "$@" ;;
  esac
done
`,
  );
  return { bin, log };
}

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
        },
      })`${wrapper} ${flag} ${name} -p hello`;

      assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
      const worktreeRoot = path.join(gitRoot, ".claude", "worktrees", name);
      const worktreeRealRoot = await fsp.realpath(worktreeRoot);
      const log = await fsp.readFile(fake.log, "utf8");
      assert.match(log, new RegExp(`git worktree add -b worktree-${escapeRegExp(name)} `));
      assert.match(log, new RegExp(escapeRegExp(worktreeRoot)));
      assert.match(
        log,
        new RegExp(
          `safehouse --workdir=${escapeRegExp(worktreeRealRoot)} --add-dirs-ro=/nix/store --append-profile=.* --env `,
        ),
      );
      assert.match(log, /claude --dangerously-skip-permissions -p hello/);
      assert.doesNotMatch(log, /claude .*--worktree/);
      assert.doesNotMatch(log, /claude .*-w/);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
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
    assert.match(
      log,
      new RegExp(
        `safehouse --workdir=${escapeRegExp(worktreeRealRoot)} --add-dirs-ro=/nix/store --append-profile=.* --env `,
      ),
    );
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
    assert.match(
      log,
      new RegExp(
        `safehouse --workdir=${escapeRegExp(worktreeRealRoot)} --add-dirs-ro=/nix/store --append-profile=.* --env `,
      ),
    );
    assert.match(log, /claude --dangerously-skip-permissions --print hello/);
    assert.match(log, /BNX_CLAUDE_SAFEHOUSE_ACTIVE=1/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("claude wrapper leaves main repo orchestration unsandboxed by default", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-wrapper-"));
  try {
    const fake = await makeFakeTools(tmp, repoRoot);
    const res = await $({
      cwd: repoRoot,
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
