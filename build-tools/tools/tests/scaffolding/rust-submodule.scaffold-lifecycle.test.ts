#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import { makeConsumer, makeRemoteSource } from "../viberoots/remote-consumer-fixture-helpers";
import { stopWatcher, waitForOutput, waitForOutputCount } from "./rust-watch-lifecycle-helpers";

process.env.TEST_NEED_DEV_ENV = "1";

test(
  "every Rust scaffold shape completes its documented submodule lifecycle",
  { timeout: 1_200_000 },
  async () => {
    await runInScratchTemp("rust-submodule-scaffold-lifecycle", async (tmp, $) => {
      const source = await makeRemoteSource(tmp, $);
      const consumer = await makeConsumer(tmp, "rust-submodule-consumer", source, $);
      let watcher: ChildProcess | undefined;
      try {
        const workspaceFlake = path.join(consumer, ".viberoots", "workspace");
        const pinnedConsumerLock = JSON.parse(
          await fs.readFile(path.join(workspaceFlake, "flake.lock"), "utf8"),
        );
        const pinnedRoot = pinnedConsumerLock.nodes[pinnedConsumerLock.root];
        pinnedRoot.inputs = {
          ...pinnedRoot.inputs,
          buck2: "buck2",
          gomod2nix: "gomod2nix",
          nixpkgs: "nixpkgs_2",
          nixpkgs_23_11: "nixpkgs_23_11",
        };
        pinnedConsumerLock.nodes.nixpkgs_23_11 = {
          locked: {
            lastModified: 1720535198,
            narHash: "sha256-zwVvxrdIzralnSbcpghA92tWu2DV2lwv89xZc8MTrbg=",
            owner: "NixOS",
            repo: "nixpkgs",
            rev: "205fd4226592cc83fd4c0885a3e4c9c400efabb5",
            type: "github",
          },
          original: {
            owner: "NixOS",
            ref: "nixos-23.11",
            repo: "nixpkgs",
            type: "github",
          },
        };
        await $({
          cwd: consumer,
          env: {
            ...process.env,
            GIT_ALLOW_PROTOCOL: "file",
            WORKSPACE_ROOT: consumer,
            VBR_NIX_CACHE_POLICY: "off",
          },
          stdio: "pipe",
        })`nix run --accept-flake-config path:${workspaceFlake}#viberoots -- use-submodule --workspace-root ${consumer} --url file://${source} --trust-url --no-direnv`;

        assert.match(
          await fs.readFile(path.join(consumer, ".gitmodules"), "utf8"),
          /file:\/\/\/nix\/store\//,
        );
        assert.equal(
          await fs.realpath(path.join(consumer, ".viberoots", "current")),
          path.join(consumer, "viberoots"),
        );
        assert.match(
          await fs.readFile(path.join(workspaceFlake, "flake.nix"), "utf8"),
          /path:\.\/viberoots-flake-input/,
        );

        // Keep the fresh fixture's reviewed dependency pins while init-consumer replaces only
        // the viberoots input with the checked-out submodule's filtered source.
        await fs.writeFile(
          path.join(workspaceFlake, "flake.lock"),
          `${JSON.stringify(pinnedConsumerLock, null, 2)}\n`,
        );
        await $({
          cwd: consumer,
          env: {
            ...commandEnv(consumer),
            GIT_ALLOW_PROTOCOL: "file",
            VBR_NIX_CACHE_POLICY: "off",
          },
        })`viberoots init-consumer --mode submodule --workspace-root ${consumer} --source viberoots --no-direnv`;
        for (let attempt = 0; attempt < 2; attempt++) {
          await $({
            cwd: consumer,
            env: { ...process.env, WORKSPACE_ROOT: consumer, VBR_NIX_CACHE_POLICY: "off" },
            stdio: "pipe",
          })`nix run --accept-flake-config path:${workspaceFlake}#viberoots -- init-workspace`;
        }
        const filteredInput = path.join(workspaceFlake, "viberoots-flake-input");
        await fs.access(path.join(filteredInput, ".source-fingerprint"));
        assert.equal(
          await fs.readFile(path.join(filteredInput, "build-tools/tools/dev/viberoots.ts"), "utf8"),
          await fs.readFile(
            path.join(consumer, "viberoots/build-tools/tools/dev/viberoots.ts"),
            "utf8",
          ),
        );
        const sourcePrelude = await fs.realpath(path.join(consumer, "viberoots/prelude"));
        await fs.rm(path.join(workspaceFlake, "prelude"), { force: true });
        await fs.symlink(sourcePrelude, path.join(workspaceFlake, "prelude"));
        await fs.access(path.join(workspaceFlake, "prelude/prelude.bzl"));
        await fs.rm(path.join(consumer, ".envrc"), { force: true });
        const lifecycleEnv = (extra: NodeJS.ProcessEnv = {}) => ({
          ...commandEnv(consumer, extra),
          VBR_NIX_CACHE_POLICY: "off",
        });
        const shapes = [
          ["cli", "rust_sub_cli"],
          ["lib", "rust_sub_lib"],
          ["proc-macro", "rust_sub_macro"],
          ["python-extension", "rust_sub_python"],
          ["node-addon", "rust_sub_node"],
          ["cxx-bridge", "rust_sub_cxx"],
          ["wasm", "rust_sub_wasm"],
        ] as const;
        for (const [shape, name] of shapes) {
          await $({ cwd: consumer, env: lifecycleEnv() })`scaf new rust ${shape} ${name} --yes`;
        }
        const cliMain = path.join(consumer, "projects/apps/rust_sub_cli/src/main.rs");
        await fs.writeFile(
          cliMain,
          (await fs.readFile(cliMain, "utf8")).replace(
            'println!("hello from rust_sub_cli");',
            `println!(
        "hello from rust_sub_cli ambient={}",
        option_env!("RUST_WATCH_AMBIENT_SENTINEL").unwrap_or("absent")
    );`,
          ),
        );
        await $({ cwd: consumer, env: lifecycleEnv() })`git config user.email test@example.com`;
        await $({ cwd: consumer, env: lifecycleEnv() })`git config user.name test`;
        await $({ cwd: consumer, env: lifecycleEnv() })`git add projects .gitmodules viberoots`;
        await $({ cwd: consumer, env: lifecycleEnv() })`git commit -m rust-submodule-shapes`;

        await $({ cwd: consumer, env: lifecycleEnv() })`u`;
        await $({ cwd: consumer, env: lifecycleEnv() })`i --without-secrets`;

        const buildTargets = [
          "//projects/apps/rust_sub_cli:rust_sub_cli",
          "//projects/libs/rust_sub_lib:rust_sub_lib",
          "//projects/libs/rust_sub_macro:rust_sub_macro",
          "//projects/libs/rust_sub_python:rust_sub_python",
          "//projects/libs/rust_sub_node:rust_sub_node",
          "//projects/libs/rust_sub_cxx:rust_sub_cxx",
          "//projects/libs/rust_sub_wasm:rust_sub_wasm",
          "//projects/libs/rust_sub_wasm:rust_sub_wasm-wasi",
        ];
        // The Python and Node extension derivations import the produced module during install,
        // so this successful build is also an actual extension-import smoke test.
        await $({ cwd: consumer, env: lifecycleEnv() })`b ${buildTargets}`;
        await $({ cwd: consumer, env: lifecycleEnv() })`
          v //projects/apps/rust_sub_cli:rust_sub_cli-test
        `;
        await $({ cwd: consumer, env: lifecycleEnv() })`
          v //projects/libs/rust_sub_lib:rust_sub_lib-test
        `;

        const run = await $({ cwd: consumer, env: lifecycleEnv() })`
          p //projects/apps/rust_sub_cli:rust_sub_cli
        `;
        assert.match(String(run.stdout), /hello from rust_sub_cli/);

        const override = path.join(tmp, "rust-override");
        await fs.mkdir(override);
        const overrideSource = path.join(override, "lib.rs");
        await fs.writeFile(overrideSource, "pub fn override_value() -> u8 { 1 }\n");
        const overrideJson = JSON.stringify({
          "unused@1.0.0#registry+https://example.invalid/index": override,
        });
        const rejectedProd = await $({
          cwd: consumer,
          env: lifecycleEnv({ NIX_RUST_DEV_OVERRIDE_JSON: overrideJson }),
          stdio: "pipe",
          reject: false,
          nothrow: true,
        })`p //projects/apps/rust_sub_cli:rust_sub_cli --rust-watch-child-ingress`;
        assert.notEqual(rejectedProd.exitCode, 0);
        assert.match(String(rejectedProd.stderr), /does not admit development overrides/u);

        let watcherOutput = "";
        watcher = spawn(
          path.join(consumer, ".viberoots", "current", "build-tools", "tools", "bin", "d"),
          ["//projects/apps/rust_sub_cli:rust_sub_cli"],
          {
            cwd: consumer,
            env: lifecycleEnv({
              NIX_RUST_DEV_OVERRIDE_JSON: overrideJson,
              RUST_WATCH_AMBIENT_SENTINEL: "must-not-reach-build",
            }),
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        watcher.stdout?.on("data", (chunk) => (watcherOutput += String(chunk)));
        watcher.stderr?.on("data", (chunk) => (watcherOutput += String(chunk)));
        await waitForOutput(watcher, () => watcherOutput, /\[rust-watch\] spawn/u);
        await waitForOutput(
          watcher,
          () => watcherOutput,
          /Rust fixed sources are explicit local-development bundle inputs/u,
        );
        await waitForOutput(watcher, () => watcherOutput, /hello from rust_sub_cli/u);
        assert.match(watcherOutput, /ambient=absent/u);
        assert.doesNotMatch(watcherOutput, /must-not-reach-build/u);
        await fs.writeFile(overrideSource, "pub fn override_value() -> u8 { 2 }\n");
        await waitForOutputCount(watcher, () => watcherOutput, /\[rust-watch\] spawn/u, 2);
        await waitForOutputCount(watcher, () => watcherOutput, /hello from rust_sub_cli/u, 2);
        await stopWatcher(watcher);
        watcher = undefined;

        const libraryTargets = buildTargets.slice(1).filter((target) => !target.endsWith("-wasi"));
        for (const target of libraryTargets) {
          for (const command of ["p", "d"] as const) {
            const result = await $({
              cwd: consumer,
              env: lifecycleEnv(),
              stdio: "pipe",
              reject: false,
              nothrow: true,
            })`${command} ${target}`;
            assert.notEqual(result.exitCode, 0, `${command} unexpectedly ran ${target}`);
            assert.match(
              `${String(result.stdout)}\n${String(result.stderr)}`,
              /not available|not runnable|library-only|no runnable/u,
            );
          }
        }
      } finally {
        if (watcher) await stopWatcher(watcher);
        await killBuckDaemonsForRepo(tmp, $);
      }
    });
  },
);
