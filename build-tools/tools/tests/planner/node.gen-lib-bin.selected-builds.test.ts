#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("planner builds selected node gen/lib/bin targets with expected output paths", async () => {
  await runInTemp("planner-node-gen-lib-bin", async (tmp, $) => {
    const graphDir = path.join(tmp, "build-tools/tools/buck");
    await fs.mkdirp(graphDir);

    const appDir = path.join(tmp, "projects/apps/node-artifacts");
    await fs.mkdirp(path.join(appDir, "src"));
    await fs.writeFile(path.join(appDir, "src", "input.txt"), "hello-node\n", "utf8");

    const lockLabel =
      "lockfile:projects/apps/node-artifacts/pnpm-lock.yaml#projects/apps/node-artifacts";
    const nodes = [
      {
        name: "//projects/apps/node-artifacts:copy_gen",
        rule_type: "genrule",
        labels: ["lang:node", "kind:gen", lockLabel],
        srcs: ["projects/apps/node-artifacts/src/input.txt"],
        out: "gen/out.txt",
        cmd: 'cp src/input.txt "$OUT"',
      },
      {
        name: "//projects/apps/node-artifacts:copy_lib",
        rule_type: "genrule",
        labels: ["lang:node", "kind:lib", lockLabel],
        srcs: ["projects/apps/node-artifacts/src/input.txt"],
        out: "lib/output.js",
        cmd: 'cat src/input.txt > "$OUT"',
      },
      {
        name: "//projects/apps/node-artifacts:copy_bin",
        rule_type: "genrule",
        labels: ["lang:node", "kind:bin", lockLabel],
        srcs: ["projects/apps/node-artifacts/src/input.txt"],
        out: "demo.sh",
        cmd: "printf '#!/usr/bin/env sh\\necho node-bin\\n' > \"$OUT\"",
      },
    ];
    await fs.writeFile(path.join(graphDir, "graph.json"), JSON.stringify(nodes), "utf8");

    const cases = [
      {
        target: "//projects/apps/node-artifacts:copy_gen",
        relPath: "gen/out.txt",
        expected: "hello-node",
      },
      {
        target: "//projects/apps/node-artifacts:copy_lib",
        relPath: "lib/output.js",
        expected: "hello-node",
      },
      {
        target: "//projects/apps/node-artifacts:copy_bin",
        relPath: "bin/demo.sh",
        expected: "node-bin",
      },
    ] as const;

    for (const c of cases) {
      const { stdout } = await $({
        cwd: tmp,
        env: { ...process.env, BUCK_TARGET: c.target, BUCK_TEST_SRC: tmp },
      })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
      const outPath =
        String(stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop() || "";
      assert.ok(outPath.length > 0, `expected out path for ${c.target}`);
      const targetOut = path.join(outPath, c.relPath);
      assert.equal(await fs.pathExists(targetOut), true, `missing output for ${c.target}`);
      const txt = await fs.readFile(targetOut, "utf8");
      assert.match(txt, new RegExp(c.expected), `unexpected content for ${c.target}`);
    }
  });
});
