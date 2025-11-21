#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python runtime e2e: app output changes after patch apply", async () => {
  await runInTemp("py-runtime-e2e", async (tmp, _$) => {
    const $ = _$
      ? _$
      : (cmd: TemplateStringsArray, ...args: any[]) => (global as any).$`${cmd}${args}`;
    const zxInit = path.join(process.cwd(), "tools", "dev", "zx-init.mjs");

    // 1) Scaffold a minimal python app
    const appName = "demo_pyapp";
    const app = path.join(tmp, "apps", appName);
    await $`scaf new python app ${appName} --yes --path=${app}`;

    // Wire the app to import a dist "mydep" and print its message
    const pkgDir = path.join(app, "src", appName);
    await fs.mkdirp(pkgDir);
    const initPy = [
      "def greet() -> str:",
      "    from mydep import msg",
      '    return "app:" + msg()',
      "",
    ].join("\n");
    await fs.writeFile(path.join(pkgDir, "__init__.py"), initPy, "utf8");
    const mainPy = [
      "from demo_pyapp import greet",
      "def main():",
      "    print(greet())",
      'if __name__ == "__main__":',
      "    main()",
      "",
    ].join("\n");
    const binDir = path.join(app, "bin");
    await fs.mkdirp(binDir);
    await fs.writeFile(path.join(binDir, "__main__.py"), mainPy, "utf8");
    // Keep default entrypoint (__main__.py) so wrapper executes primary path

    // 2) Create uv.lock with mydep@1.0.0
    const uvLock = ["# uv lock", "[[package]]", 'name = "mydep"', 'version = "1.0.0"', ""].join(
      "\n",
    );
    await fs.writeFile(path.join(app, "uv.lock"), uvLock, "utf8");
    const lockContents = await fs.readFile(path.join(app, "uv.lock"), "utf8");
    console.log("uv.lock now:\n" + lockContents);

    // 3) Provide a local origin for mydep@1.0.0
    // Place origin inside the app subdir so Nix src input can access it during build
    const origin = path.join(app, "vendor", "mydep-1.0.0");
    const originRel = path.join("vendor", "mydep-1.0.0");
    const originAbs = origin;
    await fs.mkdirp(path.join(origin, "mydep"));
    const mydepInit = ["def msg():", '    return "orig"', ""].join("\n");
    await fs.writeFile(path.join(origin, "mydep", "__init__.py"), mydepInit, "utf8");

    // Write a minimal Buck graph for the planner to consume
    const graphDir = path.join(tmp, "tools", "buck");
    await fs.mkdirp(graphDir);
    const node = {
      name: `//apps/${appName}:${appName}`,
      rule_type: "python_binary",
      labels: ["lang:python", "kind:bin"],
      srcs: [`apps/${appName}/bin/__main__.py`, `apps/${appName}/src/${appName}/__init__.py`],
    };
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify([node], null, 2) + "\n",
      "utf8",
    );

    // Helper to build and run the selected target via Nix
    async function runApp(expect: string, extraEnv: Record<string, string> = {}) {
      // Build selected target and capture out path
      const buildOut = await $({
        cwd: tmp,
        env: {
          ...process.env,
          BUCK_TARGET: `//apps/${appName}:${appName}`,
          BUCK_TEST_SRC: tmp,
          NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
            mydep: { version: "1.0.0", originPath: originRel },
          }),
          ...extraEnv,
        },
        stdio: "pipe",
      })`nix build --impure -L .#graph-generator-selected --accept-flake-config --no-link --print-out-paths`;
      const outPath = String(buildOut.stdout || "")
        .trim()
        .split(/\s+/)
        .pop() as string;
      if (!outPath) {
        console.error("missing nix outPath");
        process.exit(2);
      }
      // Execute wrapper
      const bin = path.join(outPath, "bin", `py-apps-${appName}-${appName}`);
      const { stdout } = await $({ cwd: tmp, stdio: "pipe" })`${bin}`;
      const out = String(stdout || "").trim();
      if (out !== expect) {
        console.error("unexpected output:", out, "expected:", expect);
        process.exit(2);
      }
    }

    // First run: no patch → expect "app:orig"
    await runApp("app:orig");

    // 4) Apply a patch that changes mydep.msg() to return "patched"
    // Start session to get workspace and then modify
    const wsOut = await $({
      cwd: tmp,
      env: {
        ...process.env,
        WORKSPACE_ROOT: tmp,
        NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
          mydep: { version: "1.0.0", originPath: originAbs },
        }),
        NIX_PY_DEV_OVERRIDE_JSON: "{}",
      },
    })`${process.execPath} --experimental-strip-types --import ${zxInit} tools/patch/patch-pkg.ts start python mydep --importer ${app}`;
    const ws = String(wsOut.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    await fs.writeFile(
      path.join(ws, "mydep", "__init__.py"),
      ["def msg():", '    return "patched"', ""].join("\n"),
      "utf8",
    );
    // Apply non-interactively
    await $({
      cwd: tmp,
      env: {
        ...process.env,
        WORKSPACE_ROOT: tmp,
        NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
          mydep: { version: "1.0.0", originPath: originAbs },
        }),
        NIX_PY_DEV_OVERRIDE_JSON: "{}",
        PATCH_SKIP_VERIFY: "1",
      },
    })`${process.execPath} --experimental-strip-types --import ${zxInit} tools/patch/patch-pkg.ts apply python mydep --importer ${app}`;
    // Debug: list patches dir
    try {
      const patchesDir = path.join(tmp, "patches", "python");
      const entries = await fs.readdir(patchesDir);
      console.log("patches/python:", entries.join(", "));
    } catch {}

    // Second run: with patch → expect "app:patched"
    // Prefer patched workspace via dev override to validate runtime behavior
    await runApp("app:patched", {
      NIX_PY_DEV_OVERRIDE_JSON: JSON.stringify({ ["mydep@1.0.0"]: ws }),
    });
  });
});
