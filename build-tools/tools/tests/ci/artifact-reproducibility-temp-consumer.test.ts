import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("temp consumer composes managed child and owned-tree lifecycle authorities", async () => {
  const owner = await fs.readFile(
    viberootsSourcePath("build-tools/tools/ci/artifact-reproducibility-temp-consumer.ts"),
    "utf8",
  );
  const artifactCommand = await fs.readFile(
    viberootsSourcePath("build-tools/tools/ci/artifact-command.ts"),
    "utf8",
  );
  const managed = await fs.readFile(
    viberootsSourcePath("build-tools/tools/lib/managed-command.ts"),
    "utf8",
  );
  assert.match(owner, /claimBundleTempRoot\(ownedRoot, artifactEnv\)/u);
  assert.match(owner, /withOwnedTempCleanup/u);
  assert.match(owner, /runArtifactTool/u);
  assert.match(owner, /VBR_UPDATE: "1"/u);
  assert.match(owner, /VBR_RUN_INSTALL: "0"/u);
  assert.match(owner, /VBR_DIRENV_ALLOW: "0"/u);
  assert.match(owner, /VBR_VIBEROOTS_URL: `path:\$\{immutableSource\}`/u);
  assert.doesNotMatch(owner, /viberoots\.dev\/bootstrap|bootstrap-url/u);
  assert.match(owner, /GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z"/u);
  assert.match(owner, /GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z"/u);
  assert.match(owner, /internalEnv/u);
  assert.doesNotMatch(owner, /"bootstrap"\), "update"/u);
  assert.doesNotMatch(owner, /mkdtempNoindex|\.noindex/u);
  assert.match(artifactCommand, /runBoundedArtifactCommand/u);
  assert.match(managed, /detached: true/u);
  assert.match(managed, /startParentWatchdog\(\)/u);
  assert.match(managed, /process\.kill\(-pid, signal\)/u);
});
