#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

type BuildCase = {
  target: string;
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

async function selectedBuildOutPath(
  tmp: string,
  $: any,
  target: string,
  nixBin: string,
  env: Record<string, string>,
): Promise<string> {
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    env: {
      ...env,
      BUCK_TARGET: target,
      BUCK_TEST_SRC: tmp,
      BUCK_GRAPH_JSON: path.join(tmp, ".viberoots", "workspace", "buck", "graph.json"),
    },
  })`${nixBin} build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
  const outPath = parseLastOutPath(res.stdout);
  assert.ok(outPath, `expected nix output path for ${target}`);
  return outPath;
}

test(
  "node/cpp/rust parity signals hold in a minimal environment",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("nix-gaps-parity", async (tmp, $) => {
      const nodeImporter = "projects/apps/parity-node";
      const nodeLock = `${nodeImporter}/pnpm-lock.yaml`;
      const nodeLabel = `lockfile:${nodeLock}#${nodeImporter}`;

      await fs.outputFile(path.join(tmp, nodeLock), "lockfileVersion: '9.0'\n", "utf8");
      await fs.outputFile(
        path.join(tmp, nodeImporter, "src", "input.txt"),
        "node-parity\n",
        "utf8",
      );

      await fs.outputFile(
        path.join(tmp, "projects", "apps", "parity-cpp", "src", "main.cpp"),
        '#include <iostream>\nint main(){ std::cout<<"cpp-parity\\n"; return 0; }\n',
        "utf8",
      );

      await fs.outputFile(
        path.join(tmp, "projects", "apps", "parity-rust", "src", "main.rs"),
        "fn main() {}\n",
        "utf8",
      );

      await fs.outputFile(
        path.join(tmp, ".viberoots", "workspace", "buck", "graph.json"),
        JSON.stringify(
          [
            {
              name: "//projects/apps/parity-node:gen_bin",
              rule_type: "genrule",
              labels: ["lang:node", "kind:bin", nodeLabel],
              srcs: [`${nodeImporter}/src/input.txt`],
              out: "parity-node.sh",
              cmd: 'cat src/input.txt > "$OUT"',
            },
            {
              name: "//projects/apps/parity-cpp:app",
              rule_type: "cxx_binary",
              labels: ["lang:cpp", "kind:bin"],
              srcs: ["projects/apps/parity-cpp/src/main.cpp"],
            },
            {
              name: "//projects/apps/parity-rust:app",
              rule_type: "rust_binary",
              labels: ["lang:rust", "kind:bin"],
              srcs: ["projects/apps/parity-rust/src/main.rs"],
            },
          ],
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const nixBin = String((await $({ cwd: tmp, stdio: "pipe" })`which nix`).stdout || "").trim();
      assert.ok(nixBin, "expected nix on PATH");

      const minimalEnv: Record<string, string> = {
        HOME: String(process.env.HOME || ""),
        USER: String(process.env.USER || ""),
        PATH: [path.dirname(nixBin), "/usr/bin", "/bin"].join(path.delimiter),
        XDG_CONFIG_HOME: String(
          process.env.XDG_CONFIG_HOME || path.join(String(process.env.HOME || ""), ".config"),
        ),
        NIX_CONFIG: String(process.env.NIX_CONFIG || ""),
        NIX_SSL_CERT_FILE: String(process.env.NIX_SSL_CERT_FILE || ""),
        NIX_SSL_CERT_DIR: String(process.env.NIX_SSL_CERT_DIR || ""),
        SSL_CERT_FILE: String(process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE || ""),
        SSL_CERT_DIR: String(process.env.SSL_CERT_DIR || process.env.NIX_SSL_CERT_DIR || ""),
        TMPDIR: String(process.env.TMPDIR || "/tmp"),
        IN_NIX_SHELL: "1",
        CC: "/usr/bin/false",
        CXX: "/usr/bin/false",
        GCC: "/usr/bin/false",
        CLANG: "/usr/bin/false",
        RUSTC: "/usr/bin/false",
        NODE: "/usr/bin/false",
      };

      const expectedNodeHash = sha256Hex("node-parity\n");
      const cases: BuildCase[] = [
        {
          target: "//projects/apps/parity-node:gen_bin",
          validate: async (outPath) => {
            const outFile = path.join(outPath, "bin", "parity-node.sh");
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
      ];

      for (const c of cases) {
        const outPath = await selectedBuildOutPath(tmp, $, c.target, nixBin, minimalEnv);
        await c.validate(outPath, $);
      }
    });
  },
);
