#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runRunnable } from "../../dev/run-runnable";
import { runInTemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("dev-mode selected webapp bypasses pnpm-backed generated dev scripts", async () => {
  await runInTemp("runnable-dev-direct-script", async (tmp) => {
    const target = "//projects/apps/demo:app";
    const importer = "projects/apps/demo";
    const graphDir = path.join(tmp, ".viberoots", "workspace", "buck");
    const projectDir = path.join(tmp, importer);
    const fakeOut = path.join(tmp, "fake-selected-out");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.mkdir(path.join(projectDir, "scripts"), { recursive: true });
    await fsp.mkdir(path.join(fakeOut, "dist", "server"), { recursive: true });
    await fsp.mkdir(path.join(fakeOut, "dist", "client"), { recursive: true });
    await fsp.writeFile(
      path.join(projectDir, "scripts", "dev.mjs"),
      "console.error('stale dev script should not run'); process.exit(78);\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(projectDir, "scripts", "dev-wasm-watch.mjs"),
      "console.log('watch-ok');\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(fakeOut, "dist", "server", "index.js"),
      'console.log("server");\n',
      "utf8",
    );
    await fsp.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify(
        [
          {
            name: target,
            rule_type: "nix_node_gen",
            labels: [
              "lang:node",
              "kind:gen",
              "webapp:ssr",
              "framework:vite",
              `lockfile:${importer}/pnpm-lock.yaml#${importer}`,
            ],
            srcs: [],
            deps: [],
            cmd: 'mkdir -p "$OUT/server" "$OUT/client"; printf "console.log(\\\"server\\\")\\n" > "$OUT/server/index.js"',
            out: "dist",
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const selectedCalls: Array<{ workspaceRoot: string; target: string; sourceMode: string }> = [];
    const executed: Array<{ argv: string[]; extra: string[]; cwd?: string }> = [];
    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      await runRunnable({
        argv: ["--mode", "dev", target],
        workspaceRoot: tmp,
        artifactToolsRoot: "/unused-in-injected-test",
        buildSelected: async (workspaceRoot, selectedTarget, sourceMode) => {
          selectedCalls.push({ workspaceRoot, target: selectedTarget, sourceMode });
          return fakeOut;
        },
        executeCommand: async (argv, extra, cwd) => {
          executed.push({ argv, extra, cwd });
          return 0;
        },
      });
      assert.equal(process.exitCode, 0);
    } finally {
      process.exitCode = previousExitCode;
    }

    assert.deepEqual(selectedCalls, [{ workspaceRoot: tmp, target, sourceMode: "auto" }]);
    assert.equal(executed.length, 1);
    assert.deepEqual(executed[0]?.extra, []);
    assert.equal(executed[0]?.cwd, projectDir);
    assert.deepEqual(executed[0]?.argv.slice(0, 2), [
      "zx-wrapper",
      viberootsSourcePath("build-tools/tools/dev/dev-with-wasm-watch.ts"),
    ]);
    assert.deepEqual(executed[0]?.argv.slice(2), [
      "--vite-cmd",
      "node server/dev.mjs",
      "--watch-cmd",
      "node scripts/dev-wasm-watch.mjs",
    ]);
    assert.doesNotMatch(executed[0]?.argv.join(" ") || "", /\bpnpm\b|scripts\/dev\.mjs/);
  });
});
