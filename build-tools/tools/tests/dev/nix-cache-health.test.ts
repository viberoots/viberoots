#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { applyNixCacheHealthPolicy } from "../../dev/verify/nix-cache-health";

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
      assert.match(logs.join("\n"), /disabled unreachable substituter/);
    },
  );
});

test("nix cache health auto mode disables unreachable primary substituters", async () => {
  await withEnv({ VBR_NIX_CACHE_POLICY: "auto" }, async () => {
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

test("nix cache health probes query-bearing cache urls at nix-cache-info", async () => {
  const probed: string[] = [];
  await withEnv({ VBR_NIX_CACHE_POLICY: "strict" }, async () => {
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
  await withEnv({ VBR_NIX_CACHE_POLICY: "strict" }, async () => {
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

test("nix cache health runs before dev-build and install nix entrypoints", async () => {
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
  assert.match(buck, /printf -v NIX_CONFIG '%s\\nsubstituters =%s\\nextra-substituters =%s/);
  assert.doesNotMatch(buck, /\$\(cat/);
  assert.doesNotMatch(buck, /\$\(printf/);
  assert.doesNotMatch(buck, /export NIX_CONFIG="[^"]*\\\\n/);

  const zxTest = await fsp.readFile("build-tools/tools/buck/zx_test.bzl", "utf8");
  assertOrder(zxTest, "nix_cache_health_shell()", "PRELUDE_PATH");
});

function assertOrder(source: string, first: string, second: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${first} must be present`);
  assert.notEqual(secondIndex, -1, `${second} must be present`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}
