#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { applyNixCacheHealthPolicy } from "../../dev/verify/nix-cache-health";
import { evaluateNixCacheReadinessFromConfig } from "../../lib/nix-cache-readiness";
import {
  currentNixCachePolicyCapability,
  nixCachePolicyBindingDigest,
  outcomeFromNixCachePolicyCapability,
} from "../../lib/nix-cache-policy-capability";
import {
  NIX_CACHE_TRANSPORT_CURL_EXIT_CODES,
  NIX_CACHE_TRANSPORT_CURL_EXIT_CODES_SHELL,
} from "../../lib/nix-cache-transport";
import { direnvStage0 } from "../../lib/consumer-direnv";

const VIBEROOTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const execFileAsync = promisify(execFile);

function sourceFile(rel: string): string {
  return path.join(VIBEROOTS_ROOT, rel);
}

function generatedShellSource(source: string): string {
  return source.replace(/\\"/g, '"');
}

function buckCacheHealthShell(source: string): string {
  const literals = [...source.matchAll(/"(?:\\.|[^"\\])*"/gu)].map((match) => JSON.parse(match[0]));
  return literals.join("");
}

function starlarkFunctionBlock(source: string, name: string): string {
  const start = source.indexOf(`def ${name}():`);
  const end = source.indexOf("\ndef ", start + 1);
  assert.ok(start >= 0 && end > start, `expected Starlark function ${name}`);
  return source.slice(start, end);
}

function starlarkStringLiterals(source: string): string {
  return [...source.matchAll(/"(?:\\.|[^"\\])*"/gu)].map((match) => JSON.parse(match[0])).join("");
}

function actionCacheHealthShell(nixShellSource: string, cacheHealthSource: string): string {
  const environment = starlarkStringLiterals(
    starlarkFunctionBlock(nixShellSource, "nix_artifact_environment_shell"),
  );
  const finalExecBlock = starlarkFunctionBlock(
    nixShellSource,
    "nix_action_final_exec_function_shell",
  );
  const [beforeHealth, afterHealth, ...extra] = finalExecBlock.split("+ nix_cache_health_shell()");
  assert.equal(extra.length, 0);
  assert.ok(afterHealth !== undefined, "final action exec must invoke cache health");
  return [
    environment,
    starlarkStringLiterals(beforeHealth),
    buckCacheHealthShell(cacheHealthSource),
    starlarkStringLiterals(afterHealth),
  ].join("");
}

function generatedStage0CacheHealthShell(): string {
  const source = direnvStage0();
  const start = source.indexOf("__vbr_stage0_strip_nix_cache_overrides() {");
  const end = source.indexOf("\n__vbr_stage0_filtered_viberoots_input() {", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

async function generatedDevshellCacheHealthShell(): Promise<string> {
  const config = await fsp.readFile(
    sourceFile("build-tools/tools/bin/devshell-cache-config.sh"),
    "utf8",
  );
  const health = await fsp.readFile(
    sourceFile("build-tools/tools/bin/devshell-cache-health.sh"),
    "utf8",
  );
  return `${config}\n${health}`;
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
        probeUrl: async (url) =>
          url === "https://cache.nixos.org/" || url === "https://kept.example",
      });

      assert.equal(result.changed, true);
      assert.deepEqual(result.removed, ["https://stale.example/cache"]);
      assert.deepEqual(result.kept, ["https://cache.nixos.org/", "https://kept.example"]);
      assert.match(String(process.env.NIX_CONFIG), /builders =/);
      assert.match(String(process.env.NIX_CONFIG), /substituters = https:\/\/cache\.nixos\.org\//);
      assert.match(String(process.env.NIX_CONFIG), /extra-substituters = https:\/\/kept\.example/);
      assert.doesNotMatch(String(process.env.NIX_CONFIG), /stale\.example/);
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_APPLIED, "1");
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, process.env.NIX_CONFIG);
      assert.match(logs.join("\n"), /disabled unreachable substituter/);
    },
  );
});

test("forged cache-health markers cannot bypass TypeScript re-review", async () => {
  let reads = 0;
  await withEnv(
    {
      NIX_CONFIG: "substituters = file:///reviewed",
      VBR_NIX_CACHE_HEALTH_APPLIED: "1",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "substituters = file:///reviewed",
    },
    async () => {
      const result = await applyNixCacheHealthPolicy("/tmp/repo", {
        readEffectiveConfig: async () => {
          reads += 1;
          return "substituters = file:///reviewed";
        },
        probeUrl: async () => {
          throw new Error("local substituters must not be probed");
        },
      });
      assert.equal(result.changed, false);
      assert.equal(reads, 1);
      assert.deepEqual(result.kept, ["file:///reviewed"]);
    },
  );
});

test("nix cache health auto mode fails closed for unreachable required substituters", async () => {
  await withEnv({ VBR_NIX_CACHE_POLICY: "auto", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
    await assert.rejects(
      applyNixCacheHealthPolicy("/tmp/repo", {
        readEffectiveConfig: async () => "substituters = https://cache.nixos.org/",
        probeUrl: async () => false,
      }),
      /required Nix substituter unavailable: https:\/\/cache\.nixos\.org\//,
    );
    assert.equal(process.env.VBR_NIX_CACHE_HEALTH_APPLIED, undefined);
  });
});

test("nix cache health treats a dual-role substituter as required", async () => {
  await withEnv({ VBR_NIX_CACHE_POLICY: "auto", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
    await assert.rejects(
      applyNixCacheHealthPolicy("/tmp/repo", {
        readEffectiveConfig: async () =>
          [
            "substituters = https://dual.example/cache",
            "extra-substituters = https://dual.example/cache",
          ].join("\n"),
        probeUrl: async () => false,
      }),
      /required Nix substituter unavailable: https:\/\/dual\.example\/cache/,
    );
  });
});

test("nix cache health probes original credential-free query-bearing cache urls", async () => {
  const probed: string[] = [];
  await withEnv({ VBR_NIX_CACHE_POLICY: "strict", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
    await applyNixCacheHealthPolicy("/tmp/repo", {
      readEffectiveConfig: async () =>
        "extra-substituters = https://cache.example/path?priority=a=b",
      probeUrl: async (url) => {
        probed.push(url);
        return true;
      },
    });
  });
  assert.deepEqual(probed, ["https://cache.example/path?priority=a=b"]);
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

test("nix cache health default probe uses the configured netrc for a real HTTP request", async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-health-"));
  t.after(async () => await fsp.rm(tmp, { recursive: true, force: true }));
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
      "#!/bin/sh",
      'if [ "$1" = "config" ] && [ "$2" = "show" ]; then',
      "  printf '%s\\n' 'extra-substituters = https://auth.example/cache?tenant=fixture'",
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
    ["#!/bin/sh", 'printf \'%s\\n\' "$*" >> "$CURL_PROBE_LOG"', "exit 0", ""].join("\n"),
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
      const result = await applyNixCacheHealthPolicy("/tmp/repo", {
        resolveCurlBin: () => curlPath,
      });
      assert.equal(result.changed, true);
      assert.deepEqual(result.kept, ["https://auth.example/cache?tenant=fixture"]);
      assert.match(
        result.nixConfig,
        new RegExp(`netrc-file = ${netrcPath.replaceAll("/", "\\/")}`),
      );
      assert.doesNotMatch(result.nixConfig, /fixture-secret/);
      const probe = await fsp.readFile(logPath, "utf8");
      assert.match(probe, new RegExp(`--netrc-file ${netrcPath.replaceAll("/", "\\/")}`));
      assert.match(probe, /https:\/\/auth\.example\/cache\/nix-cache-info\?tenant=fixture/);
      assert.doesNotMatch(probe, /token=|fixture-secret/);
      assert.doesNotMatch(probe, /fixture-secret/);
    },
  );
});

test("TypeScript cache probe admits only a readable regular netrc and classifies curl exits", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-ts-netrc-"));
  try {
    const curlPath = path.join(tmp, "curl");
    const logPath = path.join(tmp, "curl-argv.log");
    await fsp.writeFile(
      curlPath,
      '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$CURL_ARGV_LOG"\nexit "${CURL_EXIT:-0}"\n',
      { mode: 0o755 },
    );
    const netrcCases = [
      { name: "absent", path: "" },
      { name: "missing", path: path.join(tmp, "missing.netrc") },
      { name: "directory", path: path.join(tmp, "netrc-directory") },
      { name: "unreadable", path: path.join(tmp, "unreadable.netrc") },
      { name: "readable", path: path.join(tmp, "readable.netrc") },
    ] as const;
    await fsp.mkdir(netrcCases[2].path);
    await fsp.writeFile(netrcCases[3].path, "machine cache.example\n", { mode: 0o000 });
    await fsp.writeFile(netrcCases[4].path, "machine cache.example\n", { mode: 0o600 });
    await assert.rejects(
      fsp.access(netrcCases[3].path, fsConstants.R_OK),
      `${netrcCases[3].path} must be inaccessible for the unreadable-netrc test`,
    );

    for (const netrcCase of netrcCases) {
      await fsp.rm(logPath, { force: true });
      const expectedNetrc = netrcCase.name === "readable";
      await withEnv(
        {
          CURL_ARGV_LOG: logPath,
          CURL_EXIT: "0",
          VBR_NIX_CACHE_POLICY: "auto",
          VBR_NIX_CACHE_HEALTH_APPLIED: "",
        },
        async () => {
          await applyNixCacheHealthPolicy("/tmp/repo", {
            readEffectiveConfig: async () =>
              [
                "substituters = https://cache.example",
                ...(netrcCase.path ? [`netrc-file = ${netrcCase.path}`] : []),
              ].join("\n"),
            resolveCurlBin: () => curlPath,
          });
        },
      );
      const argv = (await fsp.readFile(logPath, "utf8")).trim().split("\n");
      const netrcIndex = argv.indexOf("--netrc-file");
      assert.equal(netrcIndex >= 0, expectedNetrc, `${netrcCase.name}: netrc argv presence`);
      if (expectedNetrc) assert.equal(argv[netrcIndex + 1], netrcCase.path);
      else assert.equal(argv.includes(netrcCase.path), false);
    }

    for (const exitCode of [22, 2, 26]) {
      await assert.rejects(
        withEnv(
          {
            CURL_ARGV_LOG: logPath,
            CURL_EXIT: String(exitCode),
            VBR_NIX_CACHE_POLICY: "auto",
            VBR_NIX_CACHE_HEALTH_APPLIED: "",
          },
          async () =>
            await applyNixCacheHealthPolicy("/tmp/repo", {
              readEffectiveConfig: async () => "substituters = https://cache.example",
              resolveCurlBin: () => curlPath,
            }),
        ),
        new RegExp(`curl exit ${exitCode}`),
      );
    }
    const transport = await withEnv(
      {
        CURL_ARGV_LOG: logPath,
        CURL_EXIT: "6",
        VBR_NIX_CACHE_POLICY: "auto",
        VBR_NIX_CACHE_HEALTH_APPLIED: "",
      },
      async () =>
        await applyNixCacheHealthPolicy("/tmp/repo", {
          readEffectiveConfig: async () => "extra-substituters = https://cache.example",
          resolveCurlBin: () => curlPath,
        }),
    );
    assert.deepEqual(transport.removed, ["https://cache.example"]);
  } finally {
    await fsp.chmod(path.join(tmp, "unreadable.netrc"), 0o600).catch(() => {});
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("generated cache probes enforce netrc argv and curl exit policy behaviorally", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-shell-netrc-"));
  try {
    const nixPath = path.join(tmp, "nix");
    const curlPath = path.join(tmp, "curl");
    const logPath = path.join(tmp, "curl-argv.log");
    const roleConfigDir = path.join(tmp, "nix-config");
    await fsp.mkdir(roleConfigDir);
    await fsp.writeFile(
      nixPath,
      `#!/usr/bin/env bash
if [[ "\${3:-}" == "--json" ]]; then
  printf '{"substituters":{"defaultValue":["%s"],"value":["%s"]}}\\n' "\${TEST_SUBSTITUTER:-https://cache.example}" "\${TEST_SUBSTITUTER:-https://cache.example}"
  exit 0
fi
printf "%s = %s\\n" "\${TEST_CACHE_SETTING:-substituters}" "\${TEST_SUBSTITUTER:-https://cache.example}"
[[ -z "\${TEST_NETRC_FILE:-}" ]] || printf "netrc-file = %s\\n" "$TEST_NETRC_FILE"
`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      curlPath,
      '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$CURL_ARGV_LOG"\nexit "${CURL_EXIT:-0}"\n',
      { mode: 0o755 },
    );
    const directory = path.join(tmp, "netrc-directory");
    const unreadable = path.join(tmp, "unreadable.netrc");
    const readable = path.join(tmp, "readable.netrc");
    await fsp.mkdir(directory);
    await fsp.writeFile(unreadable, "machine cache.example\n", { mode: 0o000 });
    await fsp.writeFile(readable, "machine cache.example\n", { mode: 0o600 });
    await assert.rejects(
      fsp.access(unreadable, fsConstants.R_OK),
      `${unreadable} must be inaccessible for the unreadable-netrc test`,
    );
    const buckSource = await fsp.readFile(
      sourceFile("build-tools/lang/nix_cache_health.bzl"),
      "utf8",
    );
    const renderers = [
      {
        name: "devshell",
        source: `${await generatedDevshellCacheHealthShell()}\nhealth() { env_apply_nix_cache_health; }`,
      },
      {
        name: "stage0",
        source: `${generatedStage0CacheHealthShell()}\nhealth() { __vbr_stage0_apply_nix_cache_health; }`,
      },
      {
        name: "buck",
        source: `health() { ${buckCacheHealthShell(buckSource).replaceAll("exit 1", "return 1")} }`,
      },
    ];

    const runRenderer = async (
      renderer: (typeof renderers)[number],
      netrcFile: string,
      exitCode: number,
      substituter = "https://cache.example",
      forgedMarkers = false,
      setting = "substituters",
    ) => {
      await fsp.rm(logPath, { force: true });
      await fsp.writeFile(path.join(roleConfigDir, "nix.conf"), `${setting} = ${substituter}\n`);
      const result = await execFileAsync(
        "/bin/bash",
        ["-c", `${renderer.source}\nset +e; health >/dev/null 2>&1; printf '%s' "$?"`],
        {
          env: {
            ...process.env,
            CURL_ARGV_LOG: logPath,
            CURL_EXIT: String(exitCode),
            NIX_BIN: nixPath,
            VBR_NIX_BIN: nixPath,
            PATH: `${tmp}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
            ENV_SH_DIR: sourceFile("build-tools/tools/bin"),
            NIX_CONF_DIR: roleConfigDir,
            NIX_USER_CONF_FILES: "",
            TEST_NETRC_FILE: netrcFile,
            TEST_SUBSTITUTER: substituter,
            TEST_CACHE_SETTING: setting,
            TMPDIR: tmp,
            VBR_NIX_CACHE_POLICY: "auto",
            NIX_CONFIG: forgedMarkers ? `substituters = ${substituter}` : "",
            VBR_NIX_CACHE_HEALTH_APPLIED: forgedMarkers ? "1" : "",
            VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: forgedMarkers
              ? `substituters = ${substituter}`
              : "",
          },
        },
      );
      const argv = await fsp
        .readFile(logPath, "utf8")
        .then((value) => value.trim().split("\n"))
        .catch(() => []);
      return { argv, status: Number(result.stdout) };
    };

    for (const renderer of renderers) {
      for (const netrcCase of [
        { name: "missing", path: path.join(tmp, "missing.netrc"), expected: false },
        { name: "nonregular", path: directory, expected: false },
        { name: "unreadable", path: unreadable, expected: false },
        { name: "readable", path: readable, expected: true },
      ]) {
        const result = await runRenderer(renderer, netrcCase.path, 0);
        const netrcIndex = result.argv.indexOf("--netrc-file");
        assert.equal(
          netrcIndex >= 0,
          netrcCase.expected,
          `${renderer.name}/${netrcCase.name}: netrc argv presence`,
        );
        if (netrcCase.expected) assert.equal(result.argv[netrcIndex + 1], netrcCase.path);
        assert.equal(result.status, 0, `${renderer.name}/${netrcCase.name}: health status`);
      }
      for (const exitCode of [22, 2, 26]) {
        assert.equal(
          (await runRenderer(renderer, readable, exitCode)).status,
          1,
          `${renderer.name}: curl ${exitCode} must fail closed`,
        );
      }
      assert.equal(
        (await runRenderer(renderer, readable, 6)).status,
        1,
        `${renderer.name}: required transport failure must fail closed`,
      );
      assert.equal(
        (
          await runRenderer(
            renderer,
            readable,
            6,
            "https://cache.example",
            false,
            "extra-substituters",
          )
        ).status,
        0,
        `${renderer.name}: optional transport failure remains tolerated`,
      );
      for (const credentialUrl of [
        "https://user:password@cache.example/cache",
        "https://cache.example/cache?token=fixture-secret",
        "https://cache.example/cache?to%6ben=fixture-secret",
        "https://cache.example/cache#access_token=fixture-secret",
        "https://cache.example/cache#tenant=x&token=fixture-secret",
      ]) {
        const result = await runRenderer(renderer, readable, 0, credentialUrl, true);
        assert.equal(result.status, 1, `${renderer.name}: URL credentials must fail closed`);
        assert.deepEqual(result.argv, [], `${renderer.name}: rejected URL must not reach curl`);
      }
    }

    const optionalUrl = "https://optional.example/cache";
    const flattenedConfig = `substituters = ${optionalUrl}`;
    const binding = nixCachePolicyBindingDigest({
      kind: "reviewed",
      config: flattenedConfig,
      policy: "auto",
      requiredSubstituters: [],
      optionalSubstituters: [optionalUrl],
    });
    const runProvenBuck = async (overrides: NodeJS.ProcessEnv = {}) =>
      await execFileAsync(
        "/bin/bash",
        ["-c", `${renderers[2].source}\nset +e; health >/dev/null 2>&1; printf '%s' "$?"`],
        {
          env: {
            ...process.env,
            CURL_ARGV_LOG: logPath,
            CURL_EXIT: "22",
            NIX_BIN: nixPath,
            VBR_NIX_BIN: nixPath,
            PATH: `${tmp}:/usr/bin:/bin`,
            TEST_NETRC_FILE: readable,
            TEST_SUBSTITUTER: optionalUrl,
            TMPDIR: tmp,
            VBR_ARTIFACT_TOOLS_ROOT: path.dirname(path.dirname(process.execPath)),
            VBR_NIX_CACHE_POLICY: "auto",
            NIX_CONFIG: flattenedConfig,
            VBR_NIX_CACHE_ROLE_REQUIRED: "",
            VBR_NIX_CACHE_ROLE_OPTIONAL: optionalUrl,
            VBR_NIX_CACHE_ROLE_POLICY: "auto",
            VBR_NIX_CACHE_ROLE_BINDING: binding,
            ...overrides,
          },
        },
      );
    assert.equal((await runProvenBuck()).stdout, "0");
    assert.equal(
      (
        await runProvenBuck({
          VBR_NIX_CACHE_ROLE_REQUIRED: optionalUrl,
          VBR_NIX_CACHE_ROLE_OPTIONAL: "",
        })
      ).stdout,
      "1",
    );
  } finally {
    await fsp.chmod(path.join(tmp, "unreadable.netrc"), 0o600).catch(() => {});
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("forged action cache markers cannot bypass final credential re-review", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-action-forged-"));
  try {
    const hostile = "https://cache.example/cache?to%6ben=fixture-secret";
    const hostileConfig = `substituters = ${hostile}`;
    const nixPath = path.join(tmp, "nix");
    const curlPath = path.join(tmp, "curl");
    const finalPath = path.join(tmp, "final-nix");
    const curlSentinel = path.join(tmp, "curl-ran");
    const finalSentinel = path.join(tmp, "final-ran");
    await fsp.writeFile(
      nixPath,
      '#!/usr/bin/env bash\n[[ "$1 $2" == "config show" ]] || exit 2\nprintf "%s\\n" "${NIX_CONFIG:-}"\n',
      { mode: 0o755 },
    );
    await fsp.writeFile(curlPath, '#!/usr/bin/env bash\n: > "$CURL_SENTINEL"\n', {
      mode: 0o755,
    });
    await fsp.writeFile(finalPath, '#!/usr/bin/env bash\n: > "$FINAL_SENTINEL"\n', {
      mode: 0o755,
    });
    const nixShellSource = await fsp.readFile(sourceFile("build-tools/lang/nix_shell.bzl"), "utf8");
    const cacheHealthSource = await fsp.readFile(
      sourceFile("build-tools/lang/nix_cache_health.bzl"),
      "utf8",
    );
    const shell = actionCacheHealthShell(nixShellSource, cacheHealthSource);
    await assert.rejects(
      execFileAsync(
        "/bin/bash",
        ["-c", `set -euo pipefail; ${shell} __vbr_action_final_exec "$FINAL_BIN"`],
        {
          env: {
            ...process.env,
            CURL_SENTINEL: curlSentinel,
            FINAL_BIN: finalPath,
            FINAL_SENTINEL: finalSentinel,
            NIX_BIN: nixPath,
            NIX_CONFIG: hostileConfig,
            PATH: `${tmp}:/usr/bin:/bin`,
            TMPDIR: tmp,
            VBR_NIX_BIN: nixPath,
            VBR_NIX_CACHE_HEALTH_APPLIED: "1",
            VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: hostileConfig,
            VBR_NIX_CACHE_POLICY: "auto",
          },
        },
      ),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        assert.equal(error.code, 1);
        assert.match(String(error.stderr), /embeds credentials/);
        assert.doesNotMatch(String(error.stderr), /fixture-secret|to%6ben/);
        return true;
      },
    );
    await assert.rejects(fsp.access(curlSentinel));
    await assert.rejects(fsp.access(finalSentinel));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("action cache reconstruction accepts exact role unions and fails closed on mismatch", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-action-roles-"));
  try {
    const nixPath = path.join(tmp, "nix");
    const required = "file:///required-cache";
    const optional = "file:///optional-cache";
    await fsp.writeFile(
      nixPath,
      `#!/usr/bin/env bash\nprintf '%s\\n' 'substituters = ${required} ${optional}' 'extra-substituters = ${optional}' 'connect-timeout = 9' 'fallback = false'\n`,
      { mode: 0o755 },
    );
    const nixShellSource = await fsp.readFile(sourceFile("build-tools/lang/nix_shell.bzl"), "utf8");
    const environment = starlarkStringLiterals(
      starlarkFunctionBlock(nixShellSource, "nix_artifact_environment_shell"),
    );
    const run = async (requiredRoles: string, binding = "a".repeat(64)) =>
      await execFileAsync("/bin/bash", ["-c", `set -euo pipefail; ${environment}`], {
        env: {
          ...process.env,
          NIX_BIN: nixPath,
          PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
          TMPDIR: tmp,
          VBR_ARTIFACT_TOOLS_ROOT: path.dirname(path.dirname(process.execPath)),
          VBR_NIX_CACHE_ROLE_BINDING: binding,
          VBR_NIX_CACHE_ROLE_OPTIONAL: optional,
          VBR_NIX_CACHE_ROLE_POLICY: "auto",
          VBR_NIX_CACHE_ROLE_REQUIRED: requiredRoles,
        },
      });

    await run(required);
    await assert.rejects(run("file:///different-cache"), (error: { stderr?: string }) => {
      assert.match(String(error.stderr), /roles do not match effective substituters/);
      return true;
    });
    await assert.rejects(run(required, "not-a-binding"), (error: { stderr?: string }) => {
      assert.match(String(error.stderr), /role binding is malformed/);
      return true;
    });
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("nix cache health diagnostics redact URL userinfo and query credentials", async () => {
  const failed = "https://operator:secret@down.example/cache?token=failed-secret";
  const kept = "https://reader:secret@kept.example/cache?token=kept-secret";
  const logs: string[] = [];
  for (const credentialUrl of [failed, kept]) {
    await withEnv({ VBR_NIX_CACHE_POLICY: "auto", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
      let probes = 0;
      await assert.rejects(
        applyNixCacheHealthPolicy("/tmp/repo", {
          readEffectiveConfig: async () => `substituters = ${credentialUrl}`,
          probeUrl: async () => {
            probes += 1;
            return true;
          },
          log: (line) => logs.push(line),
        }),
        (error: Error) => {
          assert.match(error.message, /https:\/\/<redacted>@(?:down|kept)\.example\/cache/);
          assert.doesNotMatch(error.message, /operator|reader|secret|token=/);
          return true;
        },
      );
      assert.equal(probes, 0);
    });
  }
  assert.deepEqual(logs, []);
});

test("nix cache health rejects nix store-info false positives when HTTP is unreachable", async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-health-false-positive-"));
  t.after(async () => await fsp.rm(tmp, { recursive: true, force: true }));
  const nixPath = path.join(tmp, "nix");
  const curlPath = path.join(tmp, "curl");
  const nixLog = path.join(tmp, "nix.log");
  await fsp.writeFile(
    nixPath,
    [
      "#!/bin/sh",
      'printf \'%s\\n\' "$*" >> "$NIX_LOG"',
      'if [ "$1" = "config" ] && [ "$2" = "show" ]; then',
      "  printf '%s\\n' 'extra-substituters = https://unresolvable.example/cache'",
      `  printf '%s\\n' 'netrc-file = ${path.join(tmp, "reviewed.netrc")}'`,
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  await fsp.writeFile(curlPath, "#!/bin/sh\nexit 6\n", { mode: 0o755 });
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
      const result = await applyNixCacheHealthPolicy("/tmp/repo", {
        resolveCurlBin: () => curlPath,
      });
      assert.deepEqual(result.removed, ["https://unresolvable.example/cache"]);
      assert.doesNotMatch(await fsp.readFile(nixLog, "utf8"), /store info/);
    },
  );

  const malformed = "https://operator:malformed-secret@?token=malformed-query-secret";
  await withEnv({ VBR_NIX_CACHE_POLICY: "auto", VBR_NIX_CACHE_HEALTH_APPLIED: "" }, async () => {
    await assert.rejects(
      applyNixCacheHealthPolicy("/tmp/repo", {
        readEffectiveConfig: async () => `substituters = ${malformed}`,
        probeUrl: async () => false,
      }),
      (error: Error) => {
        assert.match(error.message, /configured Nix substituter is malformed/);
        assert.match(error.message, /<invalid-substituter>/);
        assert.doesNotMatch(error.message, /operator|malformed-secret|token=/);
        return true;
      },
    );
  });

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

test("auto cache health disables optional HTTP failures but required and strict remain closed", async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-health-invalid-response-"));
  t.after(async () => await fsp.rm(tmp, { recursive: true, force: true }));
  const nixPath = path.join(tmp, "nix");
  const curlPath = path.join(tmp, "curl");
  await fsp.writeFile(curlPath, "#!/bin/sh\nexit 22\n", { mode: 0o755 });
  const optional = "https://invalid-response.example/cache?priority=fixture-secret-must-redact";
  const run = async (setting: "substituters" | "extra-substituters", policy: "auto" | "strict") => {
    await fsp.writeFile(
      nixPath,
      [
        "#!/bin/sh",
        'if [ "$1" = "config" ] && [ "$2" = "show" ]; then',
        `  printf '%s\\n' '${setting} = ${optional}'`,
        "fi",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    return await withEnv(
      {
        PATH: `${tmp}:${process.env.PATH || ""}`,
        VBR_NIX_BIN: nixPath,
        NIX_BIN: nixPath,
        VBR_NIX_CACHE_POLICY: policy,
        VBR_NIX_CACHE_HEALTH_APPLIED: "",
      },
      async () => {
        const logs: string[] = [];
        return await applyNixCacheHealthPolicy("/tmp/repo", {
          resolveCurlBin: () => curlPath,
          log: (line) => logs.push(line),
        }).then(
          (result) => ({ result, logs, error: null }),
          (error: Error) => ({ result: null, logs, error }),
        );
      },
    );
  };

  const degraded = await run("extra-substituters", "auto");
  assert.equal(degraded.error, null);
  assert.deepEqual(degraded.result?.removed, [optional]);
  assert.doesNotMatch(degraded.result?.nixConfig || "", /invalid-response/);
  assert.match(degraded.logs.join("\n"), /disabled unreachable substituter/);
  assert.doesNotMatch(degraded.logs.join("\n"), /fixture-secret-must-redact/);

  for (const [setting, policy] of [
    ["substituters", "auto"],
    ["extra-substituters", "strict"],
  ] as const) {
    const closed = await run(setting, policy);
    assert.equal(closed.result, null);
    assert.match(
      String(closed.error?.message),
      /probe rejected non-transport failure.*curl exit 22/,
    );
    assert.doesNotMatch(String(closed.error?.message), /fixture-secret-must-redact/);
  }
});

test("cache health recovers source roles only for an exact effective union", async () => {
  const required = "https://required-role.example";
  const optional = "https://optional-role.example";
  await withEnv(
    {
      NIX_CONFIG: `substituters = ${required}\nextra-substituters = ${optional}`,
      VBR_NIX_CACHE_POLICY: "auto",
      VBR_NIX_CACHE_HEALTH_APPLIED: "",
    },
    async () => {
      const result = await applyNixCacheHealthPolicy("/tmp/repo", {
        readEffectiveConfig: async () => `substituters = ${required} ${optional}`,
        probeUrl: async () => true,
      });
      assert.deepEqual(result.requiredSubstituters, [required]);
      assert.deepEqual(result.optionalSubstituters, [optional]);

      await assert.rejects(
        applyNixCacheHealthPolicy("/tmp/repo", {
          readEffectiveConfig: async () =>
            `substituters = ${required} https://different-role.example`,
          probeUrl: async () => true,
        }),
        /source roles do not match effective substituters/,
      );
    },
  );
});

test("TypeScript cache health rejects nix config show failure without authority", async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-config-show-failure-"));
  t.after(async () => await fsp.rm(tmp, { recursive: true, force: true }));
  const nixPath = path.join(tmp, "nix");
  await fsp.writeFile(nixPath, "#!/usr/bin/env bash\nexit 42\n", { mode: 0o755 });
  await withEnv(
    {
      PATH: `${tmp}:${process.env.PATH || ""}`,
      VBR_NIX_BIN: nixPath,
      NIX_BIN: nixPath,
      VBR_NIX_CACHE_POLICY: "auto",
      VBR_NIX_CACHE_HEALTH_APPLIED: "",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "",
    },
    async () => {
      await assert.rejects(
        applyNixCacheHealthPolicy("/tmp/repo"),
        /nix config show failed during cache health evaluation/,
      );
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_APPLIED, undefined);
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, undefined);
    },
  );
});

test("successful evaluated no-op publishes exact config while off remains unreviewed", async () => {
  const full = "experimental-features = nix-command flakes\nbuilders =";
  for (const effective of ["", "builders ="]) {
    await withEnv(
      {
        NIX_CONFIG: full,
        VBR_NIX_CACHE_POLICY: "auto",
        VBR_NIX_CACHE_HEALTH_APPLIED: "",
        VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "",
      },
      async () => {
        const result = await applyNixCacheHealthPolicy("/tmp/repo", {
          readEffectiveConfig: async () => effective,
        });
        assert.equal(result.authority, "reviewed");
        assert.equal(result.nixConfig, full);
        assert.equal(process.env.VBR_NIX_CACHE_HEALTH_APPLIED, "1");
        assert.equal(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, full);
      },
    );
  }
  await withEnv(
    {
      NIX_CONFIG: full,
      VBR_NIX_CACHE_POLICY: "off",
      VBR_NIX_CACHE_HEALTH_APPLIED: "",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "",
    },
    async () => {
      const result = await applyNixCacheHealthPolicy("/tmp/repo");
      assert.equal(result.authority, "off");
      assert.equal(result.nixConfig, full);
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_APPLIED, undefined);
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, undefined);
    },
  );
});

test("pre-applied cache health is re-reviewed before child commands", async () => {
  const reviewed = "builders =\nsubstituters =\nextra-substituters =\nfallback = true";
  let reads = 0;
  await withEnv(
    {
      NIX_CONFIG: reviewed,
      VBR_NIX_CACHE_HEALTH_APPLIED: "1",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: reviewed,
    },
    async () => {
      const result = await applyNixCacheHealthPolicy(process.cwd(), {
        readEffectiveConfig: async () => {
          reads += 1;
          return "builders =";
        },
      });
      assert.equal(result.changed, false);
      assert.equal(result.nixConfig, reviewed);
      assert.equal(process.env.NIX_CONFIG, reviewed);
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, reviewed);
      assert.equal(reads, 1);
    },
  );
});

test("matching reviewed config still reaches b and p call sites", async () => {
  const reviewed = "builders =\nsubstituters =\nextra-substituters =\nfallback = true";
  await withEnv(
    {
      NIX_CONFIG: reviewed,
      VBR_NIX_CACHE_HEALTH_APPLIED: "1",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: reviewed,
    },
    async () => {
      const result = await applyNixCacheHealthPolicy(process.cwd(), {
        readEffectiveConfig: async () => "builders =",
      });
      assert.equal(result.changed, false);
      assert.equal(result.nixConfig, reviewed);
    },
  );

  const build = await fsp.readFile(
    sourceFile("build-tools/tools/dev/dev-build/run-dev-build.ts"),
    "utf8",
  );
  assert.match(build, /internal: \{ NIX_CONFIG: cacheHealth\.nixConfig \}/);
  assert.match(build, /internalNixConfig: cacheHealth\.nixConfig/);
  assert.match(build, /nixCachePolicyCapability,/);
  assert.doesNotMatch(build, /cacheHealth\.changed && cacheHealth\.nixConfig/);

  const runnable = await fsp.readFile(sourceFile("build-tools/tools/dev/run-runnable.ts"), "utf8");
  assert.match(runnable, /config: cacheHealth\.nixConfig/);
  assert.match(runnable, /cacheHealth\.authority === "reviewed"/);
  assert.doesNotMatch(runnable, /cacheHealth\.changed \?/);
});

test("forged pre-applied cache health cannot bypass credential validation", async () => {
  let probes = 0;
  await withEnv(
    {
      NIX_CONFIG: "substituters = https://hostile.invalid?token=fixture-secret",
      VBR_NIX_CACHE_HEALTH_APPLIED: "1",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "substituters =",
    },
    async () => {
      await assert.rejects(
        applyNixCacheHealthPolicy(process.cwd(), {
          readEffectiveConfig: async () => String(process.env.NIX_CONFIG || ""),
          probeUrl: async () => {
            probes += 1;
            return true;
          },
        }),
        (error: Error) => {
          assert.match(error.message, /embeds credentials/);
          assert.doesNotMatch(error.message, /fixture-secret|token=/);
          return true;
        },
      );
      assert.equal(probes, 0);
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_APPLIED, undefined);
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, undefined);
    },
  );
});

test("near-valid malformed HTTP substituters fail closed in auto and strict modes", async () => {
  for (const policy of ["auto", "strict"] as const) {
    for (const malformed of ["https:foo", "https:/foo", "https:///foo"]) {
      await withEnv(
        { VBR_NIX_CACHE_POLICY: policy, VBR_NIX_CACHE_HEALTH_APPLIED: "" },
        async () => {
          await assert.rejects(
            applyNixCacheHealthPolicy(process.cwd(), {
              readEffectiveConfig: async () => `extra-substituters = ${malformed}`,
              probeUrl: async () => true,
            }),
            /configured Nix substituter is malformed/,
          );
        },
      );
    }
  }
});

test("credential-bearing substituter URLs fail closed before review or probe", async () => {
  for (const substituter of [
    "https://user:password@cache.example/cache",
    "https://cache.example/cache?token=fixture-secret",
    "https://cache.example/cache?to%6ben=fixture-secret",
    "https://cache.example/cache#access_token=fixture-secret",
    "https://cache.example/cache#tenant=x&token=fixture-secret",
  ]) {
    await withEnv(
      {
        NIX_CONFIG: `extra-substituters = ${substituter}`,
        VBR_NIX_CACHE_POLICY: "auto",
        VBR_NIX_CACHE_HEALTH_APPLIED: "",
        VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "",
      },
      async () => {
        let probes = 0;
        await assert.rejects(
          applyNixCacheHealthPolicy(process.cwd(), {
            readEffectiveConfig: async () => `extra-substituters = ${substituter}`,
            probeUrl: async () => {
              probes += 1;
              return true;
            },
          }),
          /embeds credentials in its URL; use netrc-file authentication/,
        );
        assert.equal(probes, 0);
        assert.equal(process.env.VBR_NIX_CACHE_HEALTH_APPLIED, undefined);
        assert.equal(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, undefined);
      },
    );
  }
});

test("all cache-health renderers share the reviewed curl transport status set", async () => {
  assert.deepEqual(NIX_CACHE_TRANSPORT_CURL_EXIT_CODES, [5, 6, 7, 16, 28, 35, 52, 55, 56, 92]);
  const expectedCase = `0|${NIX_CACHE_TRANSPORT_CURL_EXIT_CODES_SHELL}`;
  for (const rel of [
    "build-tools/lang/nix_cache_health.bzl",
    "build-tools/tools/bin/devshell-cache-health.sh",
    "build-tools/tools/lib/consumer-direnv.ts",
  ]) {
    assert.match(
      await fsp.readFile(sourceFile(rel), "utf8"),
      new RegExp(escapeRegex(expectedCase)),
    );
  }
});

test("Buck cache-health renderer publishes evaluated success but not off or failure", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-cache-health-parity-"));
  try {
    const nix = path.join(root, "nix");
    const curl = path.join(root, "curl");
    await fsp.writeFile(
      nix,
      '#!/usr/bin/env bash\n[[ "${TEST_NIX_CONFIG_STATUS:-0}" == 0 ]] || exit "$TEST_NIX_CONFIG_STATUS"\nprintf "%s\\n" "${TEST_EFFECTIVE_NIX_CONFIG:-}"\n',
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(root, "curl"),
      '#!/usr/bin/env bash\ncase "$*" in *removed.example*) exit 6 ;; *) exit 0 ;; esac\n',
      { mode: 0o755 },
    );
    await fsp.writeFile(curl, "#!/usr/bin/env bash\nexit 22\n", { mode: 0o755 });
    const source = await fsp.readFile(sourceFile("build-tools/lang/nix_cache_health.bzl"), "utf8");
    const shell = buckCacheHealthShell(source).replaceAll("exit 1", "return 1");
    const full = "experimental-features = nix-command flakes\nbuilders =";
    for (const testCase of [
      { effective: "", expected: `0\u001f1\u001e${full}`, policy: "auto" },
      { effective: "builders =", expected: `0\u001f1\u001e${full}`, policy: "auto" },
      { effective: "builders =", expected: "0\u001f\u001e", policy: "off" },
      {
        effective: "substituters = https://cache.example",
        expected: "1\u001f\u001e",
        policy: "auto",
      },
      {
        effective: "extra-substituters = https://optional.example/cache?priority=fixture-secret",
        expected: `0\u001f1\u001e${full}\nsubstituters =\nextra-substituters =\nconnect-timeout = 3\nstalled-download-timeout = 10\nfallback = true`,
        policy: "auto",
      },
      {
        effective: "extra-substituters = https://optional.example/cache",
        expected: "1\u001f\u001e",
        policy: "strict",
      },
      { effective: "", expected: "1\u001f\u001e", policy: "auto", status: "42" },
    ]) {
      const { stdout, stderr } = await execFileAsync(
        "/bin/bash",
        [
          "-c",
          `health() { ${shell} }; health >/dev/null 2>&1; status=$?; printf '%s\\037%s\\036%s' "$status" "\${VBR_NIX_CACHE_HEALTH_APPLIED:-}" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG:-}"`,
        ],
        {
          env: {
            ...process.env,
            NIX_BIN: nix,
            VBR_NIX_BIN: nix,
            PATH: `${root}:/usr/bin:/bin`,
            TMPDIR: root,
            NIX_CONFIG: full,
            TEST_EFFECTIVE_NIX_CONFIG: testCase.effective,
            TEST_NIX_CONFIG_STATUS: testCase.status || "0",
            VBR_NIX_CACHE_POLICY: testCase.policy,
            VBR_NIX_CACHE_HEALTH_APPLIED: "",
            VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "",
          },
        },
      );
      assert.equal(stdout, testCase.expected, stderr);
      assert.doesNotMatch(stderr, /fixture-secret/);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("generated stage0 refreshes stale authority and hands exact config to TypeScript", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "stage0-cache-health-authority-"));
  try {
    const nix = path.join(root, "nix");
    const curl = path.join(root, "curl");
    const callLog = path.join(root, "nix-calls");
    const emptyPath = path.join(root, "empty-path");
    const reviewedNetrc = path.join(root, "reviewed.netrc");
    await fsp.mkdir(emptyPath);
    await fsp.writeFile(
      reviewedNetrc,
      "machine auth.example login token password fixture-secret\n",
      { mode: 0o600 },
    );
    await fsp.writeFile(
      nix,
      `#!/usr/bin/env bash
printf 'called\\n' >> ${JSON.stringify(callLog)}
[[ "\${TEST_NIX_CONFIG_STATUS:-0}" == 0 ]] || exit "$TEST_NIX_CONFIG_STATUS"
if [[ "\${3:-}" == "--json" ]]; then
  if [[ -n "\${TEST_EFFECTIVE_NIX_CONFIG_JSON:-}" ]]; then printf '%s\\n' "$TEST_EFFECTIVE_NIX_CONFIG_JSON"; else printf '{}\\n'; fi
elif [[ "\${TEST_EFFECTIVE_FROM_NIX_CONFIG:-}" == "1" ]]; then
  printf '%s\\n' "\${NIX_CONFIG:-}"
else
  printf '%s\\n' "\${TEST_EFFECTIVE_NIX_CONFIG:-}"
fi
`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      curl,
      `#!/usr/bin/env bash
[[ "$*" != *removed.example* ]] || exit 6
[[ "$*" != *invalid-response.example* ]] || exit 22
[[ "$*" != *auth.example* ]] || [[ "$*" == *"--netrc-file ${reviewedNetrc}"* ]] || exit 22
[[ -z "\${TEST_CURL_EXIT:-}" || "$*" != *late-action.example* ]] || exit "$TEST_CURL_EXIT"
exit 0
`,
      { mode: 0o755 },
    );
    const shell = generatedStage0CacheHealthShell();
    const full = "experimental-features = nix-command flakes\nbuilders =";
    const runStage0 = async (opts: {
      applied?: string;
      reviewed?: string;
      policy?: string;
      status?: string;
      nixAvailable?: boolean;
      effective?: string;
      required?: string;
      optional?: string;
      reviewedPolicy?: string;
      nixConfig?: string;
      sourceConfig?: string;
      effectiveFromNixConfig?: boolean;
      effectiveJson?: string;
      nixConfDir?: string;
      roleSourceRoot?: string;
    }) => {
      await fsp.rm(callLog, { force: true });
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH:
          opts.nixAvailable === false
            ? emptyPath
            : `${root}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
        NIX_CONFIG: opts.nixConfig ?? full,
        TEST_EFFECTIVE_NIX_CONFIG: opts.effective ?? "builders =",
        TEST_EFFECTIVE_NIX_CONFIG_JSON: opts.effectiveJson || "",
        TEST_EFFECTIVE_FROM_NIX_CONFIG: opts.effectiveFromNixConfig ? "1" : "0",
        TEST_NIX_CONFIG_STATUS: opts.status || "0",
        VBR_NIX_CACHE_POLICY: opts.policy || "auto",
      };
      if (opts.nixConfDir !== undefined) {
        env.NIX_CONF_DIR = opts.nixConfDir;
        env.NIX_USER_CONF_FILES = "";
      }
      if (opts.roleSourceRoot !== undefined) env.VIBEROOTS_ROOT = opts.roleSourceRoot;
      if (opts.applied !== undefined) env.VBR_NIX_CACHE_HEALTH_APPLIED = opts.applied;
      else delete env.VBR_NIX_CACHE_HEALTH_APPLIED;
      if (opts.reviewed !== undefined) env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG = opts.reviewed;
      else delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG;
      if (opts.required !== undefined)
        env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS = opts.required;
      else delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS;
      if (opts.optional !== undefined)
        env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS = opts.optional;
      else delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS;
      if (opts.reviewedPolicy !== undefined)
        env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY = opts.reviewedPolicy;
      else delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY;
      if (opts.sourceConfig !== undefined)
        env.VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG = opts.sourceConfig;
      else delete env.VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG;
      const { stdout } = await execFileAsync(
        "/bin/bash",
        [
          "-c",
          `${shell}\nset +e; __vbr_stage0_apply_nix_cache_health >/dev/null 2>&1; status=$?; printf '%s\\026%s\\027%s\\030%s\\031%s\\032%s\\033%s\\034%s\\035%s' "$status" "\${VBR_NIX_CACHE_HEALTH_APPLIED-}" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG-}" "\${NIX_CONFIG-}" "\${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG-}" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS-}" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS-}" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY-}" "\${__vbr_stage0_cache_nix_args[*]-}"`,
        ],
        { env },
      );
      const [
        status,
        applied,
        reviewed,
        nixConfig,
        sourceConfig,
        required,
        optional,
        reviewedPolicy,
        nixArgs,
      ] = stdout.split(/[\u0016-\u001d]/u);
      const calls = await fsp
        .readFile(callLog, "utf8")
        .then((value) => value.trim().split("\n").filter(Boolean).length)
        .catch(() => 0);
      return {
        status: Number(status),
        applied,
        reviewed,
        nixConfig,
        sourceConfig,
        required,
        optional,
        reviewedPolicy,
        nixArgs,
        calls,
      };
    };

    const refreshed = await runStage0({ applied: "1" });
    assert.deepEqual(refreshed, {
      status: 0,
      applied: "1",
      reviewed: full,
      nixConfig: full,
      sourceConfig: "builders =",
      required: "",
      optional: "",
      reviewedPolicy: "auto",
      nixArgs:
        "--option substituters  --option extra-substituters  --option connect-timeout 3 --option stalled-download-timeout 10 --option fallback true",
      calls: 1,
    });

    const nixConfDir = path.join(root, "nix-conf");
    await fsp.mkdir(nixConfDir);
    await fsp.writeFile(
      path.join(nixConfDir, "nix.conf"),
      "extra-substituters = https://invalid-response.example/cache\n",
    );
    const flattenedRoles = await runStage0({
      effective:
        "substituters = https://required.example/cache https://invalid-response.example/cache",
      effectiveJson: JSON.stringify({
        substituters: {
          defaultValue: ["https://required.example/cache"],
          value: ["https://required.example/cache", "https://invalid-response.example/cache"],
        },
      }),
      nixConfDir,
      roleSourceRoot: VIBEROOTS_ROOT,
    });
    assert.equal(flattenedRoles.status, 0);
    assert.equal(flattenedRoles.required, "https://required.example/cache");
    assert.equal(flattenedRoles.optional, "");

    const lateOptional = "https://late-action.example/cache";
    await fsp.writeFile(
      path.join(nixConfDir, "nix.conf"),
      `extra-substituters = ${lateOptional}\n`,
    );
    const flattenedActionRoles = await runStage0({
      effective: `substituters = https://required.example/cache ${lateOptional}`,
      effectiveJson: JSON.stringify({
        substituters: {
          defaultValue: ["https://required.example/cache"],
          value: ["https://required.example/cache", lateOptional],
        },
      }),
      nixConfDir,
      roleSourceRoot: VIBEROOTS_ROOT,
    });
    assert.equal(flattenedActionRoles.status, 0);
    assert.equal(flattenedActionRoles.required, "https://required.example/cache");
    assert.equal(flattenedActionRoles.optional, lateOptional);

    const buckSource = await fsp.readFile(
      sourceFile("build-tools/lang/nix_cache_health.bzl"),
      "utf8",
    );
    const buckShell = buckCacheHealthShell(buckSource).replaceAll("exit 1", "return 1");
    const runBoundAction = async (required: string[], optional: string[]) => {
      const config = flattenedActionRoles.nixConfig;
      const binding = nixCachePolicyBindingDigest({
        kind: "reviewed",
        config,
        policy: "auto",
        requiredSubstituters: required,
        optionalSubstituters: optional,
      });
      const { stdout } = await execFileAsync(
        "/bin/bash",
        ["-c", `health() { ${buckShell} }; set +e; health >/dev/null 2>&1; printf '%s' "$?"`],
        {
          env: {
            ...process.env,
            NIX_BIN: nix,
            VBR_NIX_BIN: nix,
            PATH: `${root}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
            TEST_CURL_EXIT: "22",
            TEST_EFFECTIVE_NIX_CONFIG: `substituters = https://required.example/cache ${lateOptional}`,
            TEST_NIX_CONFIG_STATUS: "0",
            TMPDIR: root,
            VBR_ARTIFACT_TOOLS_ROOT: path.dirname(path.dirname(process.execPath)),
            VBR_NIX_CACHE_POLICY: "auto",
            NIX_CONFIG: config,
            VBR_NIX_CACHE_ROLE_REQUIRED: required.join(" "),
            VBR_NIX_CACHE_ROLE_OPTIONAL: optional.join(" "),
            VBR_NIX_CACHE_ROLE_POLICY: "auto",
            VBR_NIX_CACHE_ROLE_BINDING: binding,
          },
        },
      );
      return Number(stdout);
    };
    assert.equal(await runBoundAction(["https://required.example/cache"], [lateOptional]), 0);
    assert.equal(await runBoundAction([lateOptional], []), 1);
    assert.equal(await runBoundAction([lateOptional], [lateOptional]), 1);

    const mismatchedJsonRoles = await runStage0({
      effective: "substituters = file:///system-cache",
      effectiveJson: "{}",
      roleSourceRoot: VIBEROOTS_ROOT,
    });
    assert.equal(mismatchedJsonRoles.status, 1);
    assert.equal(mismatchedJsonRoles.required, "");
    assert.equal(mismatchedJsonRoles.optional, "");
    assert.equal(mismatchedJsonRoles.nixArgs, "");
    await withEnv(
      {
        NIX_CONFIG: refreshed.nixConfig,
        VBR_NIX_CACHE_HEALTH_APPLIED: refreshed.applied,
        VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: refreshed.reviewed,
      },
      async () => {
        const result = await applyNixCacheHealthPolicy("/tmp/repo", {
          readEffectiveConfig: async () => "builders =",
        });
        assert.equal(result.authority, "reviewed");
        assert.equal(result.nixConfig, full);
      },
    );

    const reReviewed = await runStage0({
      applied: "1",
      reviewed: full,
      required: "",
      optional: "",
      reviewedPolicy: "auto",
      sourceConfig: "builders =",
    });
    assert.equal(reReviewed.status, 0);
    assert.equal(reReviewed.reviewed, "builders =");
    assert.equal(reReviewed.reviewedPolicy, "auto");
    assert.equal(reReviewed.sourceConfig, "builders =");
    assert.equal(
      reReviewed.nixArgs,
      "--option substituters  --option extra-substituters  --option connect-timeout 3 --option stalled-download-timeout 10 --option fallback true",
    );
    assert.equal(reReviewed.calls, 1);

    const stale = await runStage0({ applied: "1", reviewed: full, status: "42" });
    assert.equal(stale.status, 1);
    assert.equal(stale.applied, "");
    assert.equal(stale.required, "");
    assert.equal(stale.optional, "");
    assert.equal(stale.reviewedPolicy, "");
    assert.equal(stale.sourceConfig, "");
    assert.equal(stale.nixArgs, "");
    assert.equal(stale.calls, 1);

    const duplicateAssignments = await runStage0({
      nixConfig: [
        "substituters = file:///raw-first",
        "substituters = file:///raw-last",
        "extra-substituters = file:///raw-optional",
      ].join("\n"),
      effective: [
        "substituters = file:///effective-last",
        "extra-substituters = file:///effective-optional",
      ].join("\n"),
    });
    assert.equal(duplicateAssignments.required, "file:///effective-last");
    assert.equal(duplicateAssignments.optional, "file:///effective-optional");
    assert.match(duplicateAssignments.nixArgs, /file:\/\/\/effective-last/);
    assert.doesNotMatch(duplicateAssignments.nixArgs, /raw-(?:first|last|optional)/);

    const systemOnly = await runStage0({
      nixConfig: "builders =",
      effective: "substituters = file:///system-cache",
      effectiveJson: JSON.stringify({
        substituters: {
          defaultValue: ["file:///system-cache"],
          value: ["file:///system-cache"],
        },
      }),
      nixConfDir: await fsp.mkdtemp(path.join(root, "system-nix-conf-")),
      roleSourceRoot: VIBEROOTS_ROOT,
    });
    assert.equal(systemOnly.required, "file:///system-cache");
    assert.match(systemOnly.nixArgs, /--option substituters file:\/\/\/system-cache/);

    const authenticated = await runStage0({
      effective: [
        "extra-substituters = https://auth.example/cache",
        `netrc-file = ${reviewedNetrc}`,
      ].join("\n"),
    });
    assert.equal(authenticated.status, 0);
    assert.match(authenticated.reviewed, new RegExp(`netrc-file = ${reviewedNetrc}`));
    assert.equal(authenticated.nixConfig, authenticated.reviewed);
    assert.doesNotMatch(authenticated.reviewed, /fixture-secret/);

    const credentialRejected = await runStage0({
      effective: "extra-substituters = https://auth.example/cache?token=fixture-secret",
      applied: "1",
      reviewed: "extra-substituters = https://auth.example/cache?token=fixture-secret",
      required: "",
      optional: "https://auth.example/cache?token=fixture-secret",
      reviewedPolicy: "auto",
      sourceConfig: "extra-substituters = https://auth.example/cache?token=fixture-secret",
    });
    assert.equal(credentialRejected.status, 1);
    assert.equal(credentialRejected.applied, "");
    assert.equal(credentialRejected.reviewed, "");
    assert.equal(credentialRejected.sourceConfig, "");
    assert.doesNotMatch(credentialRejected.nixConfig, /fixture-secret|token=/);

    const removed = await runStage0({
      effective: [
        "substituters = file:///system-cache",
        "extra-substituters = https://removed.example/cache file:///kept-optional",
      ].join("\n"),
    });
    assert.equal(removed.required, "file:///system-cache");
    assert.equal(removed.optional, "file:///kept-optional");
    assert.doesNotMatch(removed.nixArgs, /removed\.example/);

    const optionalHttpFailure = await runStage0({
      effective:
        "extra-substituters = https://invalid-response.example/cache?priority=fixture-secret",
    });
    assert.equal(optionalHttpFailure.status, 0);
    assert.equal(optionalHttpFailure.applied, "1");
    assert.doesNotMatch(optionalHttpFailure.nixConfig, /invalid-response|fixture-secret/);

    const requiredHttpFailure = await runStage0({
      effective: "substituters = https://invalid-response.example/cache",
    });
    assert.equal(requiredHttpFailure.status, 1);
    assert.equal(requiredHttpFailure.applied, "");

    const strictOptionalHttpFailure = await runStage0({
      effective: "extra-substituters = https://invalid-response.example/cache",
      policy: "strict",
    });
    assert.equal(strictOptionalHttpFailure.status, 1);
    assert.equal(strictOptionalHttpFailure.applied, "");

    const removedReused = await runStage0({
      applied: removed.applied,
      reviewed: removed.reviewed,
      required: removed.required,
      optional: removed.optional,
      reviewedPolicy: removed.reviewedPolicy,
      sourceConfig: removed.sourceConfig,
      effective: removed.sourceConfig,
    });
    assert.equal(removedReused.status, 0);
    assert.equal(removedReused.calls, 1);
    assert.doesNotMatch(removedReused.nixArgs, /removed\.example/);

    const degradedAutoToStrict = await runStage0({
      applied: removed.applied,
      reviewed: removed.reviewed,
      required: removed.required,
      optional: removed.optional,
      reviewedPolicy: "auto",
      sourceConfig: removed.sourceConfig,
      policy: "strict",
      nixConfig: removed.reviewed,
      effectiveFromNixConfig: true,
    });
    assert.equal(degradedAutoToStrict.status, 1);
    assert.equal(degradedAutoToStrict.applied, "");
    assert.equal(degradedAutoToStrict.reviewedPolicy, "");
    assert.equal(degradedAutoToStrict.nixArgs, "");
    assert.equal(degradedAutoToStrict.calls, 1);

    const strictToAuto = await runStage0({
      applied: "1",
      reviewed: full,
      required: "file:///strict-cache",
      optional: "",
      reviewedPolicy: "strict",
      sourceConfig: "substituters = file:///strict-cache",
      policy: "auto",
      effectiveFromNixConfig: true,
      effectiveJson: JSON.stringify({
        substituters: {
          defaultValue: [],
          value: ["file:///strict-cache"],
        },
      }),
      roleSourceRoot: VIBEROOTS_ROOT,
    });
    assert.equal(strictToAuto.status, 0);
    assert.equal(strictToAuto.required, "file:///strict-cache");
    assert.equal(strictToAuto.reviewedPolicy, "auto");
    assert.equal(strictToAuto.calls, 2);

    const empty = await runStage0({ effective: "" });
    assert.equal(empty.status, 0);
    assert.equal(empty.applied, "1");
    assert.equal(empty.reviewed, full);
    assert.equal(empty.calls, 1);

    const off = await runStage0({
      applied: "1",
      reviewed: full,
      required: "file:///auto-cache",
      optional: "file:///optional-cache",
      reviewedPolicy: "auto",
      sourceConfig: "substituters = file:///original-cache",
      policy: "off",
      status: "42",
    });
    assert.equal(off.status, 0);
    assert.equal(off.applied, "");
    assert.equal(off.reviewed, "");
    assert.equal(off.required, "");
    assert.equal(off.optional, "");
    assert.equal(off.reviewedPolicy, "");
    assert.equal(off.sourceConfig, "");
    assert.equal(off.nixArgs, "");
    assert.equal(off.calls, 0);
    assert.equal(off.nixConfig, "substituters = file:///original-cache");

    const noNix = await runStage0({ applied: "1", nixAvailable: false });
    assert.equal(noNix.status, 0);
    assert.equal(noNix.applied, "");
    assert.equal(noNix.reviewed, "");
    assert.equal(noNix.required, "");
    assert.equal(noNix.optional, "");
    assert.equal(noNix.reviewedPolicy, "");
    assert.equal(noNix.nixArgs, "");
    assert.equal(noNix.calls, 0);

    const failed = await runStage0({ applied: "1", status: "42" });
    assert.equal(failed.status, 1);
    assert.equal(failed.applied, "");
    assert.equal(failed.reviewed, "");
    assert.equal(failed.calls, 1);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
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

  const requiredUnavailable = await evaluateNixCacheReadinessFromConfig(
    "substituters = https://required.dynamic.example/cache",
    "auto",
    async () => false,
  );
  assert.equal(requiredUnavailable.state, "failed");
  assert.match(requiredUnavailable.message, /required cache policy failed/);

  const strict = await evaluateNixCacheReadinessFromConfig(
    "extra-substituters = https://strict.dynamic.example/cache",
    "strict",
    async () => false,
  );
  assert.equal(strict.state, "failed");
  assert.doesNotMatch(JSON.stringify(strict), /home\.kilty|kilty\.io/);

  const optionalHttpFailure = await evaluateNixCacheReadinessFromConfig(
    "extra-substituters = https://optional-http.example/cache",
    "auto",
    async () => {
      throw new Error("curl exit 22");
    },
  );
  assert.equal(optionalHttpFailure.state, "degraded");

  const flattenedOptionalHttpFailure = await evaluateNixCacheReadinessFromConfig(
    "substituters = https://required.example https://optional.example",
    "auto",
    async (url) => {
      if (url.includes("optional")) throw new Error("curl exit 22");
      return true;
    },
    {
      requiredSubstituters: ["https://required.example"],
      optionalSubstituters: ["https://optional.example"],
    },
  );
  assert.equal(flattenedOptionalHttpFailure.state, "degraded");
  await assert.rejects(
    evaluateNixCacheReadinessFromConfig(
      "substituters = https://required.example https://optional.example",
      "auto",
      async () => true,
      {
        requiredSubstituters: ["https://required.example"],
        optionalSubstituters: ["https://forged.example"],
      },
    ),
    /proven Nix cache roles do not match effective config/,
  );

  for (const [config, policy] of [
    ["substituters = https://required-http.example/cache", "auto"],
    ["extra-substituters = https://optional-http.example/cache", "strict"],
  ] as const) {
    await assert.rejects(
      evaluateNixCacheReadinessFromConfig(config, policy, async () => {
        throw new Error("curl exit 22");
      }),
      /curl exit 22/,
    );
  }
});

test("nix cache readiness preserves safe queries and rejects URL credentials before probing", async () => {
  const probed: string[] = [];
  const readiness = await evaluateNixCacheReadinessFromConfig(
    "extra-substituters = https://cache.example/path?priority=40",
    "auto",
    async (url) => {
      probed.push(url);
      return false;
    },
  );
  assert.equal(readiness.state, "degraded");
  assert.deepEqual(readiness.optionalSubstituters, ["https://cache.example/path"]);
  assert.deepEqual(probed, ["https://cache.example/path?priority=40"]);
  for (const unsafe of [
    "https://operator:secret@cache.example/path",
    "https://cache.example/path?token=fixture-secret",
    "https://cache.example/path?to%6ben=fixture-secret",
    "https://cache.example/path#access_token=fixture-secret",
    "https://cache.example/path#tenant=x&token=fixture-secret",
  ]) {
    const before = probed.length;
    await assert.rejects(
      evaluateNixCacheReadinessFromConfig(`extra-substituters = ${unsafe}`, "auto", async (url) => {
        probed.push(url);
        return true;
      }),
      (error: Error) => {
        assert.match(error.message, /embeds credentials/);
        assert.doesNotMatch(error.message, /fixture-secret|operator|secret|token=/);
        return true;
      },
    );
    assert.equal(probed.length, before);
  }
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
    /const cacheHealth = await applyNixCacheHealthPolicy\(root\)[\s\S]*internal: \{ NIX_CONFIG: cacheHealth\.nixConfig \}/,
  );
  const build = await fsp.readFile(sourceFile("build-tools/tools/bin/build"), "utf8");
  assertOrder(
    build,
    "artifact_ingress_trust_devshell_baseline",
    "artifact_ingress_refresh_nix_cache_health",
  );
  assertOrder(
    build,
    "artifact_ingress_refresh_nix_cache_health",
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

  const env = [
    await fsp.readFile(sourceFile("build-tools/tools/bin/devshell-cache-health.sh"), "utf8"),
    await fsp.readFile(sourceFile("build-tools/tools/bin/devshell-workspace.sh"), "utf8"),
    await fsp.readFile(sourceFile("build-tools/tools/bin/devshell.sh"), "utf8"),
  ].join("\n");
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
  assert.match(buck, /export VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG=\\"\$\{NIX_CONFIG:-\}\\"/);
  assert.match(buck, /printf -v NIX_CONFIG '%s\\nsubstituters =%s\\nextra-substituters =%s/);
  assert.match(buck, /nix-cache-info/);
  assert.match(buck, /NIX_CACHE_BASE=.*NIX_CACHE_SUB%%\\\\\?\*/);
  assert.match(buck, /nix-cache-info\$\{NIX_CACHE_QUERY\}/);
  assert.match(buck, /curl -fsS --connect-timeout 3 --max-time 5/);
  assert.match(buck, /if curl -fsS --connect-timeout 3 --max-time 5/);
  assert.match(
    buckShell,
    /\[ -n "\$NIX_CACHE_NETRC" \] && \[ -f "\$NIX_CACHE_NETRC" \] && \[ -r "\$NIX_CACHE_NETRC" \]/,
  );
  assert.match(buckShell, /--netrc-file "\$NIX_CACHE_NETRC"/);
  assert.match(buckShell, /NIX_CACHE_NETRC="\$VBR_ACTION_NETRC_FILE"/);
  assert.match(buckShell, /embeds credentials in its URL; use netrc-file authentication/);
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
  assert.match(
    buckShell,
    /NIX_CACHE_CREDENTIAL_URL="\$\(printf '%s' "\$NIX_CACHE_SUB" \| tr '\[:upper:\]' '\[:lower:\]'\)"/,
  );
  assert.doesNotMatch(buck, /export NIX_CONFIG="[^"]*\\\\n/);

  const actionShell = await fsp.readFile(sourceFile("build-tools/lang/nix_shell.bzl"), "utf8");
  assert.match(actionShell, /VBR_ACTION_EFFECTIVE_NETRC/);
  assert.doesNotMatch(actionShell, /VBR_ACTION_REVIEWED_NIX_CONFIG|VBR_ACTION_REVIEWED_NETRC/);
  assert.match(actionShell, /proven Nix cache roles do not match effective substituters/);
  assert.match(actionShell, /u\.every\(\(x,i\)=>x===c\[i\]\)/);
  assert.match(actionShell, /JSON\.stringify\(\{required:/);
  assert.match(actionShell, /\.slice\(0,16\)/);
  assert.doesNotMatch(actionShell, /required:\s*r[,}]/);
  assert.doesNotMatch(actionShell, /optional:\s*o[,}]/);
  assert.doesNotMatch(actionShell, /baseline:\s*e\./);
  assert.doesNotMatch(actionShell, /candidate:\s*e\./);
  assert.match(actionShell, /\(umask 077; cp \\"\$VBR_ACTION_EFFECTIVE_NETRC\\"/);
  assert.match(actionShell, /netrc-file = %s.*VBR_ARTIFACT_STATE\/netrc/);
  assert.match(
    actionShell,
    /unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG [^"]*; "\s*\+ nix_cache_health_shell\(\)/,
  );
  assert.match(buckShell, /proven Nix cache roles do not match reviewed config bytes/);
  assert.match(buckShell, /VBR_NIX_CACHE_ROLE_BINDING/);
  assert.match(actionShell, /vbr-nix-cache-review@1/);
  assert.doesNotMatch(actionShell, /cat \\"\$VBR_ACTION_EFFECTIVE_NETRC\\"/);
  assert.doesNotMatch(actionShell, /cache\\.home|NETRC_SOURCE_|NETRC_COPY_/);

  const verifyHealth = await fsp.readFile(
    sourceFile("build-tools/tools/dev/verify/nix-cache-health.ts"),
    "utf8",
  );
  const verifyHealthConfig = await fsp.readFile(
    sourceFile("build-tools/tools/dev/verify/nix-cache-health-config.ts"),
    "utf8",
  );
  assert.match(verifyHealth, /from "\.\/nix-cache-health-config"/);
  assert.match(verifyHealthConfig, /import fs from "node:fs"/);

  assert.match(env, /nix-cache-info/);
  assert.match(env, /export VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG="\$\{NIX_CONFIG(?::-)?\}"/);
  assert.match(env, /cache_base="\$\{substituter%%\\\?\*\}"/);
  assert.match(env, /nix-cache-info\$\{cache_query\}/);
  assert.match(env, /local curl_args=\(-fsS --connect-timeout 3 --max-time 5\)/);
  assert.match(env, /curl "\$\{curl_args\[@\]\}" "\$\{cache_info_url\}"/);
  assert.match(
    env,
    /\[\[ -n "\$\{netrc_file\}" && -f "\$\{netrc_file\}" && -r "\$\{netrc_file\}" \]\]/,
  );
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
  assert.match(verifyBuckEnv, /assertSafeNixCacheConfig/);
  assert.doesNotMatch(verifyBuckEnv, /maybeEnvArg\("VBR_NIX_CACHE_HEALTH_APPLIED"/);
  assert.doesNotMatch(verifyBuckEnv, /maybeEnvArg\(\s*"VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG"/);
});

function assertOrder(source: string, first: string, second: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${first} must be present`);
  assert.notEqual(secondIndex, -1, `${second} must be present`);
  assert.ok(firstIndex < secondIndex, `${first} must appear before ${second}`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("canonical cache re-review issues capability in the active module instance", async () => {
  const required = "file:///required-cache";
  const optional = "file:///optional-cache";
  const reviewed = `builders =\nsubstituters = ${required}\nextra-substituters = ${optional}\nfallback = true`;
  await withEnv(
    {
      NIX_CONFIG: reviewed,
      VBR_CANONICAL_ARTIFACT_ENTRYPOINT: "1",
      VBR_NIX_CACHE_HEALTH_APPLIED: "1",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: reviewed,
      VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS: optional,
      VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY: "auto",
      VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS: required,
    },
    async () => {
      await applyNixCacheHealthPolicy(process.cwd(), {
        readEffectiveConfig: async () => "builders =",
      });
      assert.deepEqual(outcomeFromNixCachePolicyCapability(currentNixCachePolicyCapability()), {
        kind: "reviewed",
        config: reviewed,
        policy: "auto",
        requiredSubstituters: [required],
        optionalSubstituters: [optional],
      });
    },
  );
});
