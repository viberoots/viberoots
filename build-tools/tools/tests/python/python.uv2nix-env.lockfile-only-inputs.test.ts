#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("uv2nix env drvPath depends only on uv.lock (not importer source files)", async () => {
  await runInTemp("py-uv2nix-env-src", async (tmp, _$) => {
    if (!_$) {
      throw new Error("runInTemp did not provide a zx $ helper");
    }
    const $ = _$;

    const importer = path.join(tmp, "projects", "apps", "demo_pyapp");
    await fs.mkdirp(path.join(importer, "src", "demo_pyapp"));
    await fs.mkdirp(path.join(importer, "bin"));

    await fs.writeFile(
      path.join(importer, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "mydep"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(importer, "src", "demo_pyapp", "__init__.py"), "x = 1\n", "utf8");
    await fs.writeFile(path.join(importer, "bin", "__main__.py"), "print('ok')\n", "utf8");

    const origin = path.join(importer, "vendor", "mydep-1.0.0");
    await fs.mkdirp(path.join(origin, "mydep"));
    await fs.writeFile(path.join(origin, "mydep", "__init__.py"), "y = 1\n", "utf8");

    await $`git add -A`;
    await $`git ls-files --error-unmatch projects/apps/demo_pyapp/uv.lock`;
    await $`git -c user.name=tmp -c user.email=tmp@example.com commit -m "test: pyapp setup"`;

    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
    await fs.mkdirp(graphDir);
    const graph = [
      {
        name: "//projects/apps/demo_pyapp:demo_pyapp",
        rule_type: "python_binary",
        labels: ["lang:python", "kind:bin"],
        srcs: ["projects/apps/demo_pyapp/bin/__main__.py"],
      },
    ];
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(graph, null, 2) + "\n",
      "utf8",
    );
    await $`git add -A`;
    await $`git ls-files --error-unmatch build-tools/tools/buck/graph.json`;
    await $`git -c user.name=tmp -c user.email=tmp@example.com commit -m "test: add graph"`;

    const flakeAttr = "graph-generator-selected.passthru.uv2nixEnv.drvPath";
    const baseEnv = {
      ...process.env,
      WORKSPACE_ROOT: tmp,
      BUCK_TEST_SRC: tmp,
      BUCK_TARGET: "//projects/apps/demo_pyapp:demo_pyapp",
      NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
        mydep: {
          version: "1.0.0",
          originPath: path.join("projects", "apps", "demo_pyapp", "vendor", "mydep-1.0.0"),
        },
      }),
    };

    const drv1 = String(
      (
        await $({
          cwd: tmp,
          env: baseEnv,
          stdio: "pipe",
        })`nix eval --impure --accept-flake-config --raw ${`path:${tmp}#${flakeAttr}`}`
      ).stdout,
    ).trim();
    assert.ok(
      drv1.startsWith("/nix/store/") && drv1.endsWith(".drv"),
      `unexpected drvPath: ${drv1}`,
    );

    await fs.writeFile(path.join(importer, "src", "demo_pyapp", "unrelated.py"), "z = 1\n", "utf8");
    await $`git add -A`;
    await $`git ls-files --error-unmatch projects/apps/demo_pyapp/src/demo_pyapp/unrelated.py`;
    await $`git -c user.name=tmp -c user.email=tmp@example.com commit -m "test: change src"`;

    const drv2 = String(
      (
        await $({
          cwd: tmp,
          env: baseEnv,
          stdio: "pipe",
        })`nix eval --impure --accept-flake-config --raw ${`path:${tmp}#${flakeAttr}`}`
      ).stdout,
    ).trim();
    assert.equal(
      drv2,
      drv1,
      "expected uv2nix env drvPath to be stable when only source files change",
    );

    await fs.appendFile(path.join(importer, "uv.lock"), "\n# changed\n", "utf8");
    await $`git add -A`;
    await $`git -c user.name=tmp -c user.email=tmp@example.com commit -m "test: change lockfile"`;

    const drv3 = String(
      (
        await $({
          cwd: tmp,
          env: baseEnv,
          stdio: "pipe",
        })`nix eval --impure --accept-flake-config --raw ${`path:${tmp}#${flakeAttr}`}`
      ).stdout,
    ).trim();
    assert.notEqual(drv3, drv1, "expected uv2nix env drvPath to change when uv.lock changes");
  });
});
