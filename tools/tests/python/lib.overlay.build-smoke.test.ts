#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python lib overlay build smoke: site exists and contains resolved dist", async () => {
  await runInTemp("py-lib-overlay-smoke", async (tmp, _$) => {
    const $ = _$
      ? _$
      : (cmd: TemplateStringsArray, ...args: any[]) => (global as any).$`${cmd}${args}`;

    // 1) Scaffold a minimal python lib
    const name = "demo_pylib";
    const libDir = path.join(tmp, "libs", name);
    await $`scaf new python lib ${name} --yes --path=${libDir}`;

    // 2) Provide a simple vendor origin for mydep@1.0.0 and a minimal uv.lock
    const originRel = path.join("vendor", "mydep-1.0.0");
    const originAbs = path.join(libDir, originRel);
    await fs.mkdirp(path.join(originAbs, "mydep"));
    await fs.writeFile(path.join(originAbs, "mydep", "__init__.py"), "x = 1\n", "utf8");
    const uvLock = ["# uv lock", "[[package]]", 'name = "mydep"', 'version = "1.0.0"', ""].join(
      "\n",
    );
    await fs.writeFile(path.join(libDir, "uv.lock"), uvLock, "utf8");

    // 3) Minimal Buck graph node for the library
    const graphDir = path.join(tmp, "tools", "buck");
    await fs.mkdirp(graphDir);
    const node = {
      name: `//libs/${name}:${name}`,
      rule_type: "python_library",
      labels: ["lang:python", "kind:lib"],
      srcs: [`libs/${name}/src/${name}/__init__.py`],
    };
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify([node], null, 2) + "\n",
      "utf8",
    );

    // 4) Build selected lib target via flake selected output
    const buildOut = await $({
      cwd: tmp,
      env: {
        ...process.env,
        BUCK_TARGET: `//libs/${name}:${name}`,
        BUCK_TEST_SRC: tmp,
        NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
          mydep: { version: "1.0.0", originPath: originRel },
        }),
      },
      stdio: "pipe",
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`.nothrow();
    if (buildOut.exitCode !== 0) {
      throw new Error(`nix build failed: ${buildOut.stderr || buildOut.stdout || ""}`);
    }
    const outPath = String(buildOut.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (!outPath) {
      throw new Error("missing nix outPath for python lib build");
    }

    // 5) Overlay site exists and contains mydep file from vendor origin (resolved by test JSON)
    const siteFile = path.join(outPath, "site", "mydep", "__init__.py");
    try {
      await fs.access(siteFile);
    } catch {
      throw new Error(`overlay site file missing: ${siteFile}`);
    }
  });
});
