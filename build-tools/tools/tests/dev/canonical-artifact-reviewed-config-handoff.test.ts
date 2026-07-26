#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import {
  canonicalArtifactReentryEnvironment,
  isCanonicalArtifactEntrypointEnvironment,
} from "../../dev/canonical-artifact-entrypoint";
import { activateCanonicalNixCachePolicy } from "../../dev/canonical-reviewed-nix-config";
import { glueChildArtifactEnvironment } from "../../dev/dev-build/glue";
import { materializePureEvaluationEnvironment } from "../../dev/dev-build/materialize-pure";
import { runnableNixArtifactEnvironment } from "../../dev/run-runnable-nix";
import {
  buildArtifactEnvironment,
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import {
  currentNixCachePolicyCapability,
  type NixCachePolicyCapability,
} from "../../lib/nix-cache-policy-capability";

const reviewed = "builders =\nsubstituters =\nextra-substituters =\nfallback = true";
const toolsRoot = canonicalArtifactToolsRoot(
  process.cwd(),
  String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
);
test("canonical re-entry binds exact reviewed config bytes to their digest", () => {
  const expected = canonicalArtifactReentryEnvironment(process.cwd(), toolsRoot, {
    nixCacheHealth: { applied: true, config: reviewed },
  });
  assert.equal(expected.NIX_CONFIG, reviewed);
  assert.match(String(expected.VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST || ""), /^[a-f0-9]{64}$/);
  assert.equal(isCanonicalArtifactEntrypointEnvironment(expected, expected), true);
  assert.equal(
    isCanonicalArtifactEntrypointEnvironment(
      { ...expected, NIX_CONFIG: `${reviewed}\nconnect-timeout = 99` },
      expected,
    ),
    false,
  );
  assert.equal(
    isCanonicalArtifactEntrypointEnvironment(
      { ...expected, VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST: "0".repeat(64) },
      expected,
    ),
    false,
  );
  assert.equal(
    isCanonicalArtifactEntrypointEnvironment(
      {
        ...expected,
        VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS: "https://forged.example/cache",
      },
      expected,
    ),
    false,
  );
});

test("canonical re-entry binds a healthy empty cache decision to its digest", () => {
  const expected = canonicalArtifactReentryEnvironment(process.cwd(), toolsRoot, {
    nixCacheHealth: { applied: true, config: "" },
  });
  assert.equal(expected.NIX_CONFIG, undefined);
  assert.match(String(expected.VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST || ""), /^[a-f0-9]{64}$/);
  assert.equal(isCanonicalArtifactEntrypointEnvironment(expected, expected), true);
  assert.equal(
    isCanonicalArtifactEntrypointEnvironment(
      { ...expected, NIX_CONFIG: "substituters = https://cache.nixos.org/" },
      expected,
    ),
    false,
  );
});

test("canonical wrapper re-entry preserves nonempty role-bound review fields", () => {
  const roleConfig = [
    "substituters = https://required.example/cache",
    "extra-substituters = https://optional.example/cache",
    "fallback = true",
  ].join("\n");
  const env = canonicalArtifactReentryEnvironment(process.cwd(), toolsRoot, {
    nixCacheHealth: {
      applied: true,
      config: roleConfig,
      policy: "auto",
      requiredSubstituters: ["https://required.example/cache"],
      optionalSubstituters: ["https://optional.example/cache"],
    },
  });
  const moduleUrl = new URL("../../dev/canonical-artifact-entrypoint.ts", import.meta.url).href;
  const result = spawnSync(
    path.join(toolsRoot, "bin", "zx-wrapper"),
    [
      "-e",
      `const m = await import(${JSON.stringify(moduleUrl)}); m.enterCanonicalArtifactEntrypoint(process.cwd());`,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("artifact environments reject missing and forged reviewed-config authority", () => {
  assert.throws(
    () => currentNixCachePolicyCapability(),
    /cache health must be reviewed or explicitly off/,
  );
  assert.throws(
    () => activateCanonicalNixCachePolicy({}, { applied: true, config: reviewed }),
    /before canonical entry/,
  );
  const base = {
    baseEnv: withoutArtifactEnvironmentInfluence(process.env),
    mode: "local" as const,
    stateRoot: path.join(
      process.cwd(),
      "buck-out",
      "tmp",
      "artifact-environment",
      "capability-rejection-test",
    ),
    workspaceRoot: process.cwd(),
    artifactToolsRoot: toolsRoot,
  };
  assert.throws(
    () =>
      buildArtifactEnvironment({
        ...base,
        nixCachePolicyCapability: undefined,
      }),
    /authority is missing or invalid/,
  );
  assert.throws(
    () =>
      buildArtifactEnvironment({
        ...base,
        nixCachePolicyCapability: {
          config: reviewed,
        } as unknown as NixCachePolicyCapability,
      }),
    /authority is missing or invalid/,
  );
});

test("dev-build glue child receives exact capability-authorized config without authority markers", () => {
  process.env.VBR_CANONICAL_ARTIFACT_ENTRYPOINT = "1";
  activateCanonicalNixCachePolicy(process.env, { applied: true, config: reviewed });
  const child = glueChildArtifactEnvironment(process.cwd(), toolsRoot, {
    ...process.env,
    NIX_CONFIG: `${reviewed}\nconnect-timeout = 99`,
    VBR_CANONICAL_ARTIFACT_ENTRYPOINT: "1",
    VBR_NIX_CACHE_HEALTH_APPLIED: "1",
    VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "forged",
  });
  assert.equal(child.NIX_CONFIG, reviewed);
  assert.equal(child.VBR_NIX_CACHE_HEALTH_APPLIED, undefined);
  assert.equal(child.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, undefined);

  const action = runnableNixArtifactEnvironment({
    workspaceRoot: process.cwd(),
    env: withoutArtifactEnvironmentInfluence({
      ...process.env,
      NIX_CONFIG: "substituters = https://cache-does-not-exist.invalid\nconnect-timeout = 1",
    }) as Record<string, string>,
    artifactToolsRoot: toolsRoot,
    nixCachePolicyCapability: currentNixCachePolicyCapability(),
  });
  assert.equal(action.NIX_CONFIG, reviewed);
  assert.doesNotMatch(String(action.NIX_CONFIG || ""), /cache-does-not-exist\.invalid/);
  assert.throws(
    () =>
      runnableNixArtifactEnvironment({
        workspaceRoot: process.cwd(),
        env: withoutArtifactEnvironmentInfluence(process.env) as Record<string, string>,
        internal: { NIX_CONFIG: "substituters = https://hostile.internal.invalid" },
        artifactToolsRoot: toolsRoot,
        nixCachePolicyCapability: currentNixCachePolicyCapability(),
      }),
    /internal NIX_CONFIG cannot override Nix cache policy authority/,
  );
});

test("explicit off capability reaches glue, materialization, and action environments unreviewed", () => {
  process.env.VBR_CANONICAL_ARTIFACT_ENTRYPOINT = "1";
  process.env.VBR_NIX_CACHE_POLICY = "off";
  activateCanonicalNixCachePolicy(process.env, { applied: false, config: "" });
  const capability = currentNixCachePolicyCapability();
  const ambient = withoutArtifactEnvironmentInfluence({
    ...process.env,
    NIX_CONFIG: "substituters = https://cache-does-not-exist.invalid",
  });
  const glue = glueChildArtifactEnvironment(process.cwd(), toolsRoot, ambient);
  const materialize = materializePureEvaluationEnvironment({
    root: process.cwd(),
    artifactToolsRoot: toolsRoot,
    nixCachePolicyCapability: capability,
  });
  const action = runnableNixArtifactEnvironment({
    workspaceRoot: process.cwd(),
    env: ambient as Record<string, string>,
    artifactToolsRoot: toolsRoot,
    nixCachePolicyCapability: capability,
  });
  for (const env of [glue, materialize, action]) {
    assert.equal(env.NIX_CONFIG, undefined);
    assert.equal(env.VBR_NIX_CACHE_HEALTH_APPLIED, undefined);
    assert.equal(env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, undefined);
  }
  assert.throws(
    () =>
      runnableNixArtifactEnvironment({
        workspaceRoot: process.cwd(),
        env: ambient as Record<string, string>,
        internal: { NIX_CONFIG: "substituters = https://hostile.internal.invalid" },
        artifactToolsRoot: toolsRoot,
        nixCachePolicyCapability: capability,
      }),
    /internal NIX_CONFIG cannot override Nix cache policy authority/,
  );
});
