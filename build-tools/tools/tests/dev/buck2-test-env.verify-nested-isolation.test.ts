#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVerifyTestEnvArgs,
  previewVerifyNestedBuckIsolation,
} from "../../dev/verify/buck2-test-env";

test("verify child env reuses a shared nested buck isolation per pass", () => {
  const shared = previewVerifyNestedBuckIsolation("v-123", "shared");
  const isolated = previewVerifyNestedBuckIsolation("v-123", "isolated://foo:bar");
  assert.equal(shared, previewVerifyNestedBuckIsolation("v-123", "shared"));
  assert.notEqual(shared, isolated);
  assert.match(shared, /^verify-nested-123-/);
  assert.match(isolated, /^verify-nested-123-/);

  const envArgs = buildVerifyTestEnvArgs({
    iso: "v-123",
    passName: "shared",
    zxNodeModulesOut: "/tmp/zx-node-modules",
    nodeTestTimeoutMs: 120_000,
    testNixTimeoutSecs: 1800,
  });
  assert.ok(envArgs.includes(`BUCK_NESTED_ISO=${shared}`));
  assert.ok(envArgs.includes("BUCK_EXPORTER_REUSE_DAEMON=1"));
});

test("verify child env propagates dev-shell Nix certificate env", () => {
  const prev = {
    NIX_SSL_CERT_FILE: process.env.NIX_SSL_CERT_FILE,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
  };
  try {
    process.env.NIX_SSL_CERT_FILE = "/nix/store/cacert/etc/ssl/certs/ca-bundle.crt";
    delete process.env.SSL_CERT_FILE;
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-config";
    delete process.env.NODE_EXTRA_CA_CERTS;

    const envArgs = buildVerifyTestEnvArgs({
      iso: "v-123",
      passName: "shared",
      zxNodeModulesOut: "/tmp/zx-node-modules",
      nodeTestTimeoutMs: 120_000,
      testNixTimeoutSecs: 1800,
    });

    assert.ok(envArgs.includes("NIX_SSL_CERT_FILE=/nix/store/cacert/etc/ssl/certs/ca-bundle.crt"));
    assert.ok(envArgs.includes("SSL_CERT_FILE=/nix/store/cacert/etc/ssl/certs/ca-bundle.crt"));
    assert.ok(
      envArgs.includes("NODE_EXTRA_CA_CERTS=/nix/store/cacert/etc/ssl/certs/ca-bundle.crt"),
    );
    assert.ok(envArgs.includes("XDG_CONFIG_HOME=/tmp/xdg-config"));
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (typeof value === "string") process.env[key] = value;
      else delete process.env[key];
    }
  }
});
