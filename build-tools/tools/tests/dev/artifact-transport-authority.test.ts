#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  artifactTransportEnvironment,
  buildArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";
import { remoteCiToolsPathEnv } from "../../remote-exec/nix-remote-builder-config";

test("artifact transport constructs Nix authority from the canonical tool closure", () => {
  const tools = canonicalArtifactToolsRoot(process.cwd());
  const canonicalCert = path.join(tools, "etc", "ssl", "certs", "ca-bundle.crt");
  const transport = artifactTransportEnvironment({
    WORKSPACE_ROOT: "/host/workspace",
    VIBEROOTS_ROOT: "/host/viberoots",
    NIX_CONFIG: "builders = ssh://host",
    NIX_REMOTE: "daemon",
    NIX_SSL_CERT_FILE: "/tmp/host-cert.pem",
    DEV_BUILD_LOW_SPACE_GB: "0",
    VBR_GC_MODE: "off",
    VBR_VERIFY_LOCK_DIR: "/tmp/verify-lock",
  });
  const env = remoteCiToolsPathEnv(tools, transport);
  assert.equal(env.NIX_REMOTE, "daemon");
  assert.equal(env.NIX_SSL_CERT_FILE, canonicalCert);
  assert.equal(env.SSL_CERT_FILE, undefined);
  assert.equal(transport.NIX_REMOTE, undefined);
  assert.equal(transport.NIX_SSL_CERT_FILE, undefined);
  assert.equal(env.WORKSPACE_ROOT, undefined);
  assert.equal(env.NIX_CONFIG, undefined);
  assert.equal(transport.DEV_BUILD_LOW_SPACE_GB, "0");
  assert.equal(transport.VBR_GC_MODE, "off");
  assert.equal(transport.VBR_VERIFY_LOCK_DIR, "/tmp/verify-lock");
  assert.throws(
    () => remoteCiToolsPathEnv(tools, { WORKSPACE_ROOT: "/host/workspace" }),
    /ambient selectors: WORKSPACE_ROOT/,
  );
  assert.throws(
    () => remoteCiToolsPathEnv("/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-other-tools", {}),
    /must equal the canonical generated artifact tool authority/,
  );
});

test("artifact transport rejects host-selected Nix stores and certificate authorities", () => {
  const tools = canonicalArtifactToolsRoot(process.cwd());
  for (const hostile of ["local", "unix:///tmp/host-nix.sock", "ssh://host-store"]) {
    assert.throws(
      () => artifactTransportEnvironment({ NIX_REMOTE: hostile }),
      /rejects ambient NIX_REMOTE authority/,
    );
    assert.throws(
      () =>
        buildArtifactEnvironment({
          baseEnv: { NIX_REMOTE: hostile },
          mode: "local",
          stateRoot: path.join(process.cwd(), "buck-out", "tmp", "hostile-nix-remote"),
          workspaceRoot: process.cwd(),
          artifactToolsRoot: tools,
        }),
      /rejects ambient NIX_REMOTE authority/,
    );
  }
  for (const [name, supplied] of [
    ["NIX_SSL_CERT_FILE", "/tmp/host-cert.pem"],
    ["SSL_CERT_FILE", "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-other-cert.pem"],
  ] as const) {
    assert.throws(
      () =>
        buildArtifactEnvironment({
          baseEnv: { [name]: supplied },
          mode: "local",
          stateRoot: path.join(process.cwd(), "buck-out", "tmp", "hostile-cert"),
          workspaceRoot: process.cwd(),
          artifactToolsRoot: tools,
        }),
      new RegExp(`rejects (?:unavailable|unreviewed) ${name}`),
    );
  }
  assert.throws(
    () =>
      buildArtifactEnvironment({
        baseEnv: {},
        mode: "local",
        stateRoot: path.join(process.cwd(), "buck-out", "tmp", "internal-transport"),
        workspaceRoot: process.cwd(),
        artifactToolsRoot: tools,
        internal: {
          NIX_REMOTE: "ssh://host-store",
          NIX_SSL_CERT_FILE: "/host/cert.pem",
          SSL_CERT_FILE: "/host/cert.pem",
        },
      }),
    /cannot override canonical keys: NIX_REMOTE, NIX_SSL_CERT_FILE, SSL_CERT_FILE/,
  );
});

test("artifact transport accepts the pinned CA identity and emits canonical paths", () => {
  const tools = canonicalArtifactToolsRoot(process.cwd());
  const canonicalCert = path.join(tools, "etc", "ssl", "certs", "ca-bundle.crt");
  const canonicalLocal = buildArtifactEnvironment({
    baseEnv: {
      NIX_REMOTE: "daemon",
      NIX_SSL_CERT_FILE: fs.realpathSync(canonicalCert),
      SSL_CERT_FILE: fs.realpathSync(canonicalCert),
    },
    mode: "local",
    stateRoot: path.join(process.cwd(), "buck-out", "tmp", "canonical-transport"),
    workspaceRoot: process.cwd(),
    artifactToolsRoot: tools,
  });
  assert.equal(canonicalLocal.NIX_REMOTE, "daemon");
  assert.equal(canonicalLocal.NIX_SSL_CERT_FILE, canonicalCert);
  assert.equal(canonicalLocal.SSL_CERT_FILE, canonicalCert);
});
