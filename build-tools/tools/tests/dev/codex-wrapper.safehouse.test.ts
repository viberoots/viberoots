#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const wrapper = path.join(repoRoot, "build-tools", "tools", "bin", "codex");
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
`,
  );
  await writeExecutable(
    path.join(bin, "codex"),
    `#!/usr/bin/env bash
printf 'codex %s\\n' "$*" >> "${log}"
printf 'BNX_CODEX_SAFEHOUSE_ACTIVE=%s\\n' "\${BNX_CODEX_SAFEHOUSE_ACTIVE:-}" >> "${log}"
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

test("codex --worktree creates through the CoW git wrapper and launches the worker in safehouse", async () => {
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
        BNX_CODEX_GIT_WRAPPER_FOR_TEST: path.join(fake.bin, "git"),
      },
    })`${wrapper} --worktree native-worker exec task`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const worktreeRoot = path.join(gitRoot, ".codex", "worktrees", "native-worker");
    const worktreeRealRoot = await fsp.realpath(worktreeRoot);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, /git worktree add -b worktree-native-worker /);
    assert.match(log, new RegExp(escapeRegExp(worktreeRoot)));
    assert.match(
      log,
      new RegExp(
        `safehouse --workdir=${escapeRegExp(worktreeRealRoot)} --add-dirs-ro=/nix/store --append-profile=.* --env `,
      ),
    );
    assert.match(log, /codex --dangerously-bypass-approvals-and-sandbox exec task/);
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
        BNX_CODEX_GIT_WRAPPER_FOR_TEST: path.join(fake.bin, "git"),
      },
    })`${wrapper} -w shortcut-worker exec task`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const worktreeRoot = path.join(gitRoot, ".codex", "worktrees", "shortcut-worker");
    const worktreeRealRoot = await fsp.realpath(worktreeRoot);
    const log = await fsp.readFile(fake.log, "utf8");
    assert.match(log, /git worktree add -b worktree-shortcut-worker /);
    assert.match(
      log,
      new RegExp(
        `safehouse --workdir=${escapeRegExp(worktreeRealRoot)} --add-dirs-ro=/nix/store --append-profile=.* --env `,
      ),
    );
    assert.match(log, /codex --dangerously-bypass-approvals-and-sandbox exec task/);
    assert.doesNotMatch(log, /codex .*-w/);
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
    assert.match(
      log,
      new RegExp(
        `safehouse --workdir=${escapeRegExp(worktreeRealRoot)} --add-dirs-ro=/nix/store --append-profile=.* --env `,
      ),
    );
    assert.match(log, /codex --dangerously-bypass-approvals-and-sandbox exec task/);
    assert.match(log, /BNX_CODEX_SAFEHOUSE_ACTIVE=1/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("codex wrapper leaves main repo unsandboxed by default", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-wrapper-"));
  try {
    const fake = await makeFakeTools(tmp, repoRoot);
    const res = await $({
      cwd: repoRoot,
      stdio: "pipe",
      env: { ...process.env, PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin` },
    })`${wrapper} exec parent`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.doesNotMatch(log, /safehouse /);
    assert.match(log, /codex exec parent/);
    assert.doesNotMatch(log, /dangerously-bypass-approvals-and-sandbox/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
