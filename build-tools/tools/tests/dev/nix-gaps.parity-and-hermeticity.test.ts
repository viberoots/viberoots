#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import {
  artifactSelectorNames,
  canonicalArtifactToolsRoot,
  isArtifactAffectingEnvName,
} from "../../lib/artifact-environment";
import { reconcileGeneratedGraph } from "../../patch/glue";
import { createHermeticParityFixture } from "./nix-gaps.parity-and-hermeticity.helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

type BuildCase = {
  target: string;
  attr?: string;
  validate: (outPath: string, $: any) => Promise<void>;
};

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function parseLastOutPath(stdout: unknown): string {
  return (
    String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop()
      ?.trim() || ""
  );
}

async function firstFileInDir(dir: string): Promise<string> {
  const names = (await fs.readdir(dir)).slice().sort();
  assert.ok(names.length > 0, `expected at least one file in ${dir}`);
  return path.join(dir, names[0]);
}

async function createHostileToolDir(dir: string, sentinel: string): Promise<void> {
  await fs.ensureDir(dir);
  for (const tool of [
    "c++",
    "cargo",
    "cc",
    "clang",
    "date",
    "gcc",
    "git",
    "go",
    "nix",
    "node",
    "pnpm",
    "python3",
    "rustc",
    "uname",
    "uv",
  ]) {
    const executable = path.join(dir, tool);
    await fs.writeFile(
      executable,
      `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(tool)} >> ${JSON.stringify(sentinel)}\nexit 97\n`,
    );
    await fs.chmod(executable, 0o755);
  }
}

async function selectedBuildOutPath(
  tmp: string,
  $: any,
  target: string,
  env: Record<string, string>,
  attr = "graph-generator-selected",
): Promise<string> {
  await reconcileGeneratedGraph({ workspaceRoot: tmp, target });
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    env,
  })`${path.join(canonicalArtifactToolsRoot(process.cwd()), "bin", "node")} --experimental-strip-types --import ${viberootsSourcePath("build-tools/tools/dev/zx-init.mjs")} ${viberootsSourcePath("build-tools/tools/dev/build-selected.ts")} --source=git --target ${target} --attr ${attr}`;
  if (res.exitCode !== 0) {
    throw new Error(`${String(res.stderr || "")}\n${String(res.stdout || "")}`.trim());
  }
  const outPath = parseLastOutPath(res.stdout);
  assert.ok(outPath, `expected nix output path for ${target}`);
  assert.match(
    String(res.stderr || ""),
    /"classification":"hermetic"/,
    `${target} must pass release-class hermetic admission`,
  );
  return outPath;
}

test(
  "all supported artifact languages keep identical identities across hostile environments",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("nix-gaps-parity", async (tmp, $) => {
      await createHermeticParityFixture(tmp);
      await reconcileTempDependencyInputs(tmp, $);
      const hostileSentinel = path.join(tmp, "host-tool-used.log");
      const hostileToolsA = path.join(tmp, "host-tools-a");
      const hostileToolsB = path.join(tmp, "host-tools-b");
      await createHostileToolDir(hostileToolsA, hostileSentinel);
      await createHostileToolDir(hostileToolsB, hostileSentinel);

      const minimalEnv: Record<string, string> = {
        ...(process.env as Record<string, string>),
        HOME: path.join(tmp, "hostile-home-a"),
        USER: String(process.env.USER || ""),
        PATH: [hostileToolsA, String(process.env.PATH || "")].join(path.delimiter),
        XDG_CONFIG_HOME: path.join(tmp, "hostile-config-a"),
        NIX_CONFIG: String(process.env.NIX_CONFIG || ""),
        NIX_SSL_CERT_FILE: String(process.env.NIX_SSL_CERT_FILE || ""),
        NIX_SSL_CERT_DIR: String(process.env.NIX_SSL_CERT_DIR || ""),
        SSL_CERT_FILE: String(process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE || ""),
        SSL_CERT_DIR: String(process.env.SSL_CERT_DIR || process.env.NIX_SSL_CERT_DIR || ""),
        TMPDIR: String(process.env.TMPDIR || "/tmp"),
        IN_NIX_SHELL: "1",
        TZ: "Pacific/Honolulu",
        LANG: "tr_TR.UTF-8",
        LC_ALL: "tr_TR.UTF-8",
        SOURCE_DATE_EPOCH: "999999999",
      };
      for (const selector of artifactSelectorNames()) delete minimalEnv[selector];
      for (const name of Object.keys(minimalEnv)) {
        if (isArtifactAffectingEnvName(name)) delete minimalEnv[name];
      }
      delete minimalEnv.VBR_CANONICAL_ARTIFACT_ENTRYPOINT;
      const alternateEnv: Record<string, string> = {
        ...minimalEnv,
        HOME: path.join(tmp, "hostile-home-b"),
        PATH: [hostileToolsB, String(process.env.PATH || "")].join(path.delimiter),
        XDG_CONFIG_HOME: path.join(tmp, "hostile-config-b"),
        TZ: "Europe/Berlin",
        LANG: "ja_JP.UTF-8",
        LC_ALL: "ja_JP.UTF-8",
        SOURCE_DATE_EPOCH: "123456789",
      };

      await assert.rejects(
        selectedBuildOutPath(tmp, $, "//:hermetic_parity_gen_bin__planner", {
          ...minimalEnv,
          CC: path.join(hostileToolsA, "cc"),
          CXX: path.join(hostileToolsA, "c++"),
          GOROOT: path.join(tmp, "host-go"),
          PYTHON: path.join(hostileToolsA, "python3"),
          RUSTC: path.join(hostileToolsA, "rustc"),
        }),
        /artifact build rejects ambient selectors/,
      );
      await assert.rejects(
        selectedBuildOutPath(tmp, $, "//:hermetic_parity_gen_bin__planner", {
          ...minimalEnv,
          NIX_REMOTE: "ssh://host-store",
        }),
        /rejects ambient NIX_REMOTE authority/,
      );
      await assert.rejects(
        selectedBuildOutPath(tmp, $, "//:hermetic_parity_gen_bin__planner", {
          ...minimalEnv,
          NIX_SSL_CERT_FILE: "/tmp/host-cert.pem",
        }),
        /rejects unavailable NIX_SSL_CERT_FILE/,
      );

      const expectedNodeHash = sha256Hex("node-parity\n");
      const cases: BuildCase[] = [
        {
          // The public target is the Buck materialization wrapper. Its planner companion
          // is the canonical Nix artifact target selected by that wrapper.
          target: "//:hermetic_parity_gen_bin__planner",
          validate: async (outPath) => {
            const outFile = path.join(outPath, "parity-node.sh");
            const txt = await fs.readFile(outFile, "utf8");
            assert.equal(sha256Hex(txt), expectedNodeHash);
          },
        },
        {
          target: "//projects/apps/parity-cpp:app",
          validate: async (outPath, _$) => {
            const bin = await firstFileInDir(path.join(outPath, "bin"));
            const run = await _$({ stdio: "pipe", env: minimalEnv })`${bin}`;
            assert.equal(String(run.stdout || "").trim(), "cpp-parity");
          },
        },
        {
          target: "//projects/apps/parity-rust:app",
          validate: async (outPath, _$) => {
            const appPath = path.join(outPath, "bin", "app");
            const bin = (await fs.pathExists(appPath))
              ? appPath
              : await firstFileInDir(path.join(outPath, "bin"));
            const run = await _$({ stdio: "pipe", env: minimalEnv })`${bin}`;
            assert.equal(String(run.stdout || "").trim(), "rust-binary:app");
          },
        },
        {
          target: "//projects/apps/parity-go:app",
          validate: async (outPath, _$) => {
            const bin = await firstFileInDir(path.join(outPath, "bin"));
            const run = await _$({ stdio: "pipe", env: minimalEnv })`${bin}`;
            assert.equal(String(run.stdout || "").trim(), "go-parity");
          },
        },
        {
          target: "//projects/apps/parity-python:app",
          validate: async (outPath) => {
            assert.ok(await fs.pathExists(path.join(outPath, "bin")));
          },
        },
        {
          target: "//projects/libs/parity-wasm-go:module",
          attr: "graph-generator-selected-wasm",
          validate: async (outPath) => {
            assert.ok(await fs.pathExists(path.join(outPath, "lib", "top.wasm")));
          },
        },
      ];

      await $({ cwd: tmp, stdio: "pipe" })`git add -A`;

      for (const c of cases) {
        const first = await selectedBuildOutPath(tmp, $, c.target, minimalEnv, c.attr);
        const second = await selectedBuildOutPath(tmp, $, c.target, alternateEnv, c.attr);
        assert.equal(second, first, `${c.target} identity changed under hostile environment`);
        console.error(
          `[hermetic-matrix] target=${c.target} first=${first} second=${second} equal=true`,
        );
        await c.validate(first, $);
      }
      assert.equal(
        await fs.pathExists(hostileSentinel),
        false,
        "artifact build executed a host tool",
      );
    });
  },
);
