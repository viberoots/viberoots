#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildVerifyTestEnvArgs } from "../../dev/verify/buck2-test-env";
import {
  consumeNestedCacheRoleTransport,
  nestedCacheRoleTransportEnv,
} from "../../dev/verify/nested-cache-role-transport";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { nixCachePolicyBindingDigest } from "../../lib/nix-cache-policy-capability";
import { sanitizeInheritedNixConfig } from "../../lib/nix-config-env";
import { parseNixCacheConfigValues } from "../../lib/nix-cache-readiness";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { mergeDevEnvironmentPreservingReviewedCache } from "../lib/test-helpers/run-in-temp/runtime-env";

const baseOptions: Parameters<typeof buildVerifyTestEnvArgs>[0] = {
  iso: "v-123",
  passName: "shared",
  zxNodeModulesOut: null,
  nodeTestTimeoutMs: 120_000,
  testNixTimeoutSecs: 1800,
  artifactToolsRoot: canonicalArtifactToolsRoot(
    process.cwd(),
    String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
  ),
};

function envValue(envArgs: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  return envArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

test("temp dev env cannot replace reviewed cache authority", () => {
  const env = {
    NIX_CONFIG: "substituters = https://reviewed.example",
    VBR_NIX_CACHE_ROLE_AUTHORITY: "verify-nested-v1",
    VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG: "substituters = https://reviewed.example",
  };
  mergeDevEnvironmentPreservingReviewedCache(
    env,
    [
      "NIX_CONFIG=substituters = https://ambient.example",
      "VBR_NIX_CACHE_ROLE_AUTHORITY=ambient",
      "VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG=ambient",
      "DEV_SHELL_TOOL=available",
      "",
    ].join("\0"),
  );
  assert.equal(env.NIX_CONFIG, "substituters = https://reviewed.example");
  assert.equal(env.VBR_NIX_CACHE_ROLE_AUTHORITY, "verify-nested-v1");
  assert.equal(env.VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG, "substituters = https://reviewed.example");
  assert.equal((env as Record<string, string>).DEV_SHELL_TOOL, "available");
});

test("verify child env carries bound cache roles across nested Buck boundaries", () => {
  const previous = {
    NIX_CONFIG: process.env.NIX_CONFIG,
    VBR_NIX_CACHE_POLICY: process.env.VBR_NIX_CACHE_POLICY,
  };
  try {
    const required = "https://required.example";
    const optional = "https://optional.example";
    const reviewedConfig = [
      `substituters = ${required}`,
      `extra-substituters = ${optional}`,
      "fallback = true",
    ].join("\n");
    delete process.env.NIX_CONFIG;
    process.env.VBR_NIX_CACHE_POLICY = "auto";
    const envArgs = buildVerifyTestEnvArgs({
      ...baseOptions,
      cacheHealth: {
        authority: "reviewed",
        changed: false,
        kept: [required, optional],
        removed: [],
        nixConfig: reviewedConfig,
        requiredSubstituters: [required],
        optionalSubstituters: [optional],
      },
    });
    const childConfig = sanitizeInheritedNixConfig(
      [
        `substituters = ${required}`,
        `extra-substituters = ${optional}`,
        "connect-timeout = 3",
        "stalled-download-timeout = 10",
        "fallback = true",
      ].join("\n"),
    );
    assert.ok(childConfig);
    assert.equal(envValue(envArgs, "NIX_CONFIG"), childConfig);
    assert.equal(envValue(envArgs, "VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG"), childConfig);
    assert.equal(envValue(envArgs, "VBR_NIX_CACHE_ROLE_REQUIRED"), required);
    assert.equal(envValue(envArgs, "VBR_NIX_CACHE_ROLE_OPTIONAL"), optional);
    assert.equal(
      Buffer.from(
        String(envValue(envArgs, "VBR_NIX_CACHE_ROLE_CONFIG_B64") || ""),
        "base64",
      ).toString("utf8"),
      childConfig,
    );
    assert.equal(envValue(envArgs, "VBR_NIX_CACHE_ROLE_POLICY"), "auto");
    assert.equal(
      envValue(envArgs, "VBR_NIX_CACHE_ROLE_BINDING"),
      nixCachePolicyBindingDigest({
        kind: "reviewed",
        config: childConfig,
        policy: "auto",
        requiredSubstituters: [required],
        optionalSubstituters: [optional],
      }),
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (typeof value === "string") process.env[key] = value;
      else delete process.env[key];
    }
  }
});

test("verify child canonicalizes baseline roles and excludes removed optional caches", () => {
  const required = "https://required.example";
  const removedOptional = "https://removed.example";
  const envArgs = buildVerifyTestEnvArgs({
    ...baseOptions,
    cacheHealth: {
      authority: "reviewed",
      changed: true,
      kept: [required],
      removed: [removedOptional],
      nixConfig: "builders =",
      requiredSubstituters: [required],
      optionalSubstituters: [],
    },
  });
  const childConfig = String(envValue(envArgs, "NIX_CONFIG") || "");
  const parsed = parseNixCacheConfigValues(childConfig);
  assert.deepEqual(parsed.get("substituters"), [required]);
  assert.deepEqual(parsed.get("extra-substituters"), []);
  const emptyNixConf = fs.mkdtempSync(path.join(os.tmpdir(), "nested-cache-normalized-"));
  try {
    const effective = execFileSync(resolveToolPathSync("nix"), ["config", "show"], {
      encoding: "utf8",
      env: { ...process.env, NIX_CONFIG: childConfig, NIX_CONF_DIR: emptyNixConf },
    });
    const normalized = parseNixCacheConfigValues(effective);
    assert.deepEqual(normalized.get("substituters"), [required]);
    assert.deepEqual(normalized.get("extra-substituters") || [], []);
  } finally {
    fs.rmSync(emptyNixConf, { recursive: true, force: true });
  }
  assert.doesNotMatch(childConfig, /removed\.example/);
  assert.equal(envValue(envArgs, "VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG"), childConfig);
  assert.equal(envValue(envArgs, "VBR_NIX_CACHE_ROLE_REQUIRED"), required);
  assert.equal(envValue(envArgs, "VBR_NIX_CACHE_ROLE_OPTIONAL"), "");
  const transportedConfig = Buffer.from(
    String(envValue(envArgs, "VBR_VERIFY_NESTED_CACHE_CONFIG") || ""),
    "base64",
  ).toString("utf8");
  assert.equal(transportedConfig, childConfig);
});

test("nested cache role aliases are consumed once and reject forged bindings", () => {
  const reviewedConfig =
    "substituters = https://required.example\nextra-substituters = https://optional.example";
  const reviewed = {
    kind: "reviewed" as const,
    config: reviewedConfig,
    policy: "auto" as const,
    requiredSubstituters: ["https://required.example"],
    optionalSubstituters: ["https://optional.example"],
  };
  const env: NodeJS.ProcessEnv = {
    NIX_CONFIG: `${reviewedConfig}\nextra-substituters = https://ambient.example`,
    ...nestedCacheRoleTransportEnv(reviewed),
  };
  const consumed = consumeNestedCacheRoleTransport(env);
  assert.equal(consumed.length, 14);
  assert.ok(consumed.includes(`NIX_CONFIG=${reviewedConfig}`));
  assert.equal(env.NIX_CONFIG, reviewedConfig);
  assert.equal(env.VBR_NIX_CACHE_ROLE_REQUIRED, "https://required.example");
  assert.equal(env.VBR_NIX_CACHE_ROLE_OPTIONAL, "https://optional.example");
  assert.equal(env.VBR_NIX_CACHE_ROLE_POLICY, "auto");
  assert.equal(env.VBR_NIX_CACHE_ROLE_BINDING, nixCachePolicyBindingDigest(reviewed));
  assert.equal(
    Buffer.from(String(env.VBR_NIX_CACHE_ROLE_CONFIG_B64 || ""), "base64").toString("utf8"),
    reviewedConfig,
  );
  assert.equal(env.VBR_NIX_CACHE_ROLE_AUTHORITY, "verify-nested-v1");
  assert.equal(consumeNestedCacheRoleTransport(env).length, 0);

  const forged = {
    NIX_CONFIG: reviewedConfig,
    ...nestedCacheRoleTransportEnv(reviewed),
    VBR_VERIFY_NESTED_CACHE_BINDING: "0".repeat(64),
  };
  assert.throws(() => consumeNestedCacheRoleTransport(forged), /binding is invalid/);
  assert.equal(forged.VBR_VERIFY_NESTED_CACHE_BINDING, undefined);

  const mismatched = {
    ...nestedCacheRoleTransportEnv(reviewed),
    VBR_VERIFY_NESTED_CACHE_CONFIG: Buffer.from(
      "substituters = https://different.example",
      "utf8",
    ).toString("base64"),
  };
  assert.throws(
    () => consumeNestedCacheRoleTransport(mismatched),
    /does not match effective substituters/,
  );

  const malformedConfig = {
    ...nestedCacheRoleTransportEnv(reviewed),
    VBR_VERIFY_NESTED_CACHE_CONFIG: "not-base64",
  };
  assert.throws(
    () => consumeNestedCacheRoleTransport(malformedConfig),
    /transport config is invalid/,
  );

  const removedOptionalAmbient = {
    NIX_CONFIG: `${reviewedConfig}\nextra-substituters = https://removed.example`,
    ...nestedCacheRoleTransportEnv(reviewed),
  };
  const nested = consumeNestedCacheRoleTransport(removedOptionalAmbient);
  assert.ok(nested.includes(`NIX_CONFIG=${reviewedConfig}`));
  assert.ok(!nested.some((arg) => arg.includes("removed.example")));
});
