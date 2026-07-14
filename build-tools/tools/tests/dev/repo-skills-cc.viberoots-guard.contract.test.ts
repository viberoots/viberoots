#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { checkConsumerConsistency } from "../../dev/consumer-consistency-check";
import { buckconfig } from "../../lib/consumer-bootstrap";
import { envrc } from "../../lib/consumer-direnv";
import {
  consumerGitignoreEntries,
  requiredConsumerTrackedPaths,
} from "../../lib/consumer-tracked-inputs";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const execFileAsync = promisify(execFile);
const commitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

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

async function fixture(mode: "flake" | "submodule"): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `vbr-cc-${mode}-`));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await fsp.writeFile(
    path.join(root, "flake.nix"),
    mode === "submodule"
      ? 'inputs.viberoots.url = "path:./viberoots";\n'
      : 'inputs.viberoots.url = "github:viberoots/viberoots/pinned";\n',
  );
  await fsp.writeFile(path.join(root, ".buckconfig"), buckconfig(mode));
  await fsp.writeFile(path.join(root, ".buckroot"), ".\n");
  await fsp.writeFile(path.join(root, ".envrc"), envrc());
  await fsp.writeFile(
    path.join(root, ".gitignore"),
    `# viberoots local workspace state\n${consumerGitignoreEntries.join("\n")}\n`,
  );
  await execFileAsync(
    "git",
    ["add", "flake.nix", ".buckconfig", ".buckroot", ".envrc", ".gitignore"],
    { cwd: root },
  );
  await execFileAsync("git", ["commit", "-qm", "fixture"], {
    cwd: root,
    env: commitEnv,
  });
  return root;
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
    /\nassert_post_clone_required_tracked_inputs\nensure_macos_developer_tools\n/,
  );
  assert.match(bootstrap, /post-clone could not prove required tracked workspace inputs/);
  assert.match(
    bootstrap,
    /run_writable_migrations\(\) \{\s*\[\[ "\$\{post_clone\}" != "1" \]\] \|\| return 0\s*run_migrations\s*\}/,
  );
  assert.equal(bootstrap.match(/^\s*run_migrations$/gm)?.length, 1);
});

test("cc consistency guard accepts coherent generated state and rejects post-clone dirt", async () => {
  const root = await fixture("flake");
  try {
    await checkConsumerConsistency(root, { checkPnpm: async () => {} });
    await fsp.writeFile(path.join(root, ".envrc"), "stale generated envrc\n");
    await assert.rejects(
      checkConsumerConsistency(root, { checkPnpm: async () => {} }),
      /post-clone would refresh stale generated file \.envrc[\s\S]*repair: run viberoots update/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("cc consistency guard shares every tracked post-clone input check", async () => {
  const root = await fixture("flake");
  try {
    await fsp.writeFile(path.join(root, ".buckroot"), "stale\n");
    await assert.rejects(
      checkConsumerConsistency(root, { checkPnpm: async () => {} }),
      /stale generated file \.buckroot[\s\S]*repair: run viberoots update/,
    );
    await fsp.writeFile(path.join(root, ".buckroot"), ".\n");

    await fsp.writeFile(path.join(root, ".buckconfig"), "stale\n");
    await assert.rejects(
      checkConsumerConsistency(root, { checkPnpm: async () => {} }),
      /stale generated file \.buckconfig[\s\S]*repair: run viberoots update/,
    );
    await fsp.writeFile(path.join(root, ".buckconfig"), buckconfig("flake"));

    await fsp.writeFile(path.join(root, ".gitignore"), ".viberoots/\n");
    await assert.rejects(
      checkConsumerConsistency(root, { checkPnpm: async () => {} }),
      /stale generated file \.gitignore[\s\S]*repair: run viberoots update/,
    );
    await fsp.writeFile(
      path.join(root, ".gitignore"),
      `# viberoots local workspace state\n${consumerGitignoreEntries.join("\n")}\n`,
    );

    await fsp.mkdir(path.join(root, "projects", "config"), { recursive: true });
    await fsp.writeFile(path.join(root, "projects", "config", "local.json"), "{}\n");
    await execFileAsync("git", ["add", "-f", "projects/config/local.json"], { cwd: root });
    await assert.rejects(
      checkConsumerConsistency(root, { checkPnpm: async () => {} }),
      /stale generated file projects\/config\/local\.json[\s\S]*repair: run viberoots update/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("cc consistency guard rejects every missing required committed input without mutation", async () => {
  for (const rel of [".buckroot", ".buckconfig", ".envrc", ".gitignore"]) {
    const root = await fixture("flake");
    try {
      await execFileAsync("git", ["rm", "-q", rel], { cwd: root });
      await execFileAsync("git", ["commit", "-qm", `fixture: omit ${rel}`], {
        cwd: root,
        env: commitEnv,
      });
      const before = await execFileAsync("git", ["status", "--short"], { cwd: root });
      await assert.rejects(
        checkConsumerConsistency(root, { checkPnpm: async () => {} }),
        new RegExp(
          `stale generated file ${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*repair: run viberoots update`,
        ),
      );
      await assert.rejects(fsp.access(path.join(root, rel)), { code: "ENOENT" });
      const after = await execFileAsync("git", ["status", "--short"], { cwd: root });
      assert.equal(after.stdout, before.stdout);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }
});

test("cc consistency guard classifies pin and dependency drift with exact repair commands", async () => {
  const root = await fixture("submodule");
  try {
    const checkout = path.join(root, "viberoots");
    await fsp.mkdir(checkout, { recursive: true });
    await execFileAsync("git", ["init", "-q"], { cwd: checkout });
    await fsp.writeFile(path.join(checkout, "VERSION"), "old\n");
    await execFileAsync("git", ["add", "VERSION"], { cwd: checkout });
    await execFileAsync("git", ["commit", "-qm", "old"], {
      cwd: checkout,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      },
    });
    const { stdout: oldStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: checkout,
    });
    const oldRev = oldStdout.trim();
    await fsp.writeFile(path.join(checkout, "VERSION"), "new\n");
    await execFileAsync("git", ["add", "VERSION"], { cwd: checkout });
    await execFileAsync("git", ["commit", "-qm", "new"], {
      cwd: checkout,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      },
    });
    const { stdout: newStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: checkout,
    });
    const newRev = newStdout.trim();
    await execFileAsync(
      "git",
      ["update-index", "--add", "--cacheinfo", `160000,${oldRev},viberoots`],
      {
        cwd: root,
      },
    );
    await fsp.writeFile(
      path.join(root, "flake.lock"),
      `${JSON.stringify({ nodes: { viberoots: { locked: { rev: newRev } } } })}\n`,
    );
    await checkConsumerConsistency(root, { checkPnpm: async () => {} });

    await fsp.writeFile(
      path.join(root, "flake.lock"),
      `${JSON.stringify({ nodes: { viberoots: { locked: { rev: oldRev } } } })}\n`,
    );
    await assert.rejects(
      checkConsumerConsistency(root, { checkPnpm: async () => {} }),
      new RegExp(
        `prospective viberoots gitlink ${newRev} does not match flake\\.lock ${oldRev}[\\s\\S]*repair: run viberoots update`,
      ),
    );

    await execFileAsync("git", ["checkout", "-q", oldRev], { cwd: checkout });
    await fsp.writeFile(
      path.join(root, "flake.lock"),
      `${JSON.stringify({ nodes: { viberoots: { locked: { rev: newRev } } } })}\n`,
    );
    await assert.rejects(
      checkConsumerConsistency(root, { checkPnpm: async () => {} }),
      new RegExp(
        `prospective viberoots gitlink ${oldRev} does not match flake\\.lock ${newRev}[\\s\\S]*repair: run viberoots update`,
      ),
    );

    await execFileAsync("git", ["update-index", "--force-remove", "viberoots"], { cwd: root });
    await fsp.rm(checkout, { recursive: true, force: true });
    await fsp.writeFile(
      path.join(root, "flake.nix"),
      'inputs.viberoots.url = "github:viberoots/viberoots/pinned";\n',
    );
    await fsp.writeFile(path.join(root, ".buckconfig"), buckconfig("flake"));
    await assert.rejects(
      checkConsumerConsistency(root, {
        checkPnpm: async () => {
          throw new Error("error: stale pnpm metadata\n\nrepair: run u");
        },
      }),
      /repair: run u/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
