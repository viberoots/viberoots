#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { checkConsumerConsistency } from "../../dev/consumer-consistency-check";
import { requiredConsumerTrackedPaths } from "../../lib/consumer-tracked-inputs";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { ccFixture as fixture } from "./repo-skills-cc.viberoots-guard.fixture";

const execFileAsync = promisify(execFile);

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
    'active_viberoots="$(cd .viberoots/current 2>/dev/null && pwd -P)"',
    'consistency_check="$active_viberoots/build-tools/tools/dev/consumer-consistency-check.ts"',
    'zx-wrapper "$consistency_check"',
    "Do not replace a missing checker with partial manual checks",
    'zx-wrapper "$active_viberoots/build-tools/tools/dev/update-pnpm-hash.ts"',
    "viberoots update",
    "prospective gitlink",
    "flake.lock",
    "pnpm hash metadata",
    "--read-only",
    "post-clone",
  ]) {
    if (!workflow.includes(fragment)) {
      throw new Error(`cc workflow must guard viberoots consumer commits; missing ${fragment}`);
    }
  }
  assert.doesNotMatch(workflow, /zx-wrapper viberoots\/build-tools\/tools\/dev/);
  assert.doesNotMatch(workflow, /find projects viberoots/);
  assert.doesNotMatch(workflow, /If the consistency check is not available/);
  assert.doesNotMatch(workflow, /viberoots use-submodule|git submodule update.*viberoots update/);
  assert.match(workflow, /must never invent\s+`u --upgrade` as repair guidance/);
});

test("flake-only consumer executes the documented active-source guard", async () => {
  const workflow = await fsp.readFile(await ccWorkflowPath(), "utf8");
  const guardBlock = Array.from(workflow.matchAll(/^[ \t]*```sh\r?\n([\s\S]*?)^[ \t]*```/gm))
    .map((match) => match[1])
    .find((block) => block.includes('active_viberoots="$(cd .viberoots/current'));
  assert.ok(guardBlock, "expected executable active-source guard block");

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cc-flake-active-source-"));
  try {
    const source = path.join(root, "flake-source");
    const checker = path.join(
      source,
      "build-tools",
      "tools",
      "dev",
      "consumer-consistency-check.ts",
    );
    const fakeBin = path.join(root, "fake-bin");
    const log = path.join(root, "zx-wrapper.log");
    await fsp.mkdir(path.dirname(checker), { recursive: true });
    await fsp.mkdir(path.join(root, ".viberoots"), { recursive: true });
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.writeFile(checker, "// flake-mode checker fixture\n");
    await fsp.symlink(source, path.join(root, ".viberoots", "current"));
    await fsp.writeFile(
      path.join(fakeBin, "zx-wrapper"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$1" > ${JSON.stringify(log)}\n`,
      { mode: 0o755 },
    );

    await execFileAsync("bash", ["--noprofile", "--norc", "-c", guardBlock], {
      cwd: root,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    });
    assert.equal((await fsp.readFile(log, "utf8")).trim(), checker);
    await assert.rejects(fsp.access(path.join(root, "viberoots")));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
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
