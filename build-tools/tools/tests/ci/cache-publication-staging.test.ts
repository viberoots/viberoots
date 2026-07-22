import assert from "node:assert/strict";
import { test } from "node:test";
import { systemReproducibilityOutputs } from "../../ci/cache-publication-evidence";
import { stageSystemReproducibilityOutputs } from "../../ci/cache-publication-inputs";
import { signedCacheAggregateFixture } from "./cache-publication.fixture";

test("cache publication stages system production roots through reviewed substituters", async () => {
  const aggregate = signedCacheAggregateFixture();
  const outputs = systemReproducibilityOutputs(aggregate, "x86_64-linux").map(
    ({ outputPath }) => outputPath,
  );
  const calls: string[][] = [];
  await stageSystemReproducibilityOutputs(
    aggregate,
    "x86_64-linux",
    { workspaceRoot: process.cwd(), artifactToolsRoot: "/nix/store/tools" },
    async (args) => {
      calls.push(args);
    },
  );
  assert.deepEqual(calls, [
    ["copy", "--from", aggregate.evidenceStoreUri, ...outputs],
    ["path-info", ...outputs],
  ]);
});
