#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  commitAll,
  createFreshCloneFixture,
  git,
  requiredTrackedInputs,
} from "./fresh-clone-post-clone.fixture";
import { assertStalePostCloneCases } from "./fresh-clone-post-clone-stale-cases";

test("post-clone fails closed without mutating tracked inputs", async (t) => {
  const fixture = await createFreshCloneFixture(t);
  const { consumerSource, localGitEnv, submoduleRev } = fixture;
  const canonicalTrackedInputs = new Map(
    await Promise.all(
      requiredTrackedInputs.map(
        async (rel) => [rel, await fsp.readFile(path.join(consumerSource, rel), "utf8")] as const,
      ),
    ),
  );
  const mismatchedRev = "89abcdef0123456789abcdef0123456789abcdef";
  const mismatchedLock = JSON.parse(
    await fsp.readFile(path.join(consumerSource, "flake.lock"), "utf8"),
  );
  mismatchedLock.nodes.viberoots.locked.rev = mismatchedRev;
  await fsp.writeFile(
    path.join(consumerSource, "flake.lock"),
    `${JSON.stringify(mismatchedLock, null, 2)}\n`,
    "utf8",
  );
  await commitAll(consumerSource, "fixture: mismatched root pins", localGitEnv);
  const mismatchedPinsClone = await fixture.clone("mismatched-pins-clone");
  const mismatchedLockBefore = await fsp.readFile(path.join(mismatchedPinsClone, "flake.lock"));
  await assert.rejects(
    fixture.postClone(mismatchedPinsClone),
    /post-clone found mismatched viberoots pins[\s\S]*no tracked files were modified[\s\S]*repair: run viberoots update/,
  );
  assert.deepEqual(
    await fsp.readFile(path.join(mismatchedPinsClone, "flake.lock")),
    mismatchedLockBefore,
  );
  assert.equal(await git(mismatchedPinsClone, ["diff", "--name-only"]), "");
  assert.equal(await git(mismatchedPinsClone, ["status", "--short"]), "");
  await fixture.cleanupClone(mismatchedPinsClone);

  mismatchedLock.nodes.viberoots.locked.rev = submoduleRev;
  await fsp.writeFile(
    path.join(consumerSource, "flake.lock"),
    `${JSON.stringify(mismatchedLock, null, 2)}\n`,
    "utf8",
  );
  for (const missingRel of requiredTrackedInputs) {
    for (const [rel, content] of canonicalTrackedInputs) {
      await fsp.writeFile(path.join(consumerSource, rel), content, "utf8");
    }
    await fsp.rm(path.join(consumerSource, missingRel));
    await git(
      consumerSource,
      ["add", "-A", "--", "flake.lock", ...requiredTrackedInputs],
      localGitEnv,
    );
    await git(
      consumerSource,
      [
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        `fixture: missing tracked input ${missingRel}`,
      ],
      localGitEnv,
    );
    const missingInputClone = await fixture.clone(`missing-${missingRel.slice(1)}-clone`);
    const beforeBytes = new Map(
      await Promise.all(
        requiredTrackedInputs.map(
          async (rel) =>
            [
              rel,
              await fsp.readFile(path.join(missingInputClone, rel)).catch(() => undefined),
            ] as const,
        ),
      ),
    );
    const statusBefore = await git(missingInputClone, ["status", "--short"]);
    await assert.rejects(
      fixture.postClone(missingInputClone),
      new RegExp(
        `post-clone found stale tracked generated file ${missingRel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*no tracked files were modified[\\s\\S]*repair: run viberoots update`,
      ),
    );
    for (const rel of requiredTrackedInputs) {
      assert.deepEqual(
        await fsp.readFile(path.join(missingInputClone, rel)).catch(() => undefined),
        beforeBytes.get(rel),
      );
    }
    await assert.rejects(fsp.access(path.join(missingInputClone, missingRel)), { code: "ENOENT" });
    assert.equal(await git(missingInputClone, ["diff", "--name-only"]), "");
    assert.equal(await git(missingInputClone, ["status", "--short"]), statusBefore);
    await fixture.cleanupClone(missingInputClone);
  }

  for (const [rel, content] of canonicalTrackedInputs) {
    await fsp.writeFile(path.join(consumerSource, rel), content, "utf8");
  }
  await git(consumerSource, ["add", "-A", "--", ...requiredTrackedInputs], localGitEnv);
  await git(
    consumerSource,
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "fixture: restore required tracked inputs",
    ],
    localGitEnv,
  );
  for (const rel of [".buckroot", ".gitignore"] as const) {
    for (const [trackedRel, content] of canonicalTrackedInputs) {
      await fsp.writeFile(path.join(consumerSource, trackedRel), content, "utf8");
    }
    await fsp.writeFile(path.join(consumerSource, rel), `stale ${rel}\n`, "utf8");
    await commitAll(consumerSource, `fixture: stale tracked input ${rel}`, localGitEnv);
    const staleClone = await fixture.clone(`stale-${rel.slice(1)}-clone`);
    const staleBefore = await fsp.readFile(path.join(staleClone, rel));
    await assert.rejects(
      fixture.postClone(staleClone),
      new RegExp(
        `post-clone found stale tracked generated file ${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*no tracked files were modified[\\s\\S]*repair: run viberoots update`,
      ),
    );
    assert.deepEqual(await fsp.readFile(path.join(staleClone, rel)), staleBefore);
    assert.equal(await git(staleClone, ["diff", "--name-only"]), "");
    assert.equal(await git(staleClone, ["status", "--short"]), "");
    await fixture.cleanupClone(staleClone);
  }

  for (const [rel, content] of canonicalTrackedInputs) {
    await fsp.writeFile(path.join(consumerSource, rel), content, "utf8");
  }
  const localConfigRel = "projects/config/local.json";
  await fsp.mkdir(path.join(consumerSource, "projects", "config"), { recursive: true });
  await fsp.writeFile(path.join(consumerSource, localConfigRel), '{"tracked":"stale"}\n', "utf8");
  await git(
    consumerSource,
    ["add", "-f", "--", localConfigRel, ...requiredTrackedInputs],
    localGitEnv,
  );
  await git(
    consumerSource,
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "fixture: tracked local config",
    ],
    localGitEnv,
  );
  const localConfigClone = await fixture.clone("tracked-local-config-clone");
  const localConfigBefore = await fsp.readFile(path.join(localConfigClone, localConfigRel));
  await assert.rejects(
    fixture.postClone(localConfigClone),
    /post-clone found stale tracked generated file projects\/config\/local\.json[\s\S]*no tracked files were modified[\s\S]*repair: run viberoots update/,
  );
  assert.deepEqual(
    await fsp.readFile(path.join(localConfigClone, localConfigRel)),
    localConfigBefore,
  );
  assert.equal(await git(localConfigClone, ["diff", "--name-only"]), "");
  assert.equal(await git(localConfigClone, ["status", "--short"]), "");
  await fixture.cleanupClone(localConfigClone);

  await fsp.rm(path.join(consumerSource, localConfigRel));
  await git(consumerSource, ["add", "-A", "--", localConfigRel], localGitEnv);
  await git(
    consumerSource,
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "fixture: restore untracked local config",
    ],
    localGitEnv,
  );
  for (const [failureMode, name, detail] of [
    ["repo-proof", "failed-repo-proof-clone", "Git could not prove the workspace root"],
    ["status", "failed-status-clone", "Git could not read workspace status"],
  ] as const) {
    const failureClone = await fixture.clone(name);
    await assert.rejects(
      fixture.postClone(failureClone, { failureMode }),
      new RegExp(
        `post-clone could not verify workspace cleanliness[\\s\\S]*environment failure: ${detail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*no tracked files were modified[\\s\\S]*repair: restore Git worktree access and rerun viberoots post-clone`,
      ),
    );
    assert.equal(await git(failureClone, ["diff", "--name-only"]), "");
    assert.equal(await git(failureClone, ["status", "--short"]), "");
    await fixture.cleanupClone(failureClone);
  }
});

test("post-clone rejects stale generated and dependency metadata", async (t) => {
  await assertStalePostCloneCases(await createFreshCloneFixture(t));
});
