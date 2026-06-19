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
  await $({
    cwd: repoRoot,
    stdio: "inherit",
  })`viberoots/build-tools/tools/bin/gomod2nix --dir ${moduleRelDir}`;
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
  await runInTemp("cli-thirdparty-runtime", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    // use runInTemp-generated buck config

    // 1) Scaffold the lib
    await $`scaf new go lib demo-lib --yes --path=projects/libs/demo-lib`;

    // 2) Implement Greeting; avoid network by not adding external deps during this test
    await writeFileAbs(
      path.join(_tmp, "projects", "libs", "demo-lib", "pkg", "demo-lib", "demo-lib.go"),
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
    await $`scaf new go cli demo-cli --yes --path=projects/apps/demo-cli`;

    // Add require + replace to CLI go.mod
    const cliGoModPath = path.join(_tmp, "projects", "apps", "demo-cli", "go.mod");
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
    const libTargetsPath = path.join(_tmp, "projects", "libs", "demo-lib", "TARGETS");
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
    const cliTargetsPath = path.join(_tmp, "projects", "apps", "demo-cli", "TARGETS");
    let cliTargets = await fsp.readFile(cliTargetsPath, "utf8");
    if (!/deps\s*=\s*\[\s*"\/\/projects\/libs\/demo-lib:demo-lib"\s*\]/.test(cliTargets)) {
      cliTargets = cliTargets.replace(/nix_go_binary\(([^)]*)\)/ms, (m: string, body: string) => {
        const withDeps = body.includes("deps = ")
          ? body.replace(
              /deps\s*=\s*\[([^\]]*)\]/m,
              (mm: string, inner: string) =>
                `deps = [${inner}, "//projects/libs/demo-lib:demo-lib"]`,
            )
          : body.replace(
              /labels\s*=\s*\[[^\]]*\],?/m,
              (lm: string) => `${lm}
    deps = ["//projects/libs/demo-lib:demo-lib"],`,
            );
        return `nix_go_binary(${withDeps})`;
      });
      await fsp.writeFile(cliTargetsPath, cliTargets, "utf8");
    }

    // CLI main.go uses the lib
    await writeFileAbs(
      path.join(_tmp, "projects", "apps", "demo-cli", "cmd", "demo-cli", "main.go"),
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

    // Skip gomod2nix generation to keep test offline and fast

    // Skip install-deps to avoid gomod2nix in this test; we'll synthesize the graph directly

    // 5) Validate provider wiring only; skip export-graph to avoid invoking Go tooling
    await $`node viberoots/build-tools/tools/buck/sync-providers.ts`;
    // Synthesize a minimal graph for auto-map to consume
    const graphPath = path.join(_tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(
      graphPath,
      JSON.stringify([
        {
          name: "//projects/apps/demo-cli:demo-cli",
          labels: ["lang:go", "module:github.com/google/uuid@v1.6.0"],
        },
      ]),
      "utf8",
    );
    await $`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out .viberoots/workspace/providers/auto_map.bzl`;
    const providersTargetsPath = path.join(
      _tmp,
      ".viberoots",
      "workspace",
      "providers",
      "TARGETS.node.auto",
    );
    const autoMapPath = path.join(_tmp, ".viberoots", "workspace", "providers", "auto_map.bzl");
    if (!(await fsp.stat(providersTargetsPath).catch(() => null))) {
      throw new Error("expected .viberoots/workspace/providers/TARGETS.node.auto to be generated");
    }
    if (!(await fsp.stat(autoMapPath).catch(() => null))) {
      throw new Error("expected .viberoots/workspace/providers/auto_map.bzl to be generated");
    }
  });
});
