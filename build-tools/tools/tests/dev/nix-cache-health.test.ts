#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { applyNixCacheHealthPolicy } from "../../dev/verify/nix-cache-health";
import { evaluateNixCacheReadinessFromConfig } from "../../lib/nix-cache-readiness";

async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in prev)) delete process.env[key];
    }
    Object.assign(process.env, prev);
  }
}

test("nix cache health removes unreachable optional extra-substituters dynamically", async () => {
  const logs: string[] = [];
  await withEnv(
    {
      NIX_CONFIG: [
        "builders = ",
        "substituters = https://cache.nixos.org/",
        "extra-substituters = https://stale.example/cache https://kept.example",
      ].join("\n"),
      VBR_NIX_CACHE_POLICY: "auto",
      VBR_NIX_CACHE_HEALTH_APPLIED: "",
    },
    async () => {
      const result = await applyNixCacheHealthPolicy("/tmp/repo", {
        log: (line) => logs.push(line),
        readEffectiveConfig: async () =>
          [
            "substituters = https://cache.nixos.org/",
            "extra-substituters = https://stale.example/cache https://kept.example",
            "trusted-public-keys = cache.example-1:abc",
          ].join("\n"),
        probeUrl: async (url) => url === "https://kept.example",
      });

      assert.equal(result.changed, true);
      assert.deepEqual(result.removed, ["https://cache.nixos.org/", "https://stale.example/cache"]);
      assert.deepEqual(result.kept, ["https://kept.example"]);
      assert.match(String(process.env.NIX_CONFIG), /builders =/);
      assert.match(String(process.env.NIX_CONFIG), /substituters =\s*(\n|$)/);
      assert.match(String(process.env.NIX_CONFIG), /extra-substituters = https:\/\/kept\.example/);
      assert.doesNotMatch(String(process.env.NIX_CONFIG), /cache\.nixos\.org/);
      assert.doesNotMatch(String(process.env.NIX_CONFIG), /stale\.example/);
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_APPLIED, "1");
      assert.match(logs.join("\n"), /disabled unreachable substituter/);
    },
  );
});

test("nix cache health skips repeated probes after the environment is marked handled", async () => {
  await withEnv({ VBR_NIX_CACHE_HEALTH_APPLIED: "1" }, async () => {
    const result = await applyNixCacheHealthPolicy("/tmp/repo", {
      readEffectiveConfig: async () => {
        throw new Error("should not read config after cache health is marked handled");
      },
      probeUrl: async () => {
        throw new Error("should not probe after cache health is marked handled");
      },
    });
    assert.equal(result.changed, false);
  });
});

test("nix cache health auto mode disables unreachable primary substituters", async () => {
  await withEnv({ VBR_NIX_CACHE_POLICY: "auto", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
    const result = await applyNixCacheHealthPolicy("/tmp/repo", {
      readEffectiveConfig: async () => "substituters = https://cache.nixos.org/",
      probeUrl: async () => false,
    });
    assert.equal(result.changed, true);
    assert.deepEqual(result.removed, ["https://cache.nixos.org/"]);
    assert.match(String(process.env.NIX_CONFIG), /substituters =\s*(\n|$)/);
    assert.doesNotMatch(String(process.env.NIX_CONFIG), /cache\.nixos\.org/);
    assert.match(String(process.env.NIX_CONFIG), /fallback = true/);
  });
});

test("nix cache health probes original query-bearing cache urls", async () => {
  const probed: string[] = [];
  await withEnv({ VBR_NIX_CACHE_POLICY: "strict", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
    await applyNixCacheHealthPolicy("/tmp/repo", {
      readEffectiveConfig: async () => "extra-substituters = https://cache.example/path?token=a=b",
      probeUrl: async (url) => {
        probed.push(url);
        return true;
      },
    });
  });
  assert.deepEqual(probed, ["https://cache.example/path?token=a=b"]);
});

test("nix cache health strict mode fails instead of rewriting substituters", async () => {
  await withEnv({ VBR_NIX_CACHE_POLICY: "strict", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
    await assert.rejects(
      async () =>
        await applyNixCacheHealthPolicy("/tmp/repo", {
          readEffectiveConfig: async () => "substituters = https://offline.example",
          probeUrl: async () => false,
        }),
      /configured Nix substituter\(s\) unavailable: https:\/\/offline\.example/,
    );
  });
});

test("nix cache health off mode leaves NIX_CONFIG unchanged", async () => {
  await withEnv(
    {
      NIX_CONFIG: "substituters = https://offline.example",
      VBR_NIX_CACHE_POLICY: "off",
      VBR_NIX_CACHE_HEALTH_APPLIED: "",
    },
    async () => {
      const result = await applyNixCacheHealthPolicy("/tmp/repo", {
        readEffectiveConfig: async () => {
          throw new Error("should not read config when disabled");
        },
      });
      assert.equal(result.changed, false);
      assert.equal(process.env.NIX_CONFIG, "substituters = https://offline.example");
    },
  );
});

test("nix cache readiness reports reachable, absent, degraded, and strict states", async () => {
  const reachable = await evaluateNixCacheReadinessFromConfig(
    [
      "substituters = https://primary.example/cache",
      "extra-substituters = https://remote-builder-cache.example/cache",
    ].join("\n"),
    "auto",
    async () => true,
  );
  assert.equal(reachable.state, "ready");
  assert.deepEqual(
    reachable.statuses.map((entry) => entry.url),
    ["https://primary.example/cache", "https://remote-builder-cache.example/cache"],
  );

  const absent = await evaluateNixCacheReadinessFromConfig("", "auto", async () => true);
  assert.equal(absent.state, "not_configured");

  const degraded = await evaluateNixCacheReadinessFromConfig(
    "extra-substituters = https://stale.dynamic.example/cache",
    "auto",
    async () => false,
  );
  assert.equal(degraded.state, "degraded");
  assert.match(degraded.message, /https:\/\/stale\.dynamic\.example\/cache/);

  const strict = await evaluateNixCacheReadinessFromConfig(
    "extra-substituters = https://strict.dynamic.example/cache",
    "strict",
    async () => false,
  );
  assert.equal(strict.state, "failed");
  assert.doesNotMatch(JSON.stringify(strict), /home\.kilty|kilty\.io/);
});

test("nix cache readiness redacts query and userinfo from recorded substituter identities", async () => {
  const probed: string[] = [];
  const readiness = await evaluateNixCacheReadinessFromConfig(
    "extra-substituters = https://operator:secret@cache.example/path?token=abc123",
    "auto",
    async (url) => {
      probed.push(url);
      return false;
    },
  );
  assert.equal(readiness.state, "degraded");
  assert.deepEqual(readiness.optionalSubstituters, ["https://<redacted>@cache.example/path"]);
  assert.deepEqual(probed, ["https://operator:secret@cache.example/path?token=abc123"]);
  assert.doesNotMatch(JSON.stringify(readiness), /secret|token=abc123/);
});

test("nix cache health runs before dev-build and install nix entrypoints", async () => {
  const runVerify = await fsp.readFile("build-tools/tools/dev/verify/run-verify.ts", "utf8");
  assertOrder(runVerify, "await deps.applyNixCacheHealthPolicy(root)", "prepareVerifySeed");

  const devBuild = await fsp.readFile("build-tools/tools/dev/dev-build/run-dev-build.ts", "utf8");
  assertOrder(devBuild, "await applyNixCacheHealthPolicy(root)", "await runStartupCheck(root)");

  const prelude = await fsp.readFile("build-tools/tools/dev/dev-build/prelude.ts", "utf8");
  assertOrder(prelude, "await applyNixCacheHealthPolicy(root)", "if (preludeExists");

  const env = await fsp.readFile("build-tools/tools/bin/_env.sh", "utf8");
  assertOrder(
    env,
    "env_apply_nix_cache_health || return 1",
    '[[ -f "${live_root}/prelude/prelude.bzl" ]] && return 0',
  );

  const depsMain = await fsp.readFile("build-tools/tools/dev/install/deps-main.ts", "utf8");
  assertOrder(depsMain, "await applyNixCacheHealthPolicy(repoRoot)", "if (glueOnly)");

  const linkNode = await fsp.readFile("build-tools/tools/dev/install/link-node.ts", "utf8");
  assertOrder(linkNode, "await applyNixCacheHealthPolicy(root)", "const flakeRoot");

  const glue = await fsp.readFile("build-tools/tools/dev/install/glue.ts", "utf8");
  assertOrder(glue, "await applyNixCacheHealthPolicy(wsRoot)", "nix build");

  const buck = await fsp.readFile("build-tools/lang/nix_cache_health.bzl", "utf8");
  assert.match(buck, /VBR_NIX_CACHE_HEALTH_APPLIED/);
  assert.match(buck, /printf -v NIX_CONFIG '%s\\nsubstituters =%s\\nextra-substituters =%s/);
  assert.match(buck, /nix-cache-info/);
  assert.match(buck, /curl -fsS --connect-timeout 3 --max-time 5/);
  assert.match(buck, /if curl -fsS --connect-timeout 3 --max-time 5/);
  assert.match(buck, /if nix store info --store/);
  assert.doesNotMatch(
    buck,
    /curl -fsS --connect-timeout 3 --max-time 5[^;]+; NIX_CACHE_PROBE_STATUS/,
  );
  assert.doesNotMatch(buck, /nix store info --store[^;]+; NIX_CACHE_PROBE_STATUS/);
  assert.doesNotMatch(buck, /\$\(cat/);
  assert.doesNotMatch(buck, /\$\(printf/);
  assert.doesNotMatch(buck, /export NIX_CONFIG="[^"]*\\\\n/);

  assert.match(env, /nix-cache-info/);
  assert.match(env, /curl -fsS --connect-timeout 3 --max-time 5/);
  assert.match(env, /if curl -fsS --connect-timeout 3 --max-time 5 "\$\{cache_info_url\}"/);
  assert.match(env, /if nix store info --store "\$\{substituter\}" --option connect-timeout 3/);

  const zxTest = await fsp.readFile("build-tools/tools/buck/zx_test.bzl", "utf8");
  assertOrder(zxTest, "nix_cache_health_shell()", "PRELUDE_PATH");

  const verifyBuckEnv = await fsp.readFile(
    "build-tools/tools/dev/verify/buck2-test-env.ts",
    "utf8",
  );
  assert.match(verifyBuckEnv, /maybeEnvArg\("NIX_CONFIG"/);
  assert.match(verifyBuckEnv, /maybeEnvArg\("VBR_NIX_CACHE_HEALTH_APPLIED"/);
});

function assertOrder(source: string, first: string, second: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${first} must be present`);
  assert.notEqual(secondIndex, -1, `${second} must be present`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}
