import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { resolveRevisionDomainsWithGit } from "../../ci/artifact-revision-domains";
import { aggregateArtifactReproducibilityEvidence } from "../../ci/artifact-reproducibility-aggregate";
import { assertRemoteCiToolsSourceIdentity } from "../../ci/remote-ci-tools-source-identity";
import {
  operational,
  publication,
  records,
  registry,
  registryStorePath,
  toolClosureRoot,
  toolClosureSourceIdentity,
} from "./artifact-reproducibility-aggregate-fixture";

const run = promisify(execFile);

test("consumer and tool revisions remain independent in a real submodule layout", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vbr-revision-domains-"));
  const toolOrigin = path.join(root, "tool-origin");
  const consumer = path.join(root, "consumer");
  try {
    await initRepository(toolOrigin, "tool.txt", "tool\n");
    await initRepository(consumer, "consumer.txt", "consumer\n");
    await git(consumer, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      toolOrigin,
      "viberoots",
    ]);
    await git(consumer, ["commit", "-am", "bind tool checkout"]);
    const revisions = await resolveRevisionDomainsWithGit(
      async (args) => await git(consumer, args),
    );
    assert.notEqual(revisions.sourceRevision, revisions.toolSourceRevision);
    assert.equal(revisions.sourceRevision, await git(consumer, ["rev-parse", "HEAD"]));
    assert.equal(
      revisions.toolSourceRevision,
      await git(consumer, ["-C", "viberoots", "rev-parse", "HEAD"]),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("consumer and tool revision staleness fail in their own domains", () => {
  const complete = records();
  const common = {
    registry: registry(),
    registryStorePath,
    publicationSubjects: [publication],
    records: complete,
    ...operational(complete),
    expectedToolClosureRoot: toolClosureRoot,
  };
  assert.doesNotThrow(() =>
    aggregateArtifactReproducibilityEvidence({
      ...common,
      expectedSourceRevision: "f".repeat(40),
      protectedRustPatchEvidence: common.protectedRustPatchEvidence,
    }),
  );
  assert.throws(
    () =>
      aggregateArtifactReproducibilityEvidence({
        ...common,
        expectedSourceRevision: "d".repeat(40),
        protectedRustPatchEvidence: common.protectedRustPatchEvidence,
      }),
    /source revision/u,
  );
  assert.throws(
    () => assertRemoteCiToolsSourceIdentity(toolClosureSourceIdentity(), "d".repeat(40)),
    /closure source identity/u,
  );
});

async function initRepository(root: string, file: string, contents: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "fixture@viberoots.invalid"]);
  await git(root, ["config", "user.name", "Fixture"]);
  await fs.writeFile(path.join(root, file), contents);
  await git(root, ["add", file]);
  await git(root, ["commit", "-m", "fixture"]);
}

async function git(root: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd: root })).stdout.trim();
}
