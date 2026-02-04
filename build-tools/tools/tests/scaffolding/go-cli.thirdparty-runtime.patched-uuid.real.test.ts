#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function writeFileAbs(p: string, content: string) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, "utf8");
}

async function writeBuckConfig(sh: any) {
  await sh`bash --noprofile --norc -c ${`set -euo pipefail
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

async function scaffoldLibrary(sh: any, tmp: string) {
  await sh`scaf new go lib demo-lib --yes --path=libs/demo-lib`;
  await writeFileAbs(
    path.join(tmp, "libs", "demo-lib", "pkg", "demo-lib", "demo-lib.go"),
    [
      "package demolib",
      "",
      "import (",
      '  "fmt"',
      '  "github.com/google/uuid"',
      ")",
      "",
      "func Greeting(name string) string {",
      '  return fmt.Sprintf("Hello, %s %s", name, uuid.NewString())',
      "}",
      "",
    ].join("\n"),
  );
}

async function scaffoldCli(sh: any, tmp: string) {
  await sh`scaf new go cli demo-cli --yes --path=apps/demo-cli`;
  const cliTargetsPath = path.join(tmp, "apps", "demo-cli", "TARGETS");
  let cliTargets = await fsp.readFile(cliTargetsPath, "utf8");
  if (!/deps\s*=\s*\[\s*"\/\/libs\/demo-lib:demo-lib"\s*\]/.test(cliTargets)) {
    cliTargets = cliTargets.replace(/nix_go_binary\(([^)]*)\)/ms, (m: string, body: string) => {
      const withDeps = body.includes("deps = ")
        ? body.replace(
            /deps\s*=\s*\[([^\]]*)\]/m,
            (mm: string, inner: string) => `deps = [${inner}, "//libs/demo-lib:demo-lib"]`,
          )
        : body.replace(
            /labels\s*=\s*\[[^\]]*\],?/m,
            (lm: string) => `${lm}\n    deps = ["//libs/demo-lib:demo-lib"],`,
          );
      return `nix_go_binary(${withDeps})`;
    });
    await fsp.writeFile(cliTargetsPath, cliTargets, "utf8");
  }
}

async function regenerateProviders(sh: any) {
  await sh`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
  await sh`node build-tools/tools/buck/sync-providers.ts`;
  await sh`node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
}

test("go cli with local lib + third-party patched uuid runtime (prefetched real snapshot)", async () => {
  await runInTemp("cli-thirdparty-runtime-patched-uuid-real", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`git init`;
    await writeBuckConfig($);

    await scaffoldLibrary($, _tmp);
    await scaffoldCli($, _tmp);

    // Use a prefetched, fixed snapshot of the module under test (fixture in repo)
    const origin = path.join(
      process.cwd(),
      "build-tools",
      "tools",
      "tests",
      "fixtures",
      "go",
      "github.com",
      "google",
      "uuid@v1.6.0",
    );
    const resolveMap = JSON.stringify({
      "github.com/google/uuid": { version: "v1.6.0", originPath: origin },
    });

    // Start session and patch workspace
    const startRes = await $({
      cwd: _tmp,
      stdio: "pipe",
      env: {
        NIX_GO_TEST_RESOLVE_JSON: resolveMap,
        NO_DEV_SHELL: "1",
        NODE_BIN: process.execPath,
        ZX_INIT: path.join(_tmp, "build-tools", "tools", "dev", "zx-init.mjs"),
        WORKSPACE_ROOT: _tmp,
        NODE_PATH: [path.join(process.cwd(), "node_modules"), process.env.NODE_PATH || ""]
          .filter(Boolean)
          .join(path.delimiter),
        PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ""}`,
      },
    })`build-tools/tools/bin/patch-pkg start go github.com/google/uuid`;
    const ws =
      String(startRes.stdout || startRes.stderr || "")
        .split(/\r?\n/)
        .find((l: string) => l.trim().startsWith("/"))
        ?.trim() || "";
    if (!ws) throw new Error("patch-pkg did not return a workspace path");

    // Patch workspace to zero UUID
    const uuidGo = path.join(ws, "uuid.go");
    const txt = await fsp.readFile(uuidGo, "utf8");
    const patched = txt
      .replace(
        /func\s+NewString\s*\(\s*\)\s*string\s*\{[\s\S]*?\}/m,
        'func NewString() string {\n\treturn "00000000-0000-0000-0000-000000000000"\n}',
      )
      .replace(
        /func\s*\(\s*\w+\s+UUID\s*\)\s*String\s*\(\s*\)\s*string\s*\{[\s\S]*?\}/m,
        'func (u UUID) String() string {\n\treturn "00000000-0000-0000-0000-000000000000"\n}',
      );
    await fsp.writeFile(uuidGo, patched, "utf8");

    await $({
      cwd: _tmp,
      stdio: "inherit",
      env: {
        NIX_GO_TEST_RESOLVE_JSON: resolveMap,
        NO_DEV_SHELL: "1",
        NODE_BIN: process.execPath,
        ZX_INIT: path.join(_tmp, "build-tools", "tools", "dev", "zx-init.mjs"),
        WORKSPACE_ROOT: _tmp,
        NODE_PATH: [path.join(process.cwd(), "node_modules"), process.env.NODE_PATH || ""]
          .filter(Boolean)
          .join(path.delimiter),
        PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ""}`,
      },
    })`build-tools/tools/bin/patch-pkg apply go github.com/google/uuid --target //apps/demo-cli:demo-cli --force`;

    const patchFile = path.join(
      _tmp,
      "apps",
      "demo-cli",
      "patches",
      "go",
      "github.com__google__uuid@v1.6.0.patch",
    );
    const ok = await fsp
      .stat(patchFile)
      .then(() => true)
      .catch(() => false);
    if (!ok) throw new Error("expected uuid patch file not found");
    // No provider assertions (PR6)
  });
});
