#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  buildCacheManifest,
  discoverCacheAttrs,
  manifestStorePaths,
  remoteCiToolsPathEnv,
  renderPublisherCommand,
} from "../../ci/cache-manifest";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { registerCachePublisherSecretContract } from "./publish-nix-cache-publisher-contract";

const archive = {
  path: "/nix/store/source-flake",
  inputs: {
    nixpkgs: { path: "/nix/store/source-nixpkgs" },
  },
};

test("cache manifest records attrs, archive paths, exact outputs, and redacted endpoint identity", () => {
  const manifest = buildCacheManifest({
    system: "x86_64-linux",
    sourceRevision: "abc123",
    flakeLockText: '{"nodes":{}}',
    attrs: [".#graph-generator", ".#graph-generator", ".#remote-worker-tools"],
    outputPaths: {
      ".#graph-generator": ["/nix/store/graph-generator"],
      ".#remote-worker-tools": ["/nix/store/remote-worker-tools"],
    },
    flakeArchiveJson: archive,
    cacheEndpoint: "s3://writer@example-cache?secret=not-persisted",
    backend: "nix-copy",
    toolVersions: { nix: "nix 2.30", node: "v22.0.0" },
    declaredRemoteExecutables: [],
    selectedGraphOutputs: ["/nix/store/selected-graph"],
    selectedTargetOutputs: ["/nix/store/selected-target"],
    sourcePlans: [
      {
        target: "//projects/apps/demo:tool",
        nixpkgs_profile: "default",
        nixpkg_pins: {
          "pkgs.openssl": {
            nixpkgs_profile: "nixpkgs-23_11",
          },
        },
      },
    ],
  });

  assert.equal(manifest.system, "x86_64-linux");
  assert.equal(manifest.attrs.length, 2);
  assert.deepEqual(manifest.flakeArchivePaths, [
    "/nix/store/source-flake",
    "/nix/store/source-nixpkgs",
  ]);
  assert.match(manifest.flakeLockHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(manifest.cacheEndpointIdentity, /not-persisted|writer@example/);
  assert.deepEqual(manifestStorePaths(manifest), [
    "/nix/store/source-flake",
    "/nix/store/source-nixpkgs",
    "/nix/store/graph-generator",
    "/nix/store/remote-worker-tools",
    "/nix/store/selected-graph",
    "/nix/store/selected-target",
  ]);
  assert.deepEqual(manifest.sourcePlans, [
    {
      target: "//projects/apps/demo:tool",
      nixpkgs_profile: "default",
      nixpkg_pins: {
        "pkgs.openssl": {
          nixpkgs_profile: "nixpkgs-23_11",
        },
      },
    },
  ]);
});

test("cache manifest discovers initial, wheelhouse, and node module attrs", () => {
  assert.deepEqual(discoverCacheAttrs(["py-wheelhouse-app", "node-modules.default", "ignored"]), [
    ".#graph-generator",
    ".#buck2-prelude",
    ".#test-seed",
    ".#remote-worker-tools",
    ".#toolchains.go",
    ".#toolchains.cxx",
    ".#toolchains.python",
    ".#py-wheelhouse-app",
    ".#node-modules.default",
  ]);
});

test("cache publisher renders backend commands without persisting credentials", () => {
  const manifest = buildCacheManifest({
    system: "aarch64-linux",
    sourceRevision: "def456",
    flakeLockText: "{}",
    attrs: [".#test-seed"],
    outputPaths: { ".#test-seed": ["/nix/store/test-seed"] },
    flakeArchiveJson: archive,
    cacheEndpoint: "cache.example.internal",
    backend: "attic",
    toolVersions: {},
    declaredRemoteExecutables: ["attic"],
  });

  assert.deepEqual(renderPublisherCommand(manifest, "ci-cache"), [
    "attic",
    "push",
    "ci-cache",
    "/nix/store/source-flake",
    "/nix/store/source-nixpkgs",
    "/nix/store/test-seed",
  ]);
  assert.throws(
    () =>
      renderPublisherCommand(
        { ...manifest, backend: "cachix", declaredRemoteExecutables: [] },
        "ci-cache",
      ),
    /requires cachix in remote-ci-tools closure/,
  );
  assert.throws(
    () => renderPublisherCommand(manifest, "cachix://cache?token=inline"),
    /must not contain credential material/,
  );
  assert.throws(
    () => renderPublisherCommand(manifest, "s3://writer:abc123@example-cache"),
    /must not contain credential material/,
  );
  assert.throws(
    () => renderPublisherCommand(manifest, "s3://example-cache?X-Amz-Credential=value"),
    /must not contain credential material/,
  );
});

test("cache manifest rejects non-store paths and inline credential material", () => {
  assert.throws(
    () =>
      buildCacheManifest({
        system: "x86_64-linux",
        sourceRevision: "abc",
        flakeLockText: "{}",
        attrs: [".#missing"],
        outputPaths: {},
        flakeArchiveJson: archive,
        cacheEndpoint: "cache",
        backend: "none",
        toolVersions: {},
      }),
    /missing output paths/,
  );
  assert.throws(
    () =>
      buildCacheManifest({
        system: "x86_64-linux",
        sourceRevision: "abc",
        flakeLockText: "{}",
        attrs: [".#bad"],
        outputPaths: { ".#bad": ["/tmp/out"] },
        flakeArchiveJson: archive,
        cacheEndpoint: "cache",
        backend: "none",
        toolVersions: {},
      }),
    /expected Nix store path/,
  );
  assert.throws(
    () =>
      buildCacheManifest({
        system: "x86_64-linux",
        sourceRevision: "abc",
        flakeLockText: "{}",
        attrs: [],
        outputPaths: {},
        flakeArchiveJson: archive,
        cacheEndpoint: "Bearer abc123",
        backend: "none",
        toolVersions: {},
      }),
    /credential material/,
  );
  assert.throws(
    () =>
      buildCacheManifest({
        system: "x86_64-linux",
        sourceRevision: "abc",
        flakeLockText: "{}",
        attrs: [],
        outputPaths: {},
        flakeArchiveJson: archive,
        cacheEndpoint: "cache",
        backend: "none",
        toolVersions: {},
        selectedTargetOutputs: ["/tmp/target"],
      }),
    /expected Nix store path/,
  );
});

test("cache publishing can restrict PATH to the remote-ci-tools closure", () => {
  const tools = canonicalArtifactToolsRoot(process.cwd());
  const env = remoteCiToolsPathEnv(tools, {
    PATH: "/usr/bin",
    HOME: "/host/home",
  });
  assert.equal(env.PATH, `${tools}/bin`);
  assert.notEqual(env.HOME, "/host/home");
  assert.throws(() => remoteCiToolsPathEnv("", { PATH: "/usr/bin" }), /required/);
  assert.throws(() => remoteCiToolsPathEnv("/tmp/tools", {}), /expected Nix store path/);
});

test("all cache publication entrypoints perform fixed protected admission before work", () => {
  const ciRoot = "viberoots/build-tools/tools/ci";
  const publicationEntrypoints = fs
    .readdirSync(ciRoot, { recursive: true })
    .map((entry) => String(entry))
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
    const sourceAuthority = source.indexOf("await chooseRunnableFlakeRef");
    const artifactCommand = source.indexOf("await runArtifact");
    assert.ok(sourceAuthority > admission);
    assert.ok(artifactCommand > sourceAuthority);
  }
  const authority = fs.readFileSync(`${ciRoot}/cache-publication-policy.ts`, "utf8");
  assert.match(authority, /purpose: "cache-publication"/);
  assert.match(authority, /inspectWorkspaceArtifactSource/);
  assert.match(authority, /admitArtifactContext/);
});

registerCachePublisherSecretContract(test);
