#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { checkConsumerConsistency } from "../../dev/consumer-consistency-check";
import { requiredConsumerTrackedPaths } from "../../lib/consumer-tracked-inputs";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { ccFixture as fixture } from "./repo-skills-cc.viberoots-guard.fixture";

async function ccWorkflowPath(): Promise<string> {
  for (const candidate of [
    "plugins/repo-skills/skills/cc/WORKFLOW.md",
    "viberoots/plugins/repo-skills/skills/cc/WORKFLOW.md",
  ]) {
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {
      // Try the next supported repository working directory.
    }
  }
  throw new Error("repo-skills cc workflow not found");
}

test("repo-skills cc workflow guards viberoots consumer metadata before commit", async () => {
  const workflow = await fsp.readFile(await ccWorkflowPath(), "utf8");
  for (const fragment of [
    "zx-wrapper viberoots/build-tools/tools/dev/consumer-consistency-check.ts",
    "viberoots update",
    "gitlink_rev",
    "prospective_gitlink_rev",
    "flake.lock",
    "pnpm hash metadata",
    "--read-only",
    "post-clone",
    'test "$(cat .buckroot 2>/dev/null)" = "."',
    "for path in .buckroot .buckconfig .envrc .gitignore",
    'grep -Fxq -- "$entry" .gitignore',
    "git ls-files --error-unmatch -- projects/config/local.json",
  ]) {
    if (!workflow.includes(fragment)) {
      throw new Error(`cc workflow must guard viberoots consumer commits; missing ${fragment}`);
    }
  }
  assert.doesNotMatch(workflow, /viberoots use-submodule|git submodule update.*viberoots update/);
  assert.match(workflow, /must never invent\s+`u --upgrade` as repair guidance/);
});

test("shell preflight uses the shared required committed input list before local setup", async () => {
  const bootstrap = await fsp.readFile(viberootsSourcePath("bootstrap"), "utf8");
  const declaration = bootstrap.match(/local required_inputs=\(([^)]*)\)/);
  assert.ok(declaration);
  const shellPaths = Array.from(declaration[1].matchAll(/"([^"]+)"/g), (match) => match[1]);
  assert.deepEqual(shellPaths, [...requiredConsumerTrackedPaths]);
  assert.match(
    bootstrap,
    /\nassert_post_clone_required_tracked_inputs\nassert_post_clone_git_authority\nensure_macos_developer_tools\n/,
  );
  assert.match(bootstrap, /post-clone could not prove required tracked workspace inputs/);
  assert.match(
    bootstrap,
    /run_writable_migrations\(\) \{\s*\[\[ "\$\{post_clone\}" != "1" \]\] \|\| return 0\s*run_migrations\s*\}/,
  );
  assert.equal(bootstrap.match(/^\s*run_migrations$/gm)?.length, 1);
});

test("cc consistency guard accepts coherent generated state", async () => {
  const root = await fixture("flake");
  try {
    await checkConsumerConsistency(root, {
      checkPnpm: async () => {},
      checkLanguages: async () => {},
    });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
