#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function writeFileAbs(p: string, content: string) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, "utf8");
}

async function runGomod2nix($: any, repoRoot: string, moduleRelDir: string) {
  // Use project wrapper from repo root for consistent dev/CI behavior
  await $({ cwd: repoRoot, stdio: "inherit" })`tools/bin/gomod2nix --dir ${moduleRelDir}`;
}

async function findFirstExecutable(dir: string): Promise<string> {
  const entries = await fsp.readdir(dir).catch(() => [] as string[]);
  for (const name of entries) {
    const p = path.join(dir, name);
    try {
      const st = await fsp.stat(p);
      if (st.isFile()) {
        try {
          await fsp.access(p, 0o111);
          return p;
        } catch {}
      }
    } catch {}
  }
  return "";
}

async function findExecutableRecursively(rootDir: string): Promise<string> {
  const stack: string[] = [rootDir];
  while (stack.length) {
    const cur = stack.pop()!;
    const names = await fsp.readdir(cur).catch(() => [] as string[]);
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

async function listTree(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length) {
    const cur = stack.pop()!;
    const names = await fsp.readdir(cur).catch(() => [] as string[]);
    for (const name of names) {
      const p = path.join(cur, name);
      try {
        const st = await fsp.stat(p);
        if (st.isDirectory()) stack.push(p);
        out.push(p);
      } catch {}
    }
  }
  return out.sort();
}

test("go cli with local lib + third-party runtime", async () => {
  await runInTemp("go-cli-thirdparty-runtime", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`bash -lc ${`set -euo pipefail
      : > .buckroot
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

    // 1) Scaffold the lib
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;

    // 2) Add third-party dep and implement Greeting (use github.com/google/uuid)
    await $({
      cwd: path.join(_tmp, "libs", "demo-lib"),
      stdio: "inherit",
    })`go get github.com/google/uuid@v1.6.0`;
    await $({ cwd: path.join(_tmp, "libs", "demo-lib"), stdio: "inherit" })`go mod tidy`;
    await writeFileAbs(
      path.join(_tmp, "libs", "demo-lib", "pkg", "demo-lib", "demo-lib.go"),
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

    // 3) Scaffold CLI and wire to lib via replace + deps
    await $`scaf new go cli demo-cli --yes --path=apps/demo-cli`;

    // Add require + replace to CLI go.mod
    const cliGoModPath = path.join(_tmp, "apps", "demo-cli", "go.mod");
    let cliGoMod = await fsp.readFile(cliGoModPath, "utf8");
    if (!/\nrequire\s/.test(cliGoMod)) {
      // Insert require after the 'go x.y' line
      cliGoMod = cliGoMod.replace(
        /^(go\s+\d+\.\d+\s*)$/m,
        `$1\nrequire github.com/example/demo-lib v0.0.0\n`,
      );
    }
    if (
      !/\nreplace\s+github\.com\/example\/demo-lib\s+=>\s+\.\.\/\.\.\/libs\/demo-lib\s*$/.test(
        cliGoMod,
      )
    ) {
      cliGoMod =
        cliGoMod.trimEnd() + "\nreplace github.com/example/demo-lib => ../../libs/demo-lib\n";
    }
    await fsp.writeFile(cliGoModPath, cliGoMod, "utf8");

    // Ensure local lib TARGETS advertises import path and is visible
    const libTargetsPath = path.join(_tmp, "libs", "demo-lib", "TARGETS");
    let libTargets = await fsp.readFile(libTargetsPath, "utf8");
    // No importpath injection; rely on Buck package layout and explicit deps
    if (!/visibility\s*=\s*\[\s*"PUBLIC"\s*\]/.test(libTargets)) {
      libTargets = libTargets.replace(/nix_go_library\(([^)]*)\)/ms, (m: string, body: string) => {
        const withVis = body.includes("visibility = ")
          ? body
          : body.replace(
              /labels\s*=\s*\[[^\]]*\],?/m,
              (lm: string) => `${lm}
    visibility = ["PUBLIC"],`,
            );
        return `nix_go_library(${withVis})`;
      });
    }
    await fsp.writeFile(libTargetsPath, libTargets, "utf8");

    // Add Buck dep on the local lib after scaffolding (not in template)
    const cliTargetsPath = path.join(_tmp, "apps", "demo-cli", "TARGETS");
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
              (lm: string) => `${lm}
    deps = ["//libs/demo-lib:demo-lib"],`,
            );
        return `nix_go_binary(${withDeps})`;
      });
      await fsp.writeFile(cliTargetsPath, cliTargets, "utf8");
    }

    // CLI main.go uses the lib
    await writeFileAbs(
      path.join(_tmp, "apps", "demo-cli", "cmd", "demo-cli", "main.go"),
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

    // Ensure CLI resolves transitive deps from the replaced local lib
    await $({ cwd: path.join(_tmp, "apps", "demo-cli"), stdio: "inherit" })`go mod tidy`;

    // Generate gomod2nix.toml for lib and CLI; copy root from CLI (authoritative)
    await runGomod2nix($, _tmp, "libs/demo-lib");
    await runGomod2nix($, _tmp, "apps/demo-cli");
    await fsp.copyFile(
      path.join(_tmp, "apps", "demo-cli", "gomod2nix.toml"),
      path.join(_tmp, "gomod2nix.toml"),
    );

    // Generate glue
    await $`tools/dev/install-deps.ts --glue-only`;
    try {
      await $({ cwd: _tmp, stdio: "pipe" })`direnv allow .`;
    } catch {}

    // 5) Build via Nix (graph-generator) and run the resulting CLI binary
    const outLinkName = `buck-go-${Date.now()}`;
    const outLinkPath = path.join(_tmp, outLinkName);
    // Remove any pre-existing out-link path defensively
    try {
      await fsp.rm(outLinkPath, { recursive: false, force: true });
    } catch {}
    await $({
      cwd: _tmp,
      stdio: "inherit",
    })`nix build .#graph-generator --out-link ${outLinkName}`;
    // Try manifest first
    const label = "//apps/demo-cli:demo-cli";
    const sanitized = label.replace("//", "").replace(/[:/ ]/g, "-");
    try {
      const manifestPath = path.join(_tmp, outLinkName, "manifest.json");
      const manifestTxt = await fsp.readFile(manifestPath, "utf8").catch(() => "");
      if (manifestTxt) {
        const entries = JSON.parse(manifestTxt) as Array<any>;
        const entry = entries.find(
          (e) => e && e.label === label && Array.isArray(e.bins) && e.bins.length > 0,
        );
        if (entry) {
          const cand = String(entry.bins[0] || "");
          const run = await $({ stdio: "pipe" })`${cand} --name Bob`;
          const s = String(run.stdout || "").trim();
          if (!/^Hello, Bob [0-9a-f\-]{36}$/.test(s)) {
            console.error("stdout:", s);
            throw new Error("unexpected output; expected greeting with UUID appended");
          }
          return;
        } else {
          console.error("[debug] manifest.json present but no bins for label:", label);
          console.error("[debug] manifest.json:\n" + manifestTxt);
          try {
            const buildLog = await fsp
              .readFile(path.join(_tmp, outLinkName, "build.log"), "utf8")
              .catch(() => "");
            if (buildLog) console.error("[debug] build.log:\n" + buildLog);
          } catch {}
          try {
            const tree = await listTree(path.join(_tmp, outLinkName, "bin"));
            console.error("[debug] buck-go/bin tree:\n" + tree.join("\n"));
          } catch {}
        }
      }
    } catch {
      try {
        const manifestPath = path.join(_tmp, outLinkName, "manifest.json");
        const manifestTxt = await fsp.readFile(manifestPath, "utf8").catch(() => "");
        console.error("[debug] manifest.json:\n" + (manifestTxt || "(missing)"));
      } catch {}
      try {
        const buildLog = await fsp
          .readFile(path.join(_tmp, outLinkName, "build.log"), "utf8")
          .catch(() => "");
        if (buildLog) console.error("[debug] build.log:\n" + buildLog);
      } catch {}
      throw new Error("CLI executable not found in manifest outputs");
    }
  });
});
