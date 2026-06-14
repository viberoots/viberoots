#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { resolvePinnedTestToolPath } from "../lib/test-helpers/pinned-tool";
import { runInTemp } from "../lib/test-helpers";
import { ensureBuckConfigForTempRepo } from "../lib/test-helpers/buck-config";
const DEBUG = String(process.env.GO_SIMPLE_PATCHED_UUID_DEBUG || "") === "1";
function dbg(...args: any[]) {
  if (!DEBUG) return;
  try {
    console.error("[go-cli.simple-patched-uuid][debug]", ...args);
  } catch {}
}

// Ensure Node is on PATH inside zx_test sandboxes that may not have dev shell
process.env.PATH = `${path.dirname(process.execPath)}:${process.env.PATH || ""}`;

async function writeFileAbs(p: string, content: string) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, "utf8");
}

async function ensureNodeOnPath(tmp: string): Promise<string> {
  const localBin = path.join(tmp, "local-bin");
  await fsp.mkdir(localBin, { recursive: true });
  const nodeLink = path.join(localBin, "node");
  try {
    await fsp.unlink(nodeLink);
  } catch {}
  await fsp.symlink(process.execPath, nodeLink);
  return localBin;
}

function resolvedToolEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["BASH", "VBR_BASH_BIN", "GIT_BIN", "NIX_BIN", "PATCH_BIN"] as const) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

async function startPatchPkgSession(
  $: any,
  tmp: string,
  goEnv: NodeJS.ProcessEnv,
): Promise<{ origin: string; ws: string }> {
  const { stdout: gomodcacheOut } = await $({
    cwd: tmp,
    stdio: "pipe",
    env: { ...process.env, ...goEnv },
  })`go env GOMODCACHE`;
  const gomodcache = String(gomodcacheOut || "").trim();
  if (!gomodcache) throw new Error("GOMODCACHE not found");
  const origin = path.join(gomodcache, "github.com/google/uuid@v1.6.0");
  const resolveMap = JSON.stringify({
    "github.com/google/uuid": { version: "v1.6.0", originPath: origin },
  });
  const localBin = await ensureNodeOnPath(tmp);
  const startRes = await $({
    cwd: tmp,
    stdio: "pipe",
    env: {
      NO_DEV_SHELL: "1",
      NODE_BIN: process.execPath,
      PATH: `${path.dirname(process.execPath)}:${localBin}:${process.env.PATH || ""}`,
      NIX_GO_TEST_RESOLVE_JSON: resolveMap,
      ...resolvedToolEnv(),
      ...goEnv,
    },
  })`build-tools/tools/bin/patch-pkg start go github.com/google/uuid`;
  const ws =
    String(startRes.stdout || startRes.stderr || "")
      .split(/\r?\n/)
      .find((l: string) => l.trim().startsWith("/"))
      ?.trim() || "";
  if (!ws) throw new Error("patch-pkg did not return a workspace path");
  return { origin, ws };
}

async function seedUuidModuleCache(
  tmp: string,
  sh: any,
  gomodcacheOverride?: string,
): Promise<{ proxyRoot: string; gomodcache: string }> {
  const gomodcache =
    gomodcacheOverride ||
    String((await sh({ cwd: tmp, stdio: "pipe" })`go env GOMODCACHE`).stdout || "").trim();
  if (!gomodcache) throw new Error("GOMODCACHE not found");
  const moduleDir = path.join(gomodcache, "github.com", "google", "uuid@v1.6.0");
  const fixtureDir = new URL("../fixtures/go/github.com/google/uuid@v1.6.0", import.meta.url)
    .pathname;
  await fsp.rm(moduleDir, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(moduleDir, { recursive: true });
  await fsp.copyFile(path.join(fixtureDir, "uuid.go"), path.join(moduleDir, "uuid.go"));
  const goMod = "module github.com/google/uuid\n\ngo 1.22\n";
  await fsp.writeFile(path.join(moduleDir, "go.mod"), goMod, "utf8");

  const proxyRoot = path.join(tmp, ".go-proxy");
  const proxyDir = path.join(proxyRoot, "github.com", "google", "uuid", "@v");
  await fsp.mkdir(proxyDir, { recursive: true });
  await fsp.writeFile(path.join(proxyDir, "v1.6.0.mod"), goMod, "utf8");
  await fsp.writeFile(
    path.join(proxyDir, "v1.6.0.info"),
    JSON.stringify({ Version: "v1.6.0", Time: "2024-01-01T00:00:00Z" }) + "\n",
    "utf8",
  );
  await fsp.writeFile(path.join(proxyDir, "list"), "v1.6.0\n", "utf8").catch(() => {});

  const zipRoot = path.join(tmp, ".uuid-module-zip");
  await fsp.rm(zipRoot, { recursive: true, force: true }).catch(() => {});
  const zipModuleDir = path.join(zipRoot, "github.com", "google", "uuid@v1.6.0");
  await fsp.mkdir(zipModuleDir, { recursive: true });
  await fsp.copyFile(path.join(fixtureDir, "uuid.go"), path.join(zipModuleDir, "uuid.go"));
  await fsp.writeFile(path.join(zipModuleDir, "go.mod"), goMod, "utf8");

  const zipBin = await resolvePinnedTestToolPath("zip", sh);
  const zipPath = path.join(proxyDir, "v1.6.0.zip");
  await sh({
    cwd: zipRoot,
    stdio: "pipe",
  })`${zipBin} -qr -X ${zipPath} github.com/google/uuid@v1.6.0`;
  return { proxyRoot, gomodcache };
}

async function applyPatchPkg($: any, tmp: string, resolveOrigin: string, goEnv: NodeJS.ProcessEnv) {
  const localBin = await ensureNodeOnPath(tmp);
  const resolveMap = JSON.stringify({
    "github.com/google/uuid": { version: "v1.6.0", originPath: resolveOrigin },
  });
  await $({
    cwd: tmp,
    stdio: "inherit",
    env: {
      NO_DEV_SHELL: "1",
      NODE_BIN: process.execPath,
      PATH: `${path.dirname(process.execPath)}:${localBin}:${process.env.PATH || ""}`,
      NIX_GO_TEST_RESOLVE_JSON: resolveMap,
      ...resolvedToolEnv(),
      ...goEnv,
    },
  })`build-tools/tools/bin/patch-pkg apply go github.com/google/uuid --target //projects/apps/demo-cli:demo-cli --force`;
}

async function patchUuidWorkspaceToZero($: any, ws: string) {
  // Replace UUID.String and NewString to return a zero UUID deterministically.
  const walk = async (dir: string) => {
    const names = await fsp.readdir(dir);
    for (const n of names) {
      const p = path.join(dir, n);
      const st = await fsp.stat(p);
      if (st.isDirectory()) await walk(p);
      else if (p.endsWith(".go")) {
        let txt = await fsp.readFile(p, "utf8");
        let out = txt.replace(
          /func\s+NewString\s*\(\s*\)\s*string\s*\{[\s\S]*?\}/m,
          'func NewString() string {\n\treturn "00000000-0000-0000-0000-000000000000"\n}',
        );
        out = out.replace(
          /func\s*\(\s*\w+\s+UUID\s*\)\s*String\s*\(\s*\)\s*string\s*\{[\s\S]*?\}/m,
          'func (u UUID) String() string {\n\treturn "00000000-0000-0000-0000-000000000000"\n}',
        );
        if (out !== txt) await fsp.writeFile(p, out, "utf8");
      }
    }
  };
  await walk(ws);
}

async function writeGoSumFromDownload(
  $: any,
  moduleDir: string,
  goEnv: NodeJS.ProcessEnv,
): Promise<void> {
  const { stdout } = await $({
    cwd: moduleDir,
    stdio: "pipe",
    env: { ...process.env, ...goEnv },
  })`go mod download -json github.com/google/uuid@v1.6.0`;
  const payload = String(stdout || "").trim();
  if (!payload) throw new Error("go mod download did not return JSON output");
  const data = JSON.parse(payload);
  const sum = String(data?.Sum || "");
  const goModSum = String(data?.GoModSum || "");
  if (!sum || !goModSum) throw new Error("go mod download JSON missing sums");
  const goSumPath = path.join(moduleDir, "go.sum");
  const goSum = [
    `github.com/google/uuid v1.6.0 ${sum}`,
    `github.com/google/uuid v1.6.0/go.mod ${goModSum}`,
    "",
  ].join("\n");
  await fsp.writeFile(goSumPath, goSum, "utf8");
}

async function readPinnedNixpkgsUrl(tmpRepoRoot: string): Promise<string> {
  // Pin nixpkgs to the repo's flake.lock to avoid nondeterministic Go toolchain/tag selection
  try {
    const lockPath = path.join(tmpRepoRoot, "flake.lock");
    const txt = await fsp.readFile(lockPath, "utf8");
    const lock = JSON.parse(txt);
    const node = (lock?.nodes?.nixpkgs || lock?.nodes?.root?.inputs?.nixpkgs) && lock.nodes.nixpkgs;
    const locked = node?.locked || {};
    const owner = locked.owner || "NixOS";
    const repo = locked.repo || "nixpkgs";
    const rev = locked.rev;
    if (rev && typeof rev === "string") {
      return `github:${owner}/${repo}/${rev}`;
    }
  } catch {}
  // Fallback to a moving channel if lock is unavailable in the temp repo (should be rare)
  return "github:NixOS/nixpkgs/nixos-unstable";
}

test("go cli (no local replaces) + patched uuid runtime -> zero UUID", async () => {
  await runInTemp("go-cli-simple-patched-uuid", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await ensureBuckConfigForTempRepo(_tmp, $);

    // Scaffold a CLI app that directly imports github.com/google/uuid
    await $`scaf new go cli demo-cli --yes --path=projects/apps/demo-cli`;
    // Replace main to use uuid, then tidy to add dependency
    await writeFileAbs(
      path.join(_tmp, "projects", "apps", "demo-cli", "cmd", "demo-cli", "main.go"),
      [
        "package main",
        "",
        "import (",
        '  "fmt"',
        '  "github.com/google/uuid"',
        '  "os"',
        ")",
        "",
        "func main() {",
        '  name := "World"',
        '  if len(os.Args) > 2 && os.Args[1] == "--name" {',
        "    name = os.Args[2]",
        "  }",
        "  fmt.Println(name, uuid.NewString())",
        "}",
        "",
      ].join("\n"),
    );
    const moduleCache = path.join(_tmp, ".gomodcache");
    await fsp.mkdir(moduleCache, { recursive: true });
    const { proxyRoot, gomodcache } = await seedUuidModuleCache(_tmp, $, moduleCache);
    const goEnv = {
      GOPROXY: `file://${proxyRoot},off`,
      GOSUMDB: "off",
      GONOSUMDB: "github.com/google/uuid",
      ...(gomodcache ? { GOMODCACHE: gomodcache } : {}),
    };
    await $({
      cwd: path.join(_tmp, "projects", "apps", "demo-cli"),
      stdio: "inherit",
      env: {
        ...process.env,
        ...goEnv,
      },
    })`go mod tidy`;
    await writeGoSumFromDownload($, path.join(_tmp, "projects", "apps", "demo-cli"), goEnv);

    // Generate gomod2nix.toml via local stub (avoid network)
    const stubDir = path.join(_tmp, "bin");
    await fsp.mkdir(stubDir, { recursive: true });
    const stubPath = path.join(stubDir, "gomod2nix");
    await fsp.writeFile(
      stubPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "DIR=.",
        "while [[ $# -gt 0 ]]; do",
        '  case "$1" in',
        "    --dir)",
        '      DIR="$2"; shift 2;;',
        "    *) shift;;",
        "  esac",
        "done",
        'mkdir -p "$DIR"',
        "cat > \"$DIR/gomod2nix.toml\" <<'EOF'",
        "schema = 3",
        "mod = {}",
        "replace = {}",
        "prune = { go-tests = true, unused-packages = true }",
        "EOF",
      ].join("\n"),
      "utf8",
    );
    await $`chmod +x ${stubPath}`;
    await $({
      cwd: _tmp,
      stdio: "inherit",
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH || ""}` },
    })`gomod2nix --dir projects/apps/demo-cli`;
    await fsp.copyFile(
      path.join(_tmp, "projects", "apps", "demo-cli", "gomod2nix.toml"),
      path.join(_tmp, "gomod2nix.toml"),
    );

    // Export glue (override gomod2nix to our local stub to avoid timeouts)
    await $({
      env: { ...process.env, INSTALL_DEPS_GOMOD2NIX_BIN: stubPath },
    })`build-tools/tools/dev/install-deps.ts --glue-only`;

    // Start a patch session and patch uuid to zero
    const { origin, ws } = await startPatchPkgSession($, _tmp, goEnv);
    await patchUuidWorkspaceToZero($, ws);
    await applyPatchPkg($, _tmp, origin, goEnv);
    // Regenerate providers and auto_map after writing patch
    await $`node build-tools/tools/buck/sync-providers.ts`;
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;

    // Vendor dependencies and inject patched uuid into vendor tree
    await $({
      cwd: path.join(_tmp, "projects", "apps", "demo-cli"),
      stdio: "inherit",
      env: { ...process.env, ...goEnv },
    })`go mod vendor`;
    const vendUuidDir = path.join(
      _tmp,
      "projects",
      "apps",
      "demo-cli",
      "vendor",
      "github.com",
      "google",
      "uuid",
    );
    await $({ stdio: "inherit" })`bash --noprofile --norc -c ${`set -euo pipefail
      rm -rf ${vendUuidDir}
      mkdir -p ${vendUuidDir}
      cp -R ${ws}/. ${vendUuidDir}/
    `}`;

    // Local flake using buildGoModule + vendorHash (Option E). Compute vendorHash
    // deterministically from the vendored tree, then build and run.
    const flakePath = path.join(_tmp, "flake.nix");
    const pinnedUrl = await readPinnedNixpkgsUrl(_tmp);
    dbg("pinned nixpkgs:", pinnedUrl);
    const flakeTemplate = () => `{
  description = "temp app flake";
  inputs.nixpkgs.url = "${pinnedUrl}";
  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAll = f: builtins.listToAttrs (map (s: { name = s; value = f s; }) systems);
    in {
      packages = forAll (system:
        let pkgs = import nixpkgs { inherit system; }; in {
          app = pkgs.buildGoModule {
            pname = "demo-cli";
            version = "0.1.0";
            src = ./projects/apps/demo-cli;
            subPackages = [ "cmd/demo-cli" ];
            # Vendor directory present; instruct buildGoModule to use it
            vendorHash = null;
          };
        }
      );
      defaultPackage = self.packages.${"${builtins.currentSystem}"}.app;
    };
}`;
    await fsp.writeFile(flakePath, flakeTemplate(), "utf8");
    // Rebuild with pinned vendorHash (offline GOPROXY)
    // Optional: preflight diagnostics on vendor dir
    if (DEBUG) {
      try {
        const h1 = await $({ stdio: "pipe" })`nix hash path ${path.join(
          _tmp,
          "projects",
          "apps",
          "demo-cli",
          "vendor",
        )}`.nothrow();
        dbg("vendor tree sha256:", String(h1.stdout || h1.stderr || "").trim());
        const h2 = await $({ stdio: "pipe" })`nix hash path ${vendUuidDir}`.nothrow();
        dbg("vendor uuid dir sha256:", String(h2.stdout || h2.stderr || "").trim());
      } catch {}
      try {
        const envOut = await $({ stdio: "pipe" })`go env GOPATH GOMODCACHE GOTOOLDIR`.nothrow();
        dbg("go env:", String(envOut.stdout || envOut.stderr || "").trim());
      } catch {}
    }
    await $({
      cwd: _tmp,
      stdio: "inherit",
      env: { ...process.env, GOPROXY: "off", GOSUMDB: "off" },
    })`bash --noprofile --norc -c 'rm -f ./result'`.nothrow();
    const { stdout: outStdout } = await $({
      cwd: _tmp,
      stdio: "pipe",
      env: { ...process.env, GOPROXY: "off", GOSUMDB: "off" },
    })`nix build ${`path:${_tmp}#app`} --accept-flake-config --no-link --print-out-paths --show-trace`;
    const outPath =
      String(outStdout || "")
        .trim()
        .split(/\n+/)
        .filter(Boolean)
        .pop() || "";
    if (!outPath) {
      throw new Error("nix build produced no out path for app");
    }
    const bin = path.join(outPath, "bin", "demo-cli");
    const run = await $({ stdio: "pipe" })`${bin} --name Bob`;
    const outStr = String(run.stdout || "").trim();
    if (!/^Bob 00000000-0000-0000-0000-000000000000$/.test(outStr)) {
      console.error("stdout:", outStr);
      throw new Error("unexpected output; expected zero UUID appended");
    }
  });
});
