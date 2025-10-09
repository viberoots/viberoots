#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// Ensure Node is on PATH inside zx_test sandboxes that may not have dev shell
process.env.PATH = `${path.dirname(process.execPath)}:${process.env.PATH || ""}`;

async function writeFileAbs(p: string, content: string) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, "utf8");
}

async function writeBuckConfig($: any) {
  await $`bash -lc ${`set -euo pipefail
    printf '.\n' > .buckroot
    cat > .buckconfig <<'EOF'
[buildfile]
name = TARGETS

[repositories]
root = .
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[cells]
root = .
prelude = ./prelude
toolchains = ./toolchains
repo_toolchains = ./toolchains
fbsource = ./prelude/third-party/fbsource_stub
fbcode = ./prelude/third-party/fbcode_stub
config = ./prelude

[build]
prelude = prelude
user_platform = prelude//platforms:default
target_platforms = prelude//platforms:default
EOF
    mkdir -p toolchains
    printf '[buildfile]\nname = TARGETS\n' > toolchains/.buckconfig
  `}`;
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

async function startPatchPkgSession($: any, tmp: string): Promise<{ origin: string; ws: string }> {
  const { stdout: gomodcacheOut } = await $({ cwd: tmp, stdio: "pipe" })`go env GOMODCACHE`;
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
    },
  })`tools/bin/patch-pkg start go github.com/google/uuid`;
  const ws =
    String(startRes.stdout || startRes.stderr || "")
      .split(/\r?\n/)
      .find((l: string) => l.trim().startsWith("/"))
      ?.trim() || "";
  if (!ws) throw new Error("patch-pkg did not return a workspace path");
  return { origin, ws };
}

async function applyPatchPkg($: any, tmp: string, resolveOrigin: string) {
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
    },
  })`tools/bin/patch-pkg apply go github.com/google/uuid --force`;
}

async function patchUuidWorkspaceToZero($: any, ws: string) {
  // Replace uuid.NewString and UUID.String to return zero
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

test("go cli (no local replaces) + patched uuid runtime -> zero UUID", async () => {
  await runInTemp("go-cli-simple-patched-uuid", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await writeBuckConfig($);

    // Scaffold a CLI app that directly imports github.com/google/uuid
    await $`scaf new go cli demo-cli --yes --path=apps/demo-cli`;
    // Replace main to use uuid, then tidy to add dependency
    await writeFileAbs(
      path.join(_tmp, "apps", "demo-cli", "cmd", "demo-cli", "main.go"),
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
    await $({ cwd: path.join(_tmp, "apps", "demo-cli"), stdio: "inherit" })`go mod tidy`;

    // Generate gomod2nix for the app and copy to repo root
    await $({ cwd: _tmp, stdio: "inherit" })`tools/bin/gomod2nix --dir apps/demo-cli`;
    await fsp.copyFile(
      path.join(_tmp, "apps", "demo-cli", "gomod2nix.toml"),
      path.join(_tmp, "gomod2nix.toml"),
    );

    // Export glue
    await $`tools/dev/install-deps.ts --glue-only`;

    // Start a patch session and patch uuid to zero
    const { origin, ws } = await startPatchPkgSession($, _tmp);
    await patchUuidWorkspaceToZero($, ws);
    await applyPatchPkg($, _tmp, origin);
    // Regenerate providers and auto_map after writing patch
    await $`node tools/buck/sync-providers.ts`;
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;

    // Vendor dependencies and inject patched uuid into vendor tree
    await $({ cwd: path.join(_tmp, "apps", "demo-cli"), stdio: "inherit" })`go mod vendor`;
    const vendUuidDir = path.join(
      _tmp,
      "apps",
      "demo-cli",
      "vendor",
      "github.com",
      "google",
      "uuid",
    );
    await $({ stdio: "inherit" })`bash -lc ${`set -euo pipefail
      rm -rf ${vendUuidDir}
      mkdir -p ${vendUuidDir}
      cp -R ${ws}/. ${vendUuidDir}/
    `}`;

    // Local flake using buildGoModule + vendorHash (Option E). First run with fake hash,
    // parse the suggested hash, rewrite, then build and run.
    const flakePath = path.join(_tmp, "flake.nix");
    const flakeTemplate = () => `{
  description = "temp app flake";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
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
            src = ./apps/demo-cli;
            subPackages = [ "cmd/demo-cli" ];
            vendorHash = null;
          };
        }
      );
      defaultPackage = self.packages.${"${builtins.currentSystem}"}.app;
    };
}`;
    await fsp.writeFile(flakePath, flakeTemplate(), "utf8");
    await $({ cwd: _tmp, stdio: "inherit" })`nix build .#app --accept-flake-config`;
    const bin = path.join(_tmp, "result", "bin", "demo-cli");
    const run = await $({ stdio: "pipe" })`${bin} --name Bob`;
    const outStr = String(run.stdout || "").trim();
    if (!/^Bob 00000000-0000-0000-0000-000000000000$/.test(outStr)) {
      console.error("stdout:", outStr);
      throw new Error("unexpected output; expected zero UUID appended");
    }
  });
});
