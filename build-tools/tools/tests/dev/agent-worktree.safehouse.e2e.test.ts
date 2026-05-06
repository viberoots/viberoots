#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertAgentSandboxed,
  assertApfsClone,
  checkedTool,
  commandPath,
  createWorktreeSessionWithClaude,
  createWorktreeWithCodex,
  firstNixGit,
  removeWorktree,
  resumeClaudeWorktreeSession,
  rmIfExists,
} from "./agent-worktree.safehouse.e2e.helpers.ts";

const repoRoot = process.cwd();
const claudeWrapper = path.join(repoRoot, "build-tools", "tools", "bin", "claude");
const codexWrapper = path.join(repoRoot, "build-tools", "tools", "bin", "codex");
const enabled = process.env.BNX_AGENT_SAFEHOUSE_E2E === "1";
const unsupportedPlatform = enabled && process.platform !== "darwin";
const unsupportedBuckLive =
  enabled && process.env.BUCK_TEST_TARGET && process.env.BNX_AGENT_SAFEHOUSE_E2E_ALLOW_BUCK !== "1";
const skipReason = enabled
  ? unsupportedPlatform
    ? "live APFS clone proof is macOS-specific"
    : unsupportedBuckLive
      ? "live Claude/Codex E2E is run directly with direnv exec, not inside Buck's test action"
      : false
  : "set BNX_AGENT_SAFEHOUSE_E2E=1 to run real Claude/Codex Safehouse E2E checks";

if (enabled && process.env.BNX_AGENT_SAFEHOUSE_E2E_PATH) {
  process.env.PATH = process.env.BNX_AGENT_SAFEHOUSE_E2E_PATH;
}

test(
  "real agent worktrees are APFS clones and Safehouse-confined",
  { skip: skipReason, timeout: 300_000 },
  async () => {
    assert.equal(process.platform, "darwin", "APFS clone proof is macOS-specific");

    const cloneChecker =
      process.env.BNX_APFS_CLONE_CHECKER || (await commandPath("apfs-clone-checker"));
    assert.notEqual(
      cloneChecker,
      "",
      "set BNX_APFS_CLONE_CHECKER or put apfs-clone-checker on PATH for pairwise APFS clone proof",
    );
    await checkedTool("safehouse");
    await checkedTool("claude");
    await checkedTool("codex");

    const realGit = await firstNixGit();
    assert.notEqual(realGit, "", "flake-provided /nix/store git must be on PATH");

    const runId = `safehouse-e2e-${Date.now()}`;
    const marker = path.join(repoRoot, `.safehouse-e2e-${runId}.bin`);
    const claudeWorktreeName = `${runId}-claude`;
    const codexWorktreeName = `${runId}-codex`;
    const claudeWorktree = path.join(repoRoot, ".claude", "worktrees", claudeWorktreeName);
    const codexWorktree = path.join(repoRoot, ".codex", "worktrees", codexWorktreeName);
    const claudeOutside = path.join(repoRoot, `e2e-outside-${runId}-claude.txt`);
    const codexOutside = path.join(repoRoot, `e2e-outside-${runId}-codex.txt`);

    try {
      await $({ stdio: "pipe" })`dd if=/dev/zero of=${marker} bs=1048576 count=16`;
      const claudeSessionId = await createWorktreeSessionWithClaude({
        repoRoot,
        claudeWrapper,
        worktreeName: claudeWorktreeName,
        worktree: claudeWorktree,
        outsideFile: claudeOutside,
      });
      await createWorktreeWithCodex({
        repoRoot,
        codexWrapper,
        worktreeName: codexWorktreeName,
        worktree: codexWorktree,
        outsideFile: codexOutside,
      });

      await assertApfsClone(cloneChecker, marker, path.join(claudeWorktree, path.basename(marker)));
      await assertApfsClone(cloneChecker, marker, path.join(codexWorktree, path.basename(marker)));

      await assertAgentSandboxed({
        wrapper: claudeWrapper,
        cwd: claudeWorktree,
        insideFile: "claude-inside.txt",
        outsideFile: claudeOutside,
        command: `pwd; echo claude-inside > claude-inside.txt; echo claude-outside > ${claudeOutside}`,
        argv: ["-p"],
      });
      await resumeClaudeWorktreeSession({
        claudeWrapper,
        sessionId: claudeSessionId,
        worktree: claudeWorktree,
        insideFile: "claude-resume.txt",
        outsideFile: claudeOutside,
      });

      await assertAgentSandboxed({
        wrapper: codexWrapper,
        cwd: codexWorktree,
        insideFile: "codex-inside.txt",
        outsideFile: codexOutside,
        command: `pwd; echo codex-inside > codex-inside.txt; echo codex-outside > ${codexOutside}`,
        argv: ["exec", "--output-last-message", path.join(os.tmpdir(), `${runId}-codex-last.txt`)],
      });
    } finally {
      await removeWorktree(realGit, claudeWorktree);
      await removeWorktree(realGit, codexWorktree);
      await $({
        cwd: repoRoot,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`${realGit} worktree prune`;
      await rmIfExists(marker);
      await rmIfExists(claudeOutside);
      await rmIfExists(codexOutside);
      await rmIfExists(path.join(os.tmpdir(), `${runId}-codex-last.txt`));
      await fsp.rmdir(path.join(repoRoot, ".claude", "worktrees")).catch(() => {});
      await fsp.rmdir(path.join(repoRoot, ".codex", "worktrees")).catch(() => {});
      await fsp.rmdir(path.join(repoRoot, ".codex")).catch(() => {});
    }
  },
);
