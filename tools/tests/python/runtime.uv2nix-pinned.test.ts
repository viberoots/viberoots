#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python runtime: BUILD-INFO includes uv2nix version/rev", async () => {
  await runInTemp("py-uv2nix-info", async (tmp, _$) => {
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
    await fs.writeFile(path.join(app, "src", "demo_pyapp", "__init__.py"), "pass\n", "utf8");
    await fs.writeFile(path.join(app, "bin", "__main__.py"), "print('ok')\n", "utf8");
    // Vendor source
    const origin = path.join(app, "vendor", "mydep-1.0.0");
    await fs.mkdirp(path.join(origin, "mydep"));
    await fs.writeFile(path.join(origin, "mydep", "__init__.py"), "x=1\n", "utf8");
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
    const infoPath = path.join(outPath, "BUILD-INFO.json");
    const info = JSON.parse(await fs.readFile(infoPath, "utf8"));
    if (!info.uv2nix || !info.uv2nix.version || !info.uv2nix.rev) {
      console.error("BUILD-INFO missing uv2nix identity:", info);
      process.exit(2);
    }
  });
});
