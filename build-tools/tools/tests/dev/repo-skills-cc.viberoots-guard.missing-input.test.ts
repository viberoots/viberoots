import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { checkConsumerConsistency } from "../../dev/consumer-consistency-check";
import { ccFixture, commitEnv, execFileAsync } from "./repo-skills-cc.viberoots-guard.fixture";

const noDependencyChecks = {
  checkPnpm: async () => {},
  checkLanguages: async () => {},
};

test("cc guard rejects a missing submodule root lock without mutation", async () => {
  const root = await ccFixture("submodule");
  try {
    const checkout = path.join(root, "viberoots");
    await fsp.mkdir(checkout);
    await execFileAsync("git", ["init", "-q"], { cwd: checkout });
    await fsp.writeFile(path.join(checkout, "VERSION"), "fixture\n");
    await execFileAsync("git", ["add", "VERSION"], { cwd: checkout });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: checkout, env: commitEnv });
    const before = await execFileAsync("git", ["status", "--short"], { cwd: root });
    await assert.rejects(
      checkConsumerConsistency(root, noDependencyChecks),
      /required root flake\.lock is missing its committed viberoots input[\s\S]*repair: run viberoots update/,
    );
    await assert.rejects(fsp.access(path.join(root, "flake.lock")), { code: "ENOENT" });
    const after = await execFileAsync("git", ["status", "--short"], { cwd: root });
    assert.equal(after.stdout, before.stdout);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("cc guard rejects every missing generated input without mutation", async () => {
  for (const rel of [".buckroot", ".buckconfig", ".envrc", ".gitignore"]) {
    const root = await ccFixture("flake");
    try {
      await execFileAsync("git", ["rm", "-q", rel], { cwd: root });
      await execFileAsync("git", ["commit", "-qm", `fixture: omit ${rel}`], {
        cwd: root,
        env: commitEnv,
      });
      const before = await execFileAsync("git", ["status", "--short"], { cwd: root });
      await assert.rejects(
        checkConsumerConsistency(root, noDependencyChecks),
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
