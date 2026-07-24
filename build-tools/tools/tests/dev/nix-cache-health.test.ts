#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { applyNixCacheHealthPolicy } from "../../dev/verify/nix-cache-health";
import { evaluateNixCacheReadinessFromConfig } from "../../lib/nix-cache-readiness";

const VIBEROOTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const execFileAsync = promisify(execFile);

function sourceFile(rel: string): string {
  return path.join(VIBEROOTS_ROOT, rel);
}

function generatedShellSource(source: string): string {
  return source.replace(/\\"/g, '"');
}

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

test("nix cache health default probe uses the configured netrc for a real HTTP request", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-health-"));
  const logPath = path.join(tmp, "probe.log");
  const netrcPath = path.join(tmp, "reviewed.netrc");
  const nixPath = path.join(tmp, "nix");
  const curlPath = path.join(tmp, "curl");
  await fsp.writeFile(netrcPath, "machine auth.example login token password fixture-secret\n", {
    mode: 0o600,
  });
  await fsp.writeFile(
    nixPath,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "config" ] && [ "$2" = "show" ]; then',
      "  printf '%s\\n' 'extra-substituters = https://auth.example/cache?token=fixture-query'",
      `  printf '%s\\n' 'netrc-file = ${netrcPath}'`,
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  await fsp.writeFile(
    curlPath,
    ["#!/usr/bin/env bash", 'printf \'%s\\n\' "$*" >> "$CURL_PROBE_LOG"', "exit 0", ""].join("\n"),
    { mode: 0o755 },
  );

  await withEnv(
    {
      PATH: `${tmp}:${process.env.PATH || ""}`,
      VBR_NIX_BIN: nixPath,
      NIX_BIN: nixPath,
      CURL_PROBE_LOG: logPath,
      VBR_NIX_CACHE_POLICY: "auto",
      VBR_NIX_CACHE_HEALTH_APPLIED: "",
    },
    async () => {
      const result = await applyNixCacheHealthPolicy("/tmp/repo");
      assert.equal(result.changed, false);
      assert.deepEqual(result.kept, ["https://auth.example/cache?token=fixture-query"]);
      const probe = await fsp.readFile(logPath, "utf8");
      assert.match(probe, new RegExp(`--netrc-file ${netrcPath.replaceAll("/", "\\/")}`));
      assert.match(probe, /https:\/\/auth\.example\/cache\/nix-cache-info\?token=fixture-query/);
      assert.doesNotMatch(probe, /fixture-secret/);
    },
  );
});

test("nix cache health diagnostics redact URL userinfo and query credentials", async () => {
  const failed = "https://operator:secret@down.example/cache?token=failed-secret";
  const kept = "https://reader:secret@kept.example/cache?token=kept-secret";
  const logs: string[] = [];
  await withEnv({ VBR_NIX_CACHE_POLICY: "auto", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
    await applyNixCacheHealthPolicy("/tmp/repo", {
      readEffectiveConfig: async () => `substituters = ${failed}\nextra-substituters = ${kept}`,
      probeUrl: async (url) => url === kept,
      log: (line) => logs.push(line),
    });
  });
  assert.match(logs.join("\n"), /https:\/\/<redacted>@down\.example\/cache/);
  assert.match(logs.join("\n"), /https:\/\/<redacted>@kept\.example\/cache/);
  assert.doesNotMatch(logs.join("\n"), /operator|reader|failed-secret|kept-secret/);

  await withEnv({ VBR_NIX_CACHE_POLICY: "strict", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
    await assert.rejects(
      applyNixCacheHealthPolicy("/tmp/repo", {
        readEffectiveConfig: async () => `substituters = ${failed}`,
        probeUrl: async () => false,
      }),
      (error: Error) => {
        assert.match(error.message, /https:\/\/<redacted>@down\.example\/cache/);
        assert.doesNotMatch(error.message, /operator|secret|token=/);
        return true;
      },
    );
  });
});

test("nix cache health rejects nix store-info false positives when HTTP is unreachable", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-health-false-positive-"));
  const nixPath = path.join(tmp, "nix");
  const curlPath = path.join(tmp, "curl");
  const nixLog = path.join(tmp, "nix.log");
  await fsp.writeFile(
    nixPath,
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' "$*" >> "$NIX_LOG"',
      'if [ "$1" = "config" ] && [ "$2" = "show" ]; then',
      "  printf '%s\\n' 'substituters = https://unresolvable.example/cache'",
      `  printf '%s\\n' 'netrc-file = ${path.join(tmp, "reviewed.netrc")}'`,
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  await fsp.writeFile(curlPath, "#!/usr/bin/env bash\nexit 6\n", { mode: 0o755 });
  await withEnv(
    {
      PATH: `${tmp}:${process.env.PATH || ""}`,
      VBR_NIX_BIN: nixPath,
      NIX_BIN: nixPath,
      NIX_LOG: nixLog,
      VBR_NIX_CACHE_POLICY: "auto",
      VBR_NIX_CACHE_HEALTH_APPLIED: "",
    },
    async () => {
      const result = await applyNixCacheHealthPolicy("/tmp/repo");
      assert.deepEqual(result.removed, ["https://unresolvable.example/cache"]);
      assert.doesNotMatch(await fsp.readFile(nixLog, "utf8"), /store info/);
    },
  );

  const malformed = "https://operator:malformed-secret@?token=malformed-query-secret";
  const malformedLogs: string[] = [];
  await withEnv({ VBR_NIX_CACHE_POLICY: "auto", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
    await applyNixCacheHealthPolicy("/tmp/repo", {
      readEffectiveConfig: async () => `substituters = ${malformed}`,
      probeUrl: async () => false,
      log: (line) => malformedLogs.push(line),
    });
  });
  assert.match(malformedLogs.join("\n"), /<invalid-substituter>/);
  assert.doesNotMatch(malformedLogs.join("\n"), /operator|malformed-secret|token=/);

  await withEnv({ VBR_NIX_CACHE_POLICY: "strict", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
    await assert.rejects(
      applyNixCacheHealthPolicy("/tmp/repo", {
        readEffectiveConfig: async () => `substituters = ${malformed}`,
        probeUrl: async () => false,
      }),
      (error: Error) => {
        assert.match(error.message, /<invalid-substituter>/);
        assert.doesNotMatch(error.message, /operator|malformed-secret|token=/);
        return true;
      },
    );
  });
});

test("pre-applied cache health consumes the exact reviewed config handoff once", async () => {
  const reviewed = "builders =\nsubstituters =\nextra-substituters =\nfallback = true";
  await withEnv(
    {
      VBR_NIX_CACHE_HEALTH_APPLIED: "1",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: reviewed,
    },
    async () => {
      const result = await applyNixCacheHealthPolicy(process.cwd());
      assert.equal(result.changed, true);
      assert.equal(result.nixConfig, reviewed);
      assert.equal(process.env.NIX_CONFIG, reviewed);
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, undefined);
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
  const runVerify = await fsp.readFile(
    sourceFile("build-tools/tools/dev/verify/run-verify.ts"),
    "utf8",
  );
  assertOrder(runVerify, "await deps.applyNixCacheHealthPolicy(root)", "prepareVerifySeed");

  const devBuild = await fsp.readFile(
    sourceFile("build-tools/tools/dev/dev-build/run-dev-build.ts"),
    "utf8",
  );
  assertOrder(devBuild, "await applyNixCacheHealthPolicy(root)", "await runStartupCheck(root)");
  assert.match(
    devBuild,
    /const cacheHealth = await applyNixCacheHealthPolicy\(root\)[\s\S]*cacheHealth\.changed && cacheHealth\.nixConfig[\s\S]*\{ NIX_CONFIG: cacheHealth\.nixConfig \}/,
  );
  const build = await fsp.readFile(sourceFile("build-tools/tools/bin/build"), "utf8");
  assertOrder(
    build,
    "artifact_ingress_trust_devshell_baseline",
    "artifact_ingress_publish_reviewed_nix_cache_config",
  );
  assertOrder(
    build,
    "artifact_ingress_publish_reviewed_nix_cache_config",
    "artifact_ingress_restore_or_remove_selectors",
  );

  const prelude = await fsp.readFile(
    sourceFile("build-tools/tools/dev/dev-build/prelude.ts"),
    "utf8",
  );
  assertOrder(prelude, "await applyNixCacheHealthPolicy(root)", "if (");

  const env = await fsp.readFile(sourceFile("build-tools/tools/bin/devshell.sh"), "utf8");
  assertOrder(
    env,
    "env_apply_nix_cache_health || return 1",
    '[[ -f "${prelude_path}/prelude.bzl" ]]',
  );

  const depsMain = await fsp.readFile(
    sourceFile("build-tools/tools/dev/install/deps-main.ts"),
    "utf8",
  );
  assertOrder(depsMain, "await applyNixCacheHealthPolicy(repoRoot)", "if (glueOnly)");

  const linkNode = await fsp.readFile(
    sourceFile("build-tools/tools/dev/install/link-node.ts"),
    "utf8",
  );
  assertOrder(linkNode, "await applyNixCacheHealthPolicy(root)", "const flakeRoot");

  const glue = await fsp.readFile(sourceFile("build-tools/tools/dev/install/glue.ts"), "utf8");
  assertOrder(
    glue,
    "await applyNixCacheHealthPolicy(wsRoot)",
    "missing .viberoots/workspace/prelude",
  );

  const buck = await fsp.readFile(sourceFile("build-tools/lang/nix_cache_health.bzl"), "utf8");
  const buckShell = generatedShellSource(buck);
  assert.match(buck, /VBR_NIX_CACHE_HEALTH_APPLIED/);
  assert.match(buck, /printf -v NIX_CONFIG '%s\\nsubstituters =%s\\nextra-substituters =%s/);
  assert.match(buck, /nix-cache-info/);
  assert.match(buck, /NIX_CACHE_BASE=.*NIX_CACHE_SUB%%\\\\\?\*/);
  assert.match(buck, /nix-cache-info\$\{NIX_CACHE_QUERY\}/);
  assert.match(buck, /curl -fsS --connect-timeout 3 --max-time 5/);
  assert.match(buck, /if curl -fsS --connect-timeout 3 --max-time 5/);
  assert.match(buckShell, /--netrc-file "\$NIX_CACHE_NETRC"/);
  assert.match(buckShell, /NIX_CACHE_REMOVED_IDENTITIES/);
  assert.match(buckShell, /<redacted>@/);
  assert.doesNotMatch(buckShell, /unavailable:\$NIX_CACHE_REMOVED"/);
  assert.match(buck, /viberoots-nix-cache\.noindex/);
  assert.match(buck, /NIX_CACHE_TMPDIR\/\.metadata_never_index/);
  assert.doesNotMatch(
    buck,
    /curl -fsS --connect-timeout 3 --max-time 5[^;]+; NIX_CACHE_PROBE_STATUS/,
  );
  assert.doesNotMatch(buck, /store info --store/);
  assert.doesNotMatch(buck, /\$\(cat/);
  assert.doesNotMatch(buck, /\$\(printf/);
  assert.doesNotMatch(buck, /export NIX_CONFIG="[^"]*\\\\n/);

  assert.match(env, /nix-cache-info/);
  assert.match(env, /cache_base="\$\{substituter%%\\\?\*\}"/);
  assert.match(env, /nix-cache-info\$\{cache_query\}/);
  assert.match(env, /local curl_args=\(-fsS --connect-timeout 3 --max-time 5\)/);
  assert.match(env, /curl "\$\{curl_args\[@\]\}" "\$\{cache_info_url\}"/);
  assert.match(env, /curl_args\+=\(--netrc-file "\$\{netrc_file\}"\)/);
  assert.match(env, /removed_identities/);
  assert.match(env, /<redacted>@/);
  assert.doesNotMatch(env, /unavailable: \$\{removed\[\*\]\}/);
  assert.doesNotMatch(env, /store info --store/);
  assert.match(env, /env_mark_macos_metadata_never_index "\$\{cache_dir\}"/);
  assert.match(env, /env_mark_macos_metadata_never_index "\$\{NODE_V8_COVERAGE\}"/);

  const devshell = await fsp.readFile(sourceFile("build-tools/tools/nix/devshell.nix"), "utf8");
  assert.match(devshell, /_vbr_mark_macos_metadata_never_index "\$cache_dir"/);
  assert.match(
    devshell,
    /_vbr_mark_macos_metadata_never_index "\$PWD\/\.viberoots\/workspace\/buck\/tmp"/,
  );

  const zxTest = await fsp.readFile(sourceFile("build-tools/tools/buck/zx_test.bzl"), "utf8");
  assertOrder(zxTest, "nix_cache_health_shell()", "PRELUDE_PATH");

  const verifyBuckEnv = await fsp.readFile(
    sourceFile("build-tools/tools/dev/verify/buck2-test-env.ts"),
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
