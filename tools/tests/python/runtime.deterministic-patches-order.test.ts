#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python runtime: multiple patches apply in deterministic sorted order", async () => {
  await runInTemp("py-patch-order", async (tmp, _$) => {
    const $ = _$
      ? _$
      : (cmd: TemplateStringsArray, ...args: any[]) => (global as any).$`${cmd}${args}`;
    const app = path.join(tmp, "apps", "demo_pyapp");
    await fs.mkdirp(path.join(app, "src", "demo_pyapp"));
    await fs.mkdirp(path.join(app, "bin"));
    await fs.writeFile(
      path.join(app, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "mydep"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    // App reads mydep.message file (concatenate lines)
    await fs.writeFile(
      path.join(app, "src", "demo_pyapp", "__init__.py"),
      "import mydep, sys\nprint(mydep.message())\n",
      "utf8",
    );
    await fs.writeFile(path.join(app, "bin", "__main__.py"), "from demo_pyapp import *\n", "utf8");
    // Vendor dist with a simple message() implementation from a text file
    const origin = path.join(app, "vendor", "mydep-1.0.0");
    await fs.mkdirp(path.join(origin, "mydep"));
    await fs.writeFile(
      path.join(origin, "mydep", "__init__.py"),
      ["def message():", "    return 'X'", ""].join("\n"),
      "utf8",
    );
    // Patches under importer-local patches/python. Two patches lexicographically sorted by filename.
    const pdir = path.join(app, "patches", "python");
    await fs.mkdirp(pdir);
    // Patch A: change message to return 'A'
    const patchA = [
      "--- a/mydep/__init__.py",
      "+++ b/mydep/__init__.py",
      "@@",
      "-def message():",
      "-    return 'X'",
      "+def message():",
      "+    return 'A'",
      "",
    ].join("\n");
    // Patch B: modify same function to append 'B' deterministically after A
    const patchB = [
      "--- a/mydep/__init__.py",
      "+++ b/mydep/__init__.py",
      "@@",
      "-def message():",
      "-    return 'A'",
      "+def message():",
      "+    return 'AB'",
      "",
    ].join("\n");
    // Names ensure lexicographic order: ...-a.patch then ...-b.patch
    await fs.writeFile(path.join(pdir, "mydep@1.0.0-a.patch"), patchA, "utf8");
    await fs.writeFile(path.join(pdir, "mydep@1.0.0-b.patch"), patchB, "utf8");
    // Graph
    const graphDir = path.join(tmp, "tools", "buck");
    await fs.mkdirp(graphDir);
    const node = {
      name: "//apps/demo_pyapp:demo_pyapp",
      rule_type: "python_binary",
      labels: ["lang:python", "kind:bin"],
      srcs: ["apps/demo_pyapp/bin/__main__.py"],
    };
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify([node], null, 2) + "\n",
      "utf8",
    );
    // Build and run, verifying final patched output is 'AB'
    const build = await $({
      cwd: tmp,
      env: {
        ...process.env,
        BUCK_TARGET: "//apps/demo_pyapp:demo_pyapp",
        BUCK_TEST_SRC: tmp,
        WORKSPACE_ROOT: tmp,
        NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
          mydep: {
            version: "1.0.0",
            originPath: path.join("apps", "demo_pyapp", "vendor", "mydep-1.0.0"),
          },
        }),
      },
      stdio: "pipe",
    })`nix build --impure -L .#graph-generator-selected --accept-flake-config --no-link --print-out-paths`;
    const outPath = String(build.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    const bin = path.join(outPath, "bin", "py-apps-demo_pyapp-demo_pyapp");
    const run = await $({ cwd: tmp, stdio: "pipe" })`${bin}`;
    const out = String(run.stdout || "").trim();
    if (out !== "AB") {
      console.error("unexpected output:", out);
      process.exit(2);
    }
  });
});
