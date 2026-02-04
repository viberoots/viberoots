#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python runtime: CRLF patch lines are normalized and applied", async () => {
  await runInTemp("py-crlf-patch", async (tmp, _$) => {
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
    // App prints mydep.msg()
    await fs.writeFile(
      path.join(app, "src", "demo_pyapp", "__init__.py"),
      "from mydep import msg\nprint('app:' + msg())\n",
      "utf8",
    );
    await fs.writeFile(path.join(app, "bin", "__main__.py"), "from demo_pyapp import *\n", "utf8");
    // Vendor origin
    const origin = path.join(app, "vendor", "mydep-1.0.0");
    await fs.mkdirp(path.join(origin, "mydep"));
    await fs.writeFile(
      path.join(origin, "mydep", "__init__.py"),
      ["def msg():", '    return "orig"', ""].join("\n"),
      "utf8",
    );
    // Importer-local patch with CRLF line endings
    const pdir = path.join(app, "patches", "python");
    await fs.mkdirp(pdir);
    const patchLines = [
      "--- a/mydep/__init__.py",
      "+++ b/mydep/__init__.py",
      "@@",
      "-def msg():",
      '-    return "orig"',
      "+def msg():",
      '+    return "patched"',
      "",
    ];
    const crlf = patchLines.join("\r\n") + "\r\n";
    await fs.writeFile(path.join(pdir, "mydep@1.0.0.patch"), crlf, "utf8");
    // Minimal Buck graph
    const graphDir = path.join(tmp, "build-tools", "tools", "buck");
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
    // Build and run; expect patched output
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
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    const outPath = String(build.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    const bin = path.join(outPath, "bin", "py-apps-demo_pyapp-demo_pyapp");
    const run = await $({ cwd: tmp, stdio: "pipe" })`${bin}`;
    const out = String(run.stdout || "").trim();
    if (out !== "app:patched") {
      console.error("unexpected output:", out);
      process.exit(2);
    }
  });
});
