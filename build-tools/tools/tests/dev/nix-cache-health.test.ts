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

function generatedStage0CacheHealthShell(): string {
  const source = direnvStage0();
  const start = source.indexOf("__vbr_stage0_strip_nix_cache_overrides() {");
  const end = source.indexOf("\n__vbr_stage0_filtered_viberoots_input() {", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

async function generatedDevshellCacheHealthShell(): Promise<string> {
  const source = await fsp.readFile(sourceFile("build-tools/tools/bin/devshell.sh"), "utf8");
  const start = source.indexOf("env_mark_macos_metadata_never_index() {");
  const end = source.indexOf("\nensure_viberoots_current() {", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
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
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, process.env.NIX_CONFIG);
      assert.match(logs.join("\n"), /disabled unreachable substituter/);
    },
  );
});

test("nix cache health skips repeated probes after the environment is marked handled", async () => {
  await withEnv(
    {
      NIX_CONFIG: "",
      VBR_NIX_CACHE_HEALTH_APPLIED: "1",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "",
    },
    async () => {
      const result = await applyNixCacheHealthPolicy("/tmp/repo", {
        readEffectiveConfig: async () => {
          throw new Error("should not read config after cache health is marked handled");
        },
        probeUrl: async () => {
          throw new Error("should not probe after cache health is marked handled");
        },
      });
      assert.equal(result.changed, false);
    },
  );
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
      "#!/bin/sh",
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
      assert.equal(result.changed, false);
      assert.deepEqual(result.kept, ["https://auth.example/cache?token=fixture-query"]);
      const probe = await fsp.readFile(logPath, "utf8");
      assert.match(probe, new RegExp(`--netrc-file ${netrcPath.replaceAll("/", "\\/")}`));
      assert.match(probe, /https:\/\/auth\.example\/cache\/nix-cache-info\?token=fixture-query/);
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
          readEffectiveConfig: async () => "substituters = https://cache.example",
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
    await fsp.writeFile(
      nixPath,
      '#!/usr/bin/env bash\nprintf "substituters = https://cache.example\\n"; [[ -z "${TEST_NETRC_FILE:-}" ]] || printf "netrc-file = %s\\n" "$TEST_NETRC_FILE"\n',
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
    ) => {
      await fsp.rm(logPath, { force: true });
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
            PATH: `${tmp}:/usr/bin:/bin`,
            TEST_NETRC_FILE: netrcFile,
            TMPDIR: tmp,
            VBR_NIX_CACHE_POLICY: "auto",
            VBR_NIX_CACHE_HEALTH_APPLIED: "",
            VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "",
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
        assert.equal(result.status, 0);
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
        0,
        `${renderer.name}: transport failure remains tolerated`,
      );
    }
  } finally {
    await fsp.chmod(path.join(tmp, "unreadable.netrc"), 0o600).catch(() => {});
    await fsp.rm(tmp, { recursive: true, force: true });
  }
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
      "#!/bin/sh",
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

test("nix cache health never downgrades non-transport probe failures", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-health-invalid-response-"));
  const nixPath = path.join(tmp, "nix");
  const curlPath = path.join(tmp, "curl");
  await fsp.writeFile(
    nixPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "config" ] && [ "$2" = "show" ]; then',
      "  printf '%s\\n' 'extra-substituters = https://invalid-response.example/cache'",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  await fsp.writeFile(curlPath, "#!/bin/sh\nexit 22\n", { mode: 0o755 });
  await withEnv(
    {
      PATH: `${tmp}:${process.env.PATH || ""}`,
      VBR_NIX_BIN: nixPath,
      NIX_BIN: nixPath,
      VBR_NIX_CACHE_POLICY: "auto",
      VBR_NIX_CACHE_HEALTH_APPLIED: "",
    },
    async () => {
      await assert.rejects(
        applyNixCacheHealthPolicy("/tmp/repo", {
          resolveCurlBin: () => curlPath,
        }),
        /probe rejected non-transport failure.*curl exit 22/,
      );
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_APPLIED, undefined);
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, undefined);
    },
  );
});

test("TypeScript cache health rejects nix config show failure without authority", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-cache-config-show-failure-"));
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

test("pre-applied cache health retains the exact reviewed config for child commands", async () => {
  const reviewed = "builders =\nsubstituters =\nextra-substituters =\nfallback = true";
  await withEnv(
    {
      NIX_CONFIG: reviewed,
      VBR_NIX_CACHE_HEALTH_APPLIED: "1",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: reviewed,
    },
    async () => {
      const result = await applyNixCacheHealthPolicy(process.cwd());
      assert.equal(result.changed, false);
      assert.equal(result.nixConfig, reviewed);
      assert.equal(process.env.NIX_CONFIG, reviewed);
      assert.equal(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG, reviewed);
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
      const result = await applyNixCacheHealthPolicy(process.cwd());
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
  assert.doesNotMatch(build, /cacheHealth\.changed && cacheHealth\.nixConfig/);

  const runnable = await fsp.readFile(sourceFile("build-tools/tools/dev/run-runnable.ts"), "utf8");
  assert.match(runnable, /config: cacheHealth\.nixConfig/);
  assert.match(runnable, /cacheHealth\.authority === "reviewed"/);
  assert.doesNotMatch(runnable, /cacheHealth\.changed \?/);
});

test("pre-applied cache health rejects a mismatched active config", async () => {
  await withEnv(
    {
      NIX_CONFIG: "substituters = https://hostile.invalid",
      VBR_NIX_CACHE_HEALTH_APPLIED: "1",
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "substituters =",
    },
    async () => {
      await assert.rejects(
        applyNixCacheHealthPolicy(process.cwd()),
        /does not match its reviewed authority/,
      );
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

test("all cache-health renderers share the reviewed curl transport status set", async () => {
  assert.deepEqual(NIX_CACHE_TRANSPORT_CURL_EXIT_CODES, [5, 6, 7, 16, 28, 52, 55, 56, 92]);
  const expectedCase = `0|${NIX_CACHE_TRANSPORT_CURL_EXIT_CODES_SHELL}`;
  for (const rel of [
    "build-tools/lang/nix_cache_health.bzl",
    "build-tools/tools/bin/devshell.sh",
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
      { effective: "", expected: "1\u001f\u001e", policy: "auto", status: "42" },
    ]) {
      const { stdout } = await execFileAsync(
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
            NIX_CONFIG: full,
            TEST_EFFECTIVE_NIX_CONFIG: testCase.effective,
            TEST_NIX_CONFIG_STATUS: testCase.status || "0",
            VBR_NIX_CACHE_POLICY: testCase.policy,
            VBR_NIX_CACHE_HEALTH_APPLIED: "",
            VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: "",
          },
        },
      );
      assert.equal(stdout, testCase.expected);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("generated stage0 refreshes stale authority and hands exact config to TypeScript", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "stage0-cache-health-authority-"));
  try {
    const nix = path.join(root, "nix");
    const callLog = path.join(root, "nix-calls");
    const emptyPath = path.join(root, "empty-path");
    await fsp.mkdir(emptyPath);
    await fsp.writeFile(
      nix,
      `#!/usr/bin/env bash
printf 'called\\n' >> ${JSON.stringify(callLog)}
[[ "\${TEST_NIX_CONFIG_STATUS:-0}" == 0 ]] || exit "$TEST_NIX_CONFIG_STATUS"
if [[ "\${TEST_EFFECTIVE_FROM_NIX_CONFIG:-}" == "1" ]]; then
  printf '%s\\n' "\${NIX_CONFIG:-}"
else
  printf '%s\\n' "\${TEST_EFFECTIVE_NIX_CONFIG:-}"
fi
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
    }) => {
      await fsp.rm(callLog, { force: true });
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: opts.nixAvailable === false ? emptyPath : `${root}:/usr/bin:/bin`,
        NIX_CONFIG: opts.nixConfig ?? full,
        TEST_EFFECTIVE_NIX_CONFIG: opts.effective ?? "builders =",
        TEST_EFFECTIVE_FROM_NIX_CONFIG: opts.effectiveFromNixConfig ? "1" : "0",
        TEST_NIX_CONFIG_STATUS: opts.status || "0",
        VBR_NIX_CACHE_POLICY: opts.policy || "auto",
      };
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
    await withEnv(
      {
        NIX_CONFIG: refreshed.nixConfig,
        VBR_NIX_CACHE_HEALTH_APPLIED: refreshed.applied,
        VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG: refreshed.reviewed,
      },
      async () => {
        const result = await applyNixCacheHealthPolicy("/tmp/repo", {
          readEffectiveConfig: async () => {
            throw new Error("downstream TypeScript must reuse exact stage0 authority");
          },
        });
        assert.equal(result.authority, "reviewed");
        assert.equal(result.nixConfig, full);
      },
    );

    const reused = await runStage0({
      applied: "1",
      reviewed: full,
      required: "",
      optional: "",
      reviewedPolicy: "auto",
      sourceConfig: "builders =",
      status: "42",
    });
    assert.equal(reused.status, 0);
    assert.equal(reused.reviewed, full);
    assert.equal(reused.reviewedPolicy, "auto");
    assert.equal(reused.sourceConfig, "builders =");
    assert.equal(
      reused.nixArgs,
      "--option substituters  --option extra-substituters  --option connect-timeout 3 --option stalled-download-timeout 10 --option fallback true",
    );
    assert.equal(reused.calls, 0);

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
    });
    assert.equal(systemOnly.required, "file:///system-cache");
    assert.match(systemOnly.nixArgs, /--option substituters file:\/\/\/system-cache/);

    const removed = await runStage0({
      effective: [
        "substituters = file:///system-cache",
        "extra-substituters = https://removed.example/cache file:///kept-optional",
      ].join("\n"),
    });
    assert.equal(removed.required, "file:///system-cache");
    assert.equal(removed.optional, "file:///kept-optional");
    assert.doesNotMatch(removed.nixArgs, /removed\.example/);
    const removedReused = await runStage0({
      applied: removed.applied,
      reviewed: removed.reviewed,
      required: removed.required,
      optional: removed.optional,
      reviewedPolicy: removed.reviewedPolicy,
      sourceConfig: removed.sourceConfig,
      status: "42",
    });
    assert.equal(removedReused.status, 0);
    assert.equal(removedReused.calls, 0);
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
    });
    assert.equal(strictToAuto.status, 0);
    assert.equal(strictToAuto.required, "file:///strict-cache");
    assert.equal(strictToAuto.reviewedPolicy, "auto");
    assert.equal(strictToAuto.calls, 1);

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
  assert.match(verifyBuckEnv, /maybeEnvArg\("VBR_NIX_CACHE_HEALTH_APPLIED"/);
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
