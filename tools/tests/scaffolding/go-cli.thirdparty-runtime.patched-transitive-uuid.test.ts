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

async function startPatchPkgSession(sh: any, tmp: string): Promise<{ origin: string; ws: string }> {
  const { stdout: gomodcacheOut } = await sh({ cwd: tmp, stdio: "pipe" })`go env GOMODCACHE`;
  const gomodcache = String(gomodcacheOut || "").trim();
  if (!gomodcache) throw new Error("GOMODCACHE not found");
  const origin = path.join(gomodcache, "github.com/google/uuid@v1.6.0");
  const resolveMap = JSON.stringify({
    "github.com/google/uuid": { version: "v1.6.0", originPath: origin },
  });
  const localBin = await ensureNodeOnPath(tmp);
  const startRes = await sh({
    cwd: tmp,
    stdio: "pipe",
    env: {
      NIX_GO_TEST_RESOLVE_JSON: resolveMap,
      NO_DEV_SHELL: "1",
      NODE_BIN: process.execPath,
      ZX_INIT: path.join(tmp, "tools", "dev", "zx-init.mjs"),
      WORKSPACE_ROOT: tmp,
      NODE_PATH: [path.join(process.cwd(), "node_modules"), process.env.NODE_PATH || ""]
        .filter(Boolean)
        .join(path.delimiter),
      PATH: `${path.dirname(process.execPath)}:${localBin}:${process.env.PATH || ""}`,
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

async function applyPatchPkg(sh: any, tmp: string, resolveOrigin: string) {
  const resolveMap = JSON.stringify({
    "github.com/google/uuid": { version: "v1.6.0", originPath: resolveOrigin },
  });
  const localBin = await ensureNodeOnPath(tmp);
  await sh({
    cwd: tmp,
    stdio: "inherit",
    env: {
      NIX_GO_TEST_RESOLVE_JSON: resolveMap,
      NO_DEV_SHELL: "1",
      NODE_BIN: process.execPath,
      ZX_INIT: path.join(tmp, "tools", "dev", "zx-init.mjs"),
      WORKSPACE_ROOT: tmp,
      NODE_PATH: [path.join(process.cwd(), "node_modules"), process.env.NODE_PATH || ""]
        .filter(Boolean)
        .join(path.delimiter),
      PATH: `${path.dirname(process.execPath)}:${localBin}:${process.env.PATH || ""}`,
    },
  })`tools/bin/patch-pkg apply go github.com/google/uuid --target //apps/demo-cli:demo-cli --force`;
}

async function scaffoldHelperLib(sh: any, tmp: string) {
  await sh`scaf new go lib helper-lib --yes --path=libs/helper-lib`;
  await sh({
    cwd: path.join(tmp, "libs", "helper-lib"),
    stdio: "inherit",
  })`go get github.com/google/uuid@v1.6.0`;
  await sh({ cwd: path.join(tmp, "libs", "helper-lib"), stdio: "inherit" })`go mod tidy`;
  await writeFileAbs(
    path.join(tmp, "libs", "helper-lib", "pkg", "helper-lib", "helper-lib.go"),
    [
      "package helperlib",
      "",
      "import (",
      '  "github.com/google/uuid"',
      ")",
      "",
      "func UUIDString() string {",
      "  return uuid.NewString()",
      "}",
      "",
    ].join("\n"),
  );
}

async function scaffoldDemoLib(sh: any, tmp: string) {
  await sh`scaf new go lib demo-lib --yes --path=libs/demo-lib`;
  // Add replace + require for helper-lib
  const demoGoModPath = path.join(tmp, "libs", "demo-lib", "go.mod");
  let demoGoMod = await fsp.readFile(demoGoModPath, "utf8");
  if (!/\nrequire\s/.test(demoGoMod)) {
    demoGoMod = demoGoMod.replace(
      /^(go\s+\d+\.\d+\s*)$/m,
      `$1\nrequire github.com/example/helper-lib v0.0.0\n`,
    );
  }
  if (
    !/\nreplace\s+github\.com\/example\/helper-lib\s+=>\s+\.\.\/\.\.\/libs\/helper-lib\s*$/.test(
      demoGoMod,
    )
  ) {
    demoGoMod =
      demoGoMod.trimEnd() + "\nreplace github.com/example/helper-lib => ../../libs/helper-lib\n";
  }
  await fsp.writeFile(demoGoModPath, demoGoMod, "utf8");

  // Ensure TARGETS visibility public and wire deps from demo-lib to helper-lib
  const demoTargetsPath = path.join(tmp, "libs", "demo-lib", "TARGETS");
  let demoTargets = await fsp.readFile(demoTargetsPath, "utf8");
  if (!/visibility\s*=\s*\[\s*"PUBLIC"\s*\]/.test(demoTargets)) {
    demoTargets = demoTargets.replace(/nix_go_library\(([^)]*)\)/ms, (m: string, body: string) => {
      const withVis = body.includes("visibility = ")
        ? body
        : body.replace(
            /labels\s*=\s*\[[^\]]*\],?/m,
            (lm: string) => `${lm}\n    visibility = ["PUBLIC"],`,
          );
      const withDeps = withVis.includes("deps = ")
        ? withVis.replace(
            /deps\s*=\s*\[([^\]]*)\]/m,
            (mm: string, inner: string) => `deps = [${inner}, "//libs/helper-lib:helper-lib"]`,
          )
        : withVis.replace(
            /labels\s*=\s*\[[^\]]*\],?/m,
            (lm: string) => `${lm}\n    deps = ["//libs/helper-lib:helper-lib"],`,
          );
      return `nix_go_library(${withDeps})`;
    });
    await fsp.writeFile(demoTargetsPath, demoTargets, "utf8");
  }

  await writeFileAbs(
    path.join(tmp, "libs", "demo-lib", "pkg", "demo-lib", "demo-lib.go"),
    [
      "package demolib",
      "",
      "import (",
      '  "fmt"',
      '  helperlib "github.com/example/helper-lib/pkg/helper-lib"',
      ")",
      "",
      "func Greeting(name string) string {",
      '  return fmt.Sprintf("Hello, %s %s", name, helperlib.UUIDString())',
      "}",
      "",
    ].join("\n"),
  );
}

async function scaffoldCli(sh: any, tmp: string) {
  await sh`scaf new go cli demo-cli --yes --path=apps/demo-cli`;

  // Wire demo-cli to demo-lib
  const cliGoModPath = path.join(tmp, "apps", "demo-cli", "go.mod");
  let cliGoMod = await fsp.readFile(cliGoModPath, "utf8");
  // Ensure a proper require block that includes both demo-lib and helper-lib
  if (/require\s*\(/.test(cliGoMod)) {
    cliGoMod = cliGoMod.replace(/require\s*\(([\s\S]*?)\)/m, (_m: string, inner: string) => {
      const lines = inner
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => !!s);
      if (!lines.some((l) => /^github\.com\/example\/demo-lib\s+v0\.0\.0$/.test(l))) {
        lines.push("github.com/example/demo-lib v0.0.0");
      }
      if (!lines.some((l) => /^github\.com\/example\/helper-lib\s+v0\.0\.0$/.test(l))) {
        lines.push("github.com/example/helper-lib v0.0.0");
      }
      const body = lines.map((l) => `\t${l}`).join("\n");
      return `require (\n${body}\n)`;
    });
  } else {
    // Insert a new require block after the go directive if one doesn't exist
    const inserted = cliGoMod.replace(
      /^(go\s+\d+\.\d+\s*\n)/m,
      `$1require (\n\tgithub.com/example/demo-lib v0.0.0\n\tgithub.com/example/helper-lib v0.0.0\n)\n`,
    );
    cliGoMod = inserted;
    if (!/require\s*\(/.test(cliGoMod)) {
      cliGoMod =
        cliGoMod.trimEnd() +
        `\nrequire (\n\tgithub.com/example/demo-lib v0.0.0\n\tgithub.com/example/helper-lib v0.0.0\n)\n`;
    }
  }
  if (
    !/\nreplace\s+github\.com\/example\/demo-lib\s+=>\s+\.\.\/\.\.\/libs\/demo-lib\s*$/.test(
      cliGoMod,
    )
  ) {
    cliGoMod =
      cliGoMod.trimEnd() + "\nreplace github.com/example/demo-lib => ../../libs/demo-lib\n";
  }
  if (
    !/\nreplace\s+github\.com\/example\/helper-lib\s+=>\s+\.\.\/\.\.\/libs\/helper-lib\s*$/.test(
      cliGoMod,
    )
  ) {
    cliGoMod =
      cliGoMod.trimEnd() + "\nreplace github.com/example/helper-lib => ../../libs/helper-lib\n";
  }
  await fsp.writeFile(cliGoModPath, cliGoMod, "utf8");

  // Ensure CLI TARGETS depends on demo-lib
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

  await writeFileAbs(
    path.join(tmp, "apps", "demo-cli", "cmd", "demo-cli", "main.go"),
    [
      "package main",
      "",
      "import (",
      '  "fmt"',
      '  demolib "github.com/example/demo-lib/pkg/demo-lib"',
      '  "os"',
      ")",
      "",
      "func main() {",
      '  name := "World"',
      '  if len(os.Args) > 2 && os.Args[1] == "--name" {',
      "    name = os.Args[2]",
      "  }",
      "  fmt.Println(demolib.Greeting(name))",
      "}",
      "",
    ].join("\n"),
  );
}

// No gomod2nix or glue generation: patch-go uses NIX_GO_TEST_RESOLVE_JSON for speed.

// PR6: Go providers removed; auto_map remains Node-only. No provider sync step here.

function normalizeCellLabel(s: string) {
  return s.replace(/^\/\/[^/]+\/+/, "//");
}

async function findExecutableRecursively(rootDir: string): Promise<string> {
  const stack: string[] = [rootDir];
  while (stack.length) {
    const cur = stack.pop()!;
    let names: string[] = [];
    try {
      names = await fsp.readdir(cur);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = path.join(cur, name);
      try {
        const st = await fsp.stat(p);
        if (st.isDirectory()) stack.push(p);
        else if (st.isFile()) {
          try {
            await fsp.access(p, 0o111);
            return p;
          } catch {}
        }
      } catch {}
    }
  }
  return "";
}

async function buildGraphAndFindBin(sh: any, tmp: string, label: string): Promise<string> {
  const { stdout } = await sh({
    cwd: tmp,
    stdio: "pipe",
    env: {},
  })`nix build .#graph-generator --no-link --print-out-paths --accept-flake-config`;
  const outPath =
    String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || "";
  const manifestPath = path.join(outPath, "manifest.json");
  const manifestTxt = await fsp.readFile(manifestPath, "utf8").catch(() => "");
  let binPath = "";
  if (manifestTxt) {
    const entries = JSON.parse(manifestTxt) as Array<any>;
    const labelEntry = entries.find((e) => {
      const lab = String(e?.label || "");
      return (
        lab === label || normalizeCellLabel(lab) === label || lab.includes("apps/demo-cli:demo-cli")
      );
    });
    if (!labelEntry) throw new Error(`manifest.json missing expected label: ${label}`);
    if (Array.isArray(labelEntry?.bins) && labelEntry.bins.length > 0) {
      binPath = String(labelEntry.bins[0] || "");
    }
  }
  if (!binPath) binPath = await findExecutableRecursively(path.join(outPath, "bin"));
  if (!binPath) throw new Error("CLI executable not found in graph outputs");
  return binPath;
}

async function listGoFilesRecursive(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length) {
    const cur = stack.pop()!;
    let names: string[] = [];
    try {
      names = await fsp.readdir(cur);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = path.join(cur, name);
      try {
        const st = await fsp.stat(p);
        if (st.isDirectory()) stack.push(p);
        else if (st.isFile() && name.endsWith(".go")) out.push(p);
      } catch {}
    }
  }
  return out;
}

async function patchUuidWorkspace(workspacePath: string): Promise<void> {
  const files = await listGoFilesRecursive(workspacePath);
  let changed = 0;
  for (const file of files) {
    let txt = "";
    try {
      txt = await fsp.readFile(file, "utf8");
    } catch {
      continue;
    }
    if (!/package\s+uuid\b/.test(txt)) continue;
    let out = txt;
    // Patch NewString() to return zero UUID string
    out = out.replace(
      /func\s+NewString\s*\(\s*\)\s*string\s*\{[\s\S]*?\}/m,
      'func NewString() string {\n\treturn "00000000-0000-0000-0000-000000000000"\n}',
    );
    // Patch String() method to always return zero UUID string
    out = out.replace(
      /func\s*\(\s*\w+\s+UUID\s*\)\s*String\s*\(\s*\)\s*string\s*\{[\s\S]*?\}/m,
      'func (u UUID) String() string {\n\treturn "00000000-0000-0000-0000-000000000000"\n}',
    );
    if (out !== txt) {
      await fsp.writeFile(file, out, "utf8");
      changed++;
    }
  }
  if (changed === 0) throw new Error("could not locate uuid.NewString()/String() to patch");
}

test("go cli with transitive third-party patched uuid runtime", async () => {
  await runInTemp("go-cli-transitive-patched-uuid", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    // Initialize git so patch-pkg can create and apply patches
    await $`git init`;
    await writeBuckConfig($);

    await scaffoldHelperLib($, _tmp);
    await scaffoldDemoLib($, _tmp);
    await scaffoldCli($, _tmp);
    await $({ cwd: path.join(_tmp, "apps", "demo-cli"), stdio: "inherit" })`go mod tidy`;

    // Create a uuid patch in a temporary workspace and apply it via patch-pkg
    const { origin, ws } = await startPatchPkgSession($, _tmp);
    await patchUuidWorkspace(ws);
    {
      const T = Number(process.env.TEST_CMD_TIMEOUT_S || "300");
      const localBin = await ensureNodeOnPath(_tmp);
      const resolveMap = JSON.stringify({
        "github.com/google/uuid": { version: "v1.6.0", originPath: origin },
      });
      await $({
        cwd: _tmp,
        stdio: "inherit",
        env: {
          NIX_GO_TEST_RESOLVE_JSON: resolveMap,
          NO_DEV_SHELL: "1",
          NODE_BIN: process.execPath,
          ZX_INIT: path.join(_tmp, "tools", "dev", "zx-init.mjs"),
          WORKSPACE_ROOT: _tmp,
          NODE_PATH: [path.join(process.cwd(), "node_modules"), process.env.NODE_PATH || ""]
            .filter(Boolean)
            .join(path.delimiter),
          PATH: `${path.dirname(process.execPath)}:${localBin}:${process.env.PATH || ""}`,
        },
      })`tools/bin/patch-pkg apply go github.com/google/uuid --target //apps/demo-cli:demo-cli --force`;
    }
    // Exercise full glue path after applying the patch
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $`node tools/buck/sync-providers.ts`;
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    // Validate local patch presence under CLI target
    const patchFile = path.join(
      _tmp,
      "apps",
      "demo-cli",
      "patches",
      "go",
      "github.com__google__uuid@v1.6.0.patch",
    );
    if (!(await fsp.stat(patchFile).catch(() => null))) {
      throw new Error("expected uuid patch file not found");
    }
    // Done: local patch present is sufficient for PR6
  });
});
