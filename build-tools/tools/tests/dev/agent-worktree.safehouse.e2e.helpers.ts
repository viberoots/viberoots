import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";

export async function commandPath(name: string): Promise<string> {
  const res = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`bash --noprofile --norc -c ${`command -v ${name}`}`;
  return res.exitCode === 0 ? String(res.stdout).trim() : "";
}

export async function firstNixGit(): Promise<string> {
  const res = await $({ stdio: "pipe" })`bash --noprofile --norc -c 'type -a -p git'`;
  const candidates = String(res.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return candidates.find((candidate) => candidate.startsWith("/nix/store/")) || "";
}

export async function checkedTool(name: string): Promise<string> {
  const found = await commandPath(name);
  assert.notEqual(found, "", `${name} must be on PATH for VBR_AGENT_SAFEHOUSE_E2E=1`);
  return found;
}

export async function rmIfExists(file: string): Promise<void> {
  await fsp.rm(file, { force: true, recursive: true });
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function removeWorktree(realGit: string, worktree: string): Promise<void> {
  try {
    await fsp.stat(worktree);
  } catch {
    return;
  }
  await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`${realGit} worktree remove --force ${worktree}`;
}

export async function assertApfsClone(
  checker: string,
  source: string,
  clone: string,
): Promise<void> {
  const res = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`${checker} ${source} ${clone}`;
  assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
  assert.equal(
    String(res.stdout).trim(),
    "1",
    `${clone} should share APFS clone blocks with ${source}`,
  );
}

export async function createWorktreeSessionWithClaude(opts: {
  repoRoot: string;
  claudeWrapper: string;
  worktreeName: string;
  worktree: string;
  outsideFile: string;
}): Promise<string> {
  await rmIfExists(path.join(opts.worktree, "claude-worktree-launch.txt"));
  await rmIfExists(opts.outsideFile);
  const prompt = [
    "Run exactly this shell command using your shell tool, then summarize the exit code and stderr.",
    "Do not rewrite it.",
    `pwd; echo claude-worktree-launch > claude-worktree-launch.txt; echo claude-outside > ${opts.outsideFile}`,
  ].join("\n");
  const res = await $({
    cwd: opts.repoRoot,
    stdio: "pipe",
    reject: false,
    nothrow: true,
    timeout: 180_000,
  })`/bin/zsh -c ${`direnv exec . ${shellQuote(opts.claudeWrapper)} --worktree ${shellQuote(opts.worktreeName)} -p --output-format json --permission-mode bypassPermissions ${shellQuote(prompt)}`}`;
  assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
  await fsp.stat(path.join(opts.worktree, ".git"));
  assert.equal(
    await fsp.readFile(path.join(opts.worktree, "claude-worktree-launch.txt"), "utf8"),
    "claude-worktree-launch\n",
  );
  await assert.rejects(fsp.stat(opts.outsideFile), /ENOENT/);
  const event = JSON.parse(String(res.stdout));
  assert.equal(typeof event.session_id, "string");
  assert.notEqual(event.session_id, "");
  return event.session_id;
}

export async function resumeClaudeWorktreeSession(opts: {
  claudeWrapper: string;
  sessionId: string;
  worktree: string;
  insideFile: string;
  outsideFile: string;
}): Promise<void> {
  await rmIfExists(path.join(opts.worktree, opts.insideFile));
  await rmIfExists(opts.outsideFile);
  const prompt = [
    "Run exactly this shell command using your shell tool, then summarize the exit code and stderr.",
    "Do not rewrite it.",
    `pwd; echo claude-resume > ${opts.insideFile}; echo claude-resume-outside > ${opts.outsideFile}`,
  ].join("\n");
  const res = await $({
    cwd: opts.worktree,
    stdio: "pipe",
    reject: false,
    nothrow: true,
    timeout: 180_000,
  })`${opts.claudeWrapper} --resume ${opts.sessionId} -p --output-format json --permission-mode bypassPermissions ${prompt}`;
  assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
  const event = JSON.parse(String(res.stdout));
  assert.equal(event.session_id, opts.sessionId);
  assert.equal(
    await fsp.readFile(path.join(opts.worktree, opts.insideFile), "utf8"),
    "claude-resume\n",
  );
  await assert.rejects(fsp.stat(opts.outsideFile), /ENOENT/);
}

export async function createWorktreeWithCodex(opts: {
  repoRoot: string;
  codexWrapper: string;
  worktreeName: string;
  worktree: string;
  outsideFile: string;
}): Promise<void> {
  await rmIfExists(path.join(opts.worktree, "codex-worktree-launch.txt"));
  await rmIfExists(opts.outsideFile);
  const prompt = [
    "Run exactly this shell command, then summarize stdout/stderr.",
    "Do not rewrite it.",
    `pwd; echo codex-worktree-launch > codex-worktree-launch.txt; echo codex-outside > ${opts.outsideFile}`,
  ].join("\n");
  const res = await $({
    cwd: opts.repoRoot,
    env: {
      ...process.env,
      VBR_CODEX_E2E_PROMPT: prompt,
      VBR_CODEX_E2E_WORKTREE_NAME: opts.worktreeName,
      VBR_CODEX_E2E_WRAPPER: opts.codexWrapper,
    },
    stdio: "pipe",
    reject: false,
    nothrow: true,
    timeout: 180_000,
  })`bash --noprofile --norc -c 'exec "$VBR_CODEX_E2E_WRAPPER" --worktree "$VBR_CODEX_E2E_WORKTREE_NAME" exec --sandbox workspace-write "$VBR_CODEX_E2E_PROMPT" < /dev/null'`;
  assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
  await fsp.stat(path.join(opts.worktree, ".git"));
  assert.equal(
    await fsp.readFile(path.join(opts.worktree, "codex-worktree-launch.txt"), "utf8"),
    "codex-worktree-launch\n",
  );
  await assert.rejects(fsp.stat(opts.outsideFile), /ENOENT/);
}

export async function assertAgentSandboxed(opts: {
  wrapper: string;
  cwd: string;
  insideFile: string;
  outsideFile: string;
  command: string;
  argv: string[];
}): Promise<void> {
  await rmIfExists(path.join(opts.cwd, opts.insideFile));
  await rmIfExists(opts.outsideFile);
  const prompt = `Run exactly this shell command using your shell tool, then summarize the exit code and stderr:\n${opts.command}`;
  const argv = opts.argv.map((arg) => shellQuote(arg)).join(" ");
  const command = `exec ${shellQuote(opts.wrapper)} ${argv} ${shellQuote(prompt)} < /dev/null`;
  const res = await $({
    cwd: opts.cwd,
    stdio: "pipe",
    reject: false,
    nothrow: true,
    timeout: 120_000,
  })`bash --noprofile --norc -c ${command}`;
  assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
  assert.equal(
    await fsp.readFile(path.join(opts.cwd, opts.insideFile), "utf8"),
    `${path.basename(opts.insideFile, ".txt")}\n`,
  );
  await assert.rejects(fsp.stat(opts.outsideFile), /ENOENT/);
}
