#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

test("python runtime: context mismatch fails patch apply (strict mode)", async () => {
  await runInTemp("py-strict-context-mismatch", async (tmp, _$) => {
    const $ = _$
      ? _$
      : (cmd: TemplateStringsArray, ...args: any[]) => (global as any).$`${cmd}${args}`;
    const app = path.join(tmp, "projects", "apps", "demo_pyapp");
    await fs.mkdirp(path.join(app, "src", "demo_pyapp"));
    await fs.mkdirp(path.join(app, "bin"));
    await fs.writeFile(
      path.join(app, "uv.lock"),
      ["# uv lock", "[[package]]", 'name = "mydep"', 'version = "1.0.0"', ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(app, "src", "demo_pyapp", "__init__.py"), "pass\n", "utf8");
    await fs.writeFile(path.join(app, "bin", "__main__.py"), "print('ok')\n", "utf8");
    const origin = path.join(app, "vendor", "mydep-1.0.0");
    await fs.mkdirp(path.join(origin, "mydep"));
    await fs.writeFile(path.join(origin, "mydep", "__init__.py"), "x=1\n", "utf8");
    const pdir = path.join(app, "patches", "python");
    await fs.mkdirp(pdir);
    // Patch tries to replace content that does not exist (context mismatch)
    const bad = [
      "--- a/mydep/__init__.py",
      "+++ b/mydep/__init__.py",
      "@@",
      "-x=999",
      "+x=2",
      "",
    ].join("\n");
    await fs.writeFile(path.join(pdir, "mydep@1.0.0-bad.patch"), bad, "utf8");
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fs.mkdirp(graphDir);
    const node = {
      name: "//projects/apps/demo_pyapp:demo_pyapp",
      rule_type: "python_binary",
      labels: ["lang:python", "kind:bin"],
      srcs: ["projects/apps/demo_pyapp/bin/__main__.py"],
    };
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify([node], null, 2) + "\n",
      "utf8",
    );
    const build = await $({
      cwd: tmp,
      env: {
        ...process.env,
        BUCK_TARGET: "//projects/apps/demo_pyapp:demo_pyapp",
        BUCK_TEST_SRC: tmp,
        WORKSPACE_ROOT: tmp,
        NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
          mydep: {
            version: "1.0.0",
            originPath: path.join("projects", "apps", "demo_pyapp", "vendor", "mydep-1.0.0"),
          },
        }),
      },
      stdio: "pipe",
    })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`.catch(
      (e: any) => e,
    );
    // Ensure the error surfaced clearly (patch returns non-zero; stderr carries context info)
    const code = Number(build?.exitCode ?? 0);
    if (!code || code === 0) {
      console.error("expected non-zero exit for context mismatch");
      process.exit(2);
    }
    const stderr = String(build?.stderr || "");
    if (!/patch/i.test(stderr)) {
      console.error("expected patch failure details in stderr", stderr);
      process.exit(2);
    }
  });
});
