#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
  validateArtifactToolsRoot,
} from "../../lib/artifact-environment";
import { assertNoArtifactSelectorInjection } from "../../lib/artifact-environment-policy";
import { buildCanonicalIngressEnvironment } from "../../dev/canonical-artifact-ingress-environment";
import {
  assertCanonicalArtifactReentry,
  isCanonicalArtifactEntrypointEnvironment,
} from "../../dev/canonical-artifact-entrypoint";
import { assertReviewedBuckArtifactSelectors } from "../../dev/dev-build/buck";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("known local compiler and language selectors fail before sanitization", () => {
  for (const [name, value] of Object.entries({
    CPATH: "/host/include",
    SDKROOT: "/host/sdk",
    GOTOOLCHAIN: "local",
    CGO_CFLAGS: "-march=native",
    CMAKE_TOOLCHAIN_FILE: "/host/toolchain.cmake",
    GOFLAGS: "-mod=vendor",
    NIX_CONFIG: "builders = ssh://host",
    NIX_CFLAGS_COMPILE: "-march=native",
    NIX_PROFILES: "/host/profile",
    NIX_USER_PROFILE_DIR: "/host/user-profile",
    NODE_PATH: "/host/node-modules",
    PYTHONPATH: "/host/python",
    RUSTFLAGS: "-C target-cpu=native",
    XPC_FLAGS: "host-session",
  })) {
    assert.throws(() => assertNoArtifactSelectorInjection({ [name]: value }), new RegExp(name));
  }
});

test("canonical ingress preserves a validated build concurrency cap", () => {
  const toolsRoot = canonicalArtifactToolsRoot(process.cwd());
  const withConcurrency = buildCanonicalIngressEnvironment({
    env: {
      NIX_BUILD_CORES: "4",
      VBR_HEAVY_FANOUT_PERMIT: "viberoots-heavy-fanout",
    },
    workspaceRoot: process.cwd(),
    toolsRoot,
    wasmBackend: "",
  });
  assert.equal(withConcurrency.NIX_BUILD_CORES, "4");
  assert.equal(withConcurrency.VBR_HEAVY_FANOUT_PERMIT, undefined);
  assert.throws(
    () =>
      buildCanonicalIngressEnvironment({
        env: { NIX_BUILD_CORES: "unbounded" },
        workspaceRoot: process.cwd(),
        toolsRoot,
        wasmBackend: "",
      }),
    /rejects invalid NIX_BUILD_CORES/,
  );
});

test("development ingress strips uncaptured ambient artifact influence", () => {
  const toolsRoot = canonicalArtifactToolsRoot(process.cwd());
  const env = {
    NIX_BUILD_CORES: "4",
    NIX_RUST_DEV_OVERRIDE_JSON: '{"crate":"/explicit"}',
    RUST_WATCH_AMBIENT_SENTINEL: "must-not-reach-build",
    VIBEROOTS_ROOT: "/host/source",
  };
  assert.throws(
    () =>
      buildCanonicalIngressEnvironment({
        env,
        workspaceRoot: process.cwd(),
        toolsRoot,
        wasmBackend: "",
      }),
    /RUST_WATCH_AMBIENT_SENTINEL|VIBEROOTS_ROOT/u,
  );
  const stripped = buildCanonicalIngressEnvironment({
    env,
    workspaceRoot: process.cwd(),
    toolsRoot,
    wasmBackend: "",
    stripAmbientArtifactInfluence: true,
  });
  assert.equal(stripped.NIX_BUILD_CORES, "4");
  assert.equal(stripped.NIX_RUST_DEV_OVERRIDE_JSON, undefined);
  assert.equal(stripped.RUST_WATCH_AMBIENT_SENTINEL, undefined);
  assert.equal(stripped.VIBEROOTS_ROOT, undefined);
});

test("Buck accepts only the exact cache-health NIX_CONFIG authority", () => {
  const reviewed = "substituters =\nextra-substituters =\nfallback = true";
  assert.doesNotThrow(() =>
    assertReviewedBuckArtifactSelectors({ NIX_CONFIG: reviewed }, reviewed),
  );
  assert.throws(
    () =>
      assertReviewedBuckArtifactSelectors(
        { NIX_CONFIG: `${reviewed}\nbuilders = ssh://host` },
        reviewed,
      ),
    /mismatched internal NIX_CONFIG authority/,
  );
  assert.throws(() => assertReviewedBuckArtifactSelectors({ NIX_CONFIG: reviewed }), /NIX_CONFIG/);
});

test("canonical Node cannot admit a spoofed marker with ambient process state", () => {
  const canonical = buildCanonicalArtifactEnvironment(process.cwd(), {
    artifactToolsRoot: canonicalArtifactToolsRoot(
      process.cwd(),
      String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
    ),
  });
  assert.equal(
    isCanonicalArtifactEntrypointEnvironment(
      {
        ...canonical,
        PATH: "/tmp/host-bin",
        VBR_CANONICAL_ARTIFACT_ENTRYPOINT: "1",
      },
      canonical,
    ),
    false,
  );
  assert.equal(
    isCanonicalArtifactEntrypointEnvironment(
      { ...canonical, VBR_CANONICAL_ARTIFACT_ENTRYPOINT: "1" },
      canonical,
    ),
    true,
  );
  for (const hostile of [
    { CC: "clang" },
    { NODE_OPTIONS: "--require /host/hook.js" },
    { HOME: "/host/home" },
  ]) {
    assert.equal(
      isCanonicalArtifactEntrypointEnvironment(
        { ...canonical, ...hostile, VBR_CANONICAL_ARTIFACT_ENTRYPOINT: "1" },
        canonical,
      ),
      false,
      JSON.stringify(hostile),
    );
  }
});

test("a corrupt primary tool manifest fails closed before asserted authority fallback", () => {
  const tmp = fs.mkdtempSync("/tmp/vbr-corrupt-tool-authority-");
  const manifest = path.join(tmp, ".viberoots", "workspace", "toolchain-paths.json");
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, "{ invalid json\n");
  try {
    assert.throws(
      () =>
        canonicalArtifactToolsRoot(
          tmp,
          canonicalArtifactToolsRoot(
            process.cwd(),
            String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
          ),
        ),
      /canonical artifact tool authority is invalid.*run u && i/,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("threaded artifact authority wins after ambient authority mutation", () => {
  const canonicalRoot = canonicalArtifactToolsRoot(
    process.cwd(),
    String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
  );
  const previous = process.env.VBR_ARTIFACT_TOOLS_ROOT;
  process.env.VBR_ARTIFACT_TOOLS_ROOT =
    "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-poisoned-artifact-tools";
  try {
    const canonical = buildCanonicalArtifactEnvironment(process.cwd(), {
      artifactToolsRoot: canonicalRoot,
    });
    assert.equal(canonical.VBR_ARTIFACT_TOOLS_ROOT, canonicalRoot);
    assert.equal(canonical.PATH, `${canonicalRoot}/bin`);
  } finally {
    if (previous === undefined) delete process.env.VBR_ARTIFACT_TOOLS_ROOT;
    else process.env.VBR_ARTIFACT_TOOLS_ROOT = previous;
  }
});

test("canonical re-entry binds the asserted closure to the running executable", () => {
  const toolsRoot = canonicalArtifactToolsRoot(
    process.cwd(),
    String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
  );
  assert.equal(assertCanonicalArtifactReentry(toolsRoot, `${toolsRoot}/bin/node`), toolsRoot);
  assert.throws(
    () => assertCanonicalArtifactReentry(toolsRoot, `${toolsRoot}/bin/bash`),
    /executable does not match asserted tool authority/,
  );
});

test("artifact authority requires the complete ingress tool contract", () => {
  const toolsRoot = canonicalArtifactToolsRoot(
    process.cwd(),
    String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
  );
  const incompleteRoot = path.dirname(path.dirname(fs.realpathSync(`${toolsRoot}/bin/yq`)));
  assert.match(incompleteRoot, /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/);
  assert.throws(
    () => validateArtifactToolsRoot(incompleteRoot, "incomplete test artifact authority"),
    /canonical artifact tool authority is missing/,
  );
});

test("startup checks use the explicit canonical Node child boundary", () => {
  const startup = fs.readFileSync(
    viberootsSourcePath("build-tools/tools/dev/dev-build/startup.ts"),
    "utf8",
  );
  assert.match(startup, /runNodeWithZx\(\{/);
  assert.match(startup, /nodeBin: process\.execPath/);
  assert.doesNotMatch(startup, /\$\(\{[\s\S]*?\}\)`\$\{process\.execPath\}/);
});

test("Buck artifact actions replace every conventional temp authority", () => {
  const shell = fs.readFileSync(viberootsSourcePath("build-tools/lang/nix_shell.bzl"), "utf8");
  assert.match(shell, /TMPDIR=\\"\$VBR_ARTIFACT_STATE\/tmp\\"/);
  assert.match(shell, /TMP=\\"\$VBR_ARTIFACT_STATE\/tmp\\"/);
  assert.match(shell, /TEMP=\\"\$VBR_ARTIFACT_STATE\/tmp\\"/);
  assert.match(shell, /artifact action requires runner-owned temporary state/);
  assert.match(shell, /`mktemp -d \\\"\$TMPDIR\/vbr-artifact-state\.XXXXXX\\\"`/);
  assert.doesNotMatch(shell, /\$\$\(mktemp/);
  assert.match(shell, /trap 'rm -rf \\\"\$VBR_ARTIFACT_STATE\\\"' EXIT/);
  assert.doesNotMatch(shell, /buck-out\/tmp\/artifact-environment\/action/);
  assert.ok(
    shell.lastIndexOf("+ nix_artifact_environment_shell()") >
      shell.lastIndexOf('export TMP=\\"${TMPDIR:-/tmp}\\"'),
    "the composed artifact environment must replace bootstrap temp authorities after root discovery",
  );
});
