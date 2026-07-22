#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  buildCacheManifest,
  manifestStorePaths,
  remoteCiToolsPathEnv,
  renderPublisherCommand,
} from "../../ci/cache-manifest";
import { systemReproducibilityOutputs } from "../../ci/cache-publication-evidence";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { signedCacheAggregateFixture } from "./cache-publication.fixture";
import { registerCachePublisherSecretContract } from "./publish-nix-cache-publisher-contract";

test("protected manifest derives production roots and provenance only from the signed aggregate", () => {
  const aggregate = signedCacheAggregateFixture();
  const outputs = systemReproducibilityOutputs(aggregate, "x86_64-linux").map(
    ({ outputPath }) => outputPath,
  );
  const manifest = buildCacheManifest({
    system: "x86_64-linux",
    cacheEndpoint: "s3://writer@example-cache?secret=not-persisted",
    backend: "nix-copy",
    reproducibilityAggregate: aggregate,
  });
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.sourceRevision, aggregate.aggregate.sourceRevision);
  assert.deepEqual(
    manifest.attrs.map(({ outputPaths }) => outputPaths[0]),
    outputs,
  );
  assert.deepEqual(manifestStorePaths(manifest), [
    ...outputs,
    `/nix/store/${"a".repeat(32)}-aggregate`,
  ]);
  assert.doesNotMatch(JSON.stringify(manifest), /flakeLock|sourcePlans|toolVersions|flakeArchive/);
  assert.doesNotMatch(manifest.cacheEndpointIdentity, /not-persisted|writer@example/);
});

test("cache publisher renders backend commands without persisting credentials", () => {
  const aggregate = signedCacheAggregateFixture();
  const outputs = systemReproducibilityOutputs(aggregate, "aarch64-linux").map(
    ({ outputPath }) => outputPath,
  );
  const manifest = buildCacheManifest({
    system: "aarch64-linux",
    cacheEndpoint: "cache.example.internal",
    backend: "attic",
    reproducibilityAggregate: aggregate,
    declaredRemoteExecutables: ["attic"],
  });

  assert.deepEqual(renderPublisherCommand(manifest, "ci-cache", aggregate), [
    "attic",
    "push",
    "ci-cache",
    ...outputs,
    `/nix/store/${"a".repeat(32)}-aggregate`,
  ]);
  assert.throws(
    () =>
      renderPublisherCommand(
        { ...manifest, backend: "cachix", declaredRemoteExecutables: [] },
        "ci-cache",
        aggregate,
      ),
    /requires cachix in remote-ci-tools closure/,
  );
  for (const destination of [
    "cachix://cache?token=inline",
    "s3://writer:abc123@example-cache",
    "s3://example-cache?X-Amz-Credential=value",
  ]) {
    assert.throws(
      () => renderPublisherCommand(manifest, destination, aggregate),
      /must not contain credential material/,
    );
  }
});

test("cache publishing can restrict PATH to the remote-ci-tools closure", () => {
  const tools = canonicalArtifactToolsRoot(process.cwd());
  const env = remoteCiToolsPathEnv(tools, { PATH: "/usr/bin", HOME: "/host/home" });
  assert.equal(env.PATH, `${tools}/bin`);
  assert.notEqual(env.HOME, "/host/home");
  assert.throws(() => remoteCiToolsPathEnv("", { PATH: "/usr/bin" }), /required/);
  assert.throws(() => remoteCiToolsPathEnv("/tmp/tools", {}), /must be a Nix store path/);
  assert.throws(
    () => remoteCiToolsPathEnv(`/nix/store/${"9".repeat(32)}-other-tools`, {}),
    /must equal the canonical generated artifact tool authority/,
  );
});

test("all cache publication entrypoints perform fixed protected admission before work", () => {
  const ciRoot = "viberoots/build-tools/tools/ci";
  const publicationEntrypoints = fs
    .readdirSync(ciRoot, { recursive: true })
    .map(String)
    .filter((entry) => entry.endsWith(".ts") && entry !== "cache-manifest.ts")
    .filter((entry) =>
      fs.readFileSync(`${ciRoot}/${entry}`, "utf8").includes("renderPublisherCommand"),
    );
  assert.deepEqual(publicationEntrypoints, [
    "publish-nix-cache-manifest.ts",
    "wheelhouse-preload.ts",
  ]);
  for (const entrypoint of publicationEntrypoints) {
    const source = fs.readFileSync(`${ciRoot}/${entrypoint}`, "utf8");
    const admission = source.indexOf("await admitCachePublication");
    assert.match(source, /cache-publication-policy/);
    assert.ok(admission > 0 && admission < source.indexOf("writeManifest("));
    assert.ok(source.indexOf("await readSignedReproducibilityAggregate") > admission);
    assert.ok(source.indexOf("await stageSystemReproducibilityOutputs") > admission);
  }
  const authority = fs.readFileSync(`${ciRoot}/cache-publication-policy.ts`, "utf8");
  assert.match(authority, /purpose: "cache-publication"/);
  assert.match(authority, /inspectWorkspaceArtifactSource/);
  assert.match(authority, /admitArtifactContext/);
});

registerCachePublisherSecretContract(test);
