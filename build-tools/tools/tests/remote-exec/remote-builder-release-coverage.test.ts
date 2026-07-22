#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertReleaseRemoteBuilderCoverage,
  type ReviewedRemoteBuilderRegistry,
} from "../../remote-exec/remote-builder-authority";
import { RELEASE_BUILDER_SYSTEMS } from "../../lib/artifact-reproducibility-matrix";

function registry(counts: readonly number[]): ReviewedRemoteBuilderRegistry {
  return {
    schema: "viberoots.reviewed-remote-builders.v3",
    evidenceStore: {
      schema: "viberoots.reproducibility-evidence-store.v1",
      storeUri: "s3://reviewed-evidence/reproducibility",
      signatures: "required",
    },
    builders: RELEASE_BUILDER_SYSTEMS.flatMap((supportedSystem, systemIndex) =>
      Array.from({ length: counts[systemIndex] || 0 }, (_, slot) => ({
        identity: `reviewed:${supportedSystem}-${slot}` as const,
        supportedSystem,
        endpoint: {} as never,
        policyStorePath: `/nix/store/${"a".repeat(32)}-policy-${systemIndex}-${slot}`,
        probeFlakeStorePath: `/nix/store/${"b".repeat(32)}-probes-${systemIndex}-${slot}`,
      })),
    ),
  };
}

test("release registry requires exactly two independent entries per release system", () => {
  assert.doesNotThrow(() => assertReleaseRemoteBuilderCoverage(registry([2, 2, 2])));
  assert.throws(
    () => assertReleaseRemoteBuilderCoverage(registry([1, 2, 2])),
    /exactly 6 reviewed builders/,
  );
  assert.throws(
    () => assertReleaseRemoteBuilderCoverage(registry([3, 2, 1])),
    /exactly two reviewed builders for aarch64-darwin/,
  );
});
