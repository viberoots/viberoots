#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import { makeConsumer, makeRemoteSource } from "../viberoots/remote-consumer-fixture-helpers";

process.env.TEST_NEED_DEV_ENV = "1";

test(
  "Rust scaffold shapes complete a fresh consumer lifecycle",
  { timeout: 1_200_000 },
  async () => {
    await runInScratchTemp("rust-shapes-scaffold-lifecycle", async (tmp, $) => {
      const source = await makeRemoteSource(tmp, $);
      const consumer = await makeConsumer(tmp, "rust-shapes-consumer", source, $);
      try {
        const workspaceFlake = path.join(consumer, ".viberoots", "workspace");
        for (let attempt = 0; attempt < 2; attempt++) {
          await $({
            cwd: consumer,
            env: { ...process.env, WORKSPACE_ROOT: consumer },
            stdio: "pipe",
          })`nix run --option eval-cache false --accept-flake-config path:${workspaceFlake}#viberoots -- init-workspace`;
        }
        const sourcePath = await fs.realpath(path.join(consumer, ".viberoots", "current"));
        const lifecycleEnv = (extra: NodeJS.ProcessEnv = {}) => commandEnv(consumer, extra);
        const shapes = [
          ["lib", "rust_lib"],
          ["proc-macro", "rust_macro"],
          ["python-extension", "rust_python"],
          ["node-addon", "rust_node"],
          ["cxx-bridge", "rust_cxx"],
          ["wasm", "rust_wasm"],
        ] as const;
        for (const [shape, name] of shapes) {
          await $({ cwd: consumer, env: lifecycleEnv() })`
            scaf new rust ${shape} ${name} --yes
          `;
        }
        await $({ cwd: consumer, env: lifecycleEnv() })`git config user.email test@example.com`;
        await $({ cwd: consumer, env: lifecycleEnv() })`git config user.name test`;
        await $({ cwd: consumer, env: lifecycleEnv() })`git add projects/libs`;
        await $({ cwd: consumer, env: lifecycleEnv() })`git commit -m rust-shapes`;

        await $({
          cwd: consumer,
          env: lifecycleEnv({ VIBEROOTS_FLAKE_INPUT_ROOT: sourcePath }),
        })`u`;
        await $({ cwd: consumer, env: lifecycleEnv() })`i --without-secrets`;
        const buildTargets = [
          "//projects/libs/rust_lib:rust_lib",
          "//projects/libs/rust_macro:rust_macro",
          "//projects/libs/rust_python:rust_python",
          "//projects/libs/rust_node:rust_node",
          "//projects/libs/rust_cxx:rust_cxx",
          "//projects/libs/rust_wasm:rust_wasm",
          "//projects/libs/rust_wasm:rust_wasm-wasi",
        ];
        await $({ cwd: consumer, env: lifecycleEnv() })`b ${buildTargets}`;
        const verifyEnv = lifecycleEnv();
        await $({ cwd: consumer, env: verifyEnv })`
          v --seed-mode=never //projects/libs/rust_lib:rust_lib-test
        `;
        await $({ cwd: consumer, env: verifyEnv })`
          v --seed-mode=never --coverage //projects/libs/rust_lib:rust_lib-test
        `;
        const summaryPath = path.join(consumer, "coverage", "coverage-summary.json");
        const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
        const rustEntry = Object.keys(summary).find((key) =>
          key.endsWith("/projects/libs/rust_lib/src/lib.rs"),
        );
        assert.ok(rustEntry, "real Rust LCOV must reach the published summary");
        assert.ok(summary[rustEntry].lines.covered > 0);
        const html = await fs.readFile(path.join(consumer, "coverage", "index.html"), "utf8");
        assert.match(html, /projects\/libs\/rust_lib\/src\/lib\.rs/);

        await fs.writeFile(
          path.join(consumer, "projects/libs/rust_lib/src/lib.rs"),
          `pub fn answer() -> i32 {
    43
}

#[cfg(test)]
mod tests {
    #[test]
    fn answers() {
        assert_eq!(super::answer(), 42);
    }
}
`,
        );
        const changedSourceFailure = await $({
          cwd: consumer,
          env: verifyEnv,
          stdio: "pipe",
          reject: false,
          nothrow: true,
        })`v --seed-mode=never //projects/libs/rust_lib:rust_lib-test`;
        assert.notEqual(changedSourceFailure.exitCode, 0);
        const changedSourceOutput = `${String(changedSourceFailure.stdout)}\n${String(
          changedSourceFailure.stderr,
        )}`;
        assert.match(changedSourceOutput, /rust_lib-test/u);
        const failureLogPath = changedSourceOutput.match(/- log (.+\.log)/u)?.[1]?.trim();
        assert.ok(failureLogPath, "focused verify failure must report its detailed log");
        const failureLog = await fs.readFile(failureLogPath, "utf8");
        assert.match(failureLog, /assertion.*failed/u);
        assert.match(failureLog, /left:\s*43[\s\S]*right:\s*42/u);

        const changedSource = path.join(consumer, "projects/libs/rust_lib/src/lib.rs");
        await fs.writeFile(
          changedSource,
          (await fs.readFile(changedSource, "utf8")).replace(
            "assert_eq!(super::answer(), 42)",
            "assert_eq!(super::answer(), 43)",
          ),
        );
        await $({ cwd: consumer, env: verifyEnv })`
          v --seed-mode=never //projects/libs/rust_lib:rust_lib-test
        `;
        const notRunnable = await $({
          cwd: consumer,
          env: lifecycleEnv(),
          stdio: "pipe",
          reject: false,
          nothrow: true,
        })`p //projects/libs/rust_lib:rust_lib`;
        assert.notEqual(notRunnable.exitCode, 0);
        assert.match(String(notRunnable.stderr), /not available|not runnable|no runnable/u);
      } finally {
        await killBuckDaemonsForRepo(tmp, $);
      }
    });
  },
);
