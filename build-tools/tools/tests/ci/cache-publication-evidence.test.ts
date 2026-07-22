import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCacheManifest, renderPublisherCommand } from "../../ci/cache-manifest";
import { systemReproducibilityOutputs } from "../../ci/cache-publication-evidence";
import { signedCacheAggregateFixture } from "./cache-publication.fixture";

function manifest(system = "x86_64-linux") {
  const aggregate = signedCacheAggregateFixture();
  return {
    aggregate,
    value: buildCacheManifest({
      system,
      cacheEndpoint: "cache.example",
      backend: "nix-copy",
      reproducibilityAggregate: aggregate,
    }),
  };
}

test("protected cache publication selects current-system production roots from the signed aggregate", () => {
  const { aggregate, value } = manifest();
  const outputs = systemReproducibilityOutputs(aggregate, value.system).map(
    ({ outputPath }) => outputPath,
  );
  const command = renderPublisherCommand(value, "https://cache.example", aggregate);
  assert.deepEqual(command.slice(4), [...outputs, `/nix/store/${"a".repeat(32)}-aggregate`]);
  assert.equal(value.attrs.length, outputs.length);
});

test("protected cache publication requires its exact signed aggregate", () => {
  const { value } = manifest();
  assert.throws(
    () => renderPublisherCommand(value, "https://cache.example"),
    /exact signed reproducibility aggregate/,
  );
});

test("protected cache manifests reject unrelated supplemental roots", () => {
  const aggregate = signedCacheAggregateFixture();
  const value = buildCacheManifest({
    system: "x86_64-linux",
    cacheEndpoint: "cache.example",
    backend: "nix-copy",
    reproducibilityAggregate: aggregate,
  });
  value.attrs.push({
    name: "unreviewed",
    outputPaths: [`/nix/store/${"d".repeat(32)}-unrelated`],
  });
  assert.throws(
    () => renderPublisherCommand(value, "https://cache.example", aggregate),
    /must exactly match the signed aggregate outputs/,
  );
});

test("publisher excludes other-system aggregate roots", () => {
  const { aggregate, value } = manifest("aarch64-linux");
  const command = renderPublisherCommand(value, "https://cache.example", aggregate);
  const current = new Set(
    systemReproducibilityOutputs(aggregate, value.system).map(({ outputPath }) => outputPath),
  );
  for (const comparison of aggregate.aggregate.publicationComparisons) {
    if (comparison.system !== value.system) {
      assert.equal(command.includes(comparison.artifactIdentity.outputPath), false);
    } else {
      assert.ok(current.has(comparison.artifactIdentity.outputPath));
    }
  }
});

test("protected cache publication rejects incomplete publication comparisons", () => {
  const aggregate = structuredClone(signedCacheAggregateFixture());
  aggregate.aggregate.publicationComparisons.pop();
  assert.throws(
    () =>
      buildCacheManifest({
        system: "x86_64-linux",
        cacheEndpoint: "cache.example",
        backend: "nix-copy",
        reproducibilityAggregate: aggregate,
      }),
    /all 3 publication comparisons/,
  );
});

test("protected cache publication rejects systems outside the signed release set", () => {
  assert.throws(
    () => systemReproducibilityOutputs(signedCacheAggregateFixture(), "riscv64-linux"),
    /does not support Nix system/,
  );
});
