#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

test("python runtime: BUILD-INFO patches include sha256 and deterministic order", async () => {
  await runInTemp("py-provenance-sha256", async (tmp, _$) => {
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
    // Vendor source
    const origin = path.join(app, "vendor", "mydep-1.0.0");
    await fs.mkdirp(path.join(origin, "mydep"));
    await fs.writeFile(path.join(origin, "mydep", "__init__.py"), "x=1\n", "utf8");
    // Patches (two, ensure lexicographic ordering by filename)
    const pdir = path.join(app, "patches", "python");
    await fs.mkdirp(pdir);
    const patchA = [
      "--- a/mydep/__init__.py",
      "+++ b/mydep/__init__.py",
      "@@",
      "-x=1",
      "+x=2",
      "",
    ].join("\n");
    const patchB = [
      "--- a/mydep/__init__.py",
      "+++ b/mydep/__init__.py",
      "@@",
      "-x=2",
      "+x=3",
      "",
    ].join("\n");
    await fs.writeFile(path.join(pdir, "mydep@1.0.0-a.patch"), patchA, "utf8");
    await fs.writeFile(path.join(pdir, "mydep@1.0.0-b.patch"), patchB, "utf8");
    // Graph
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
    })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
    const outPath = String(build.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    const infoPath = path.join(outPath, "BUILD-INFO.json");
    const info = JSON.parse(await fs.readFile(infoPath, "utf8"));
    if (!Array.isArray(info.patches) || info.patches.length !== 2) {
      console.error("expected exactly two patch provenance entries", info);
      process.exit(2);
    }
    const keys = info.patches.map((p: any) => p.key);
    const files = info.patches.map((p: any) => String(p.file));
    const shas = info.patches.map((p: any) => p.sha256);
    if (!keys.every((k: string) => k === "mydep@1.0.0")) {
      console.error("unexpected keys in provenance", keys);
      process.exit(2);
    }
    const suffixes = files.map((f) => f.replace(/^.*-?py-patch-.*-/, ""));
    if (suffixes[0].endsWith("-a.patch") && suffixes[1].endsWith("-b.patch")) {
      // ok
    } else if (suffixes[0] === "mydep@1.0.0-a.patch" && suffixes[1] === "mydep@1.0.0-b.patch") {
      // ok
    } else {
      console.error("unexpected patch file order", files);
      process.exit(2);
    }
    if (shas.some((s: any) => typeof s !== "string" || s.length < 10)) {
      console.error("sha256 missing or malformed", shas);
      process.exit(2);
    }
  });
});
