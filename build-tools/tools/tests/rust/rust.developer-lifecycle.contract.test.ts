#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { directRustDevEnvironment, directRustDevSpec } from "../../dev/run-runnable-dev-spec";
import { runRunnable } from "../../dev/run-runnable";

const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const read = (relative: string) => fs.readFile(path.join(sourceRoot, relative), "utf8");

test("Rust developer tools and quality checks are Nix-owned", async () => {
  const [
    context,
    shell,
    toolchains,
    template,
    evidence,
    quality,
    graph,
    selected,
    policy,
    coverage,
    runner,
  ] = await Promise.all([
    read("build-tools/tools/nix/flake/per-system-context.nix"),
    read("build-tools/tools/nix/devshell.nix"),
    read("build-tools/tools/nix/flake/packages/toolchains.nix"),
    read("build-tools/tools/nix/templates/rust.nix"),
    read("build-tools/tools/nix/templates/rust-evidence-install.nix"),
    read("build-tools/tools/nix/templates/rust-quality.nix"),
    read("build-tools/tools/nix/graph-generator.nix"),
    read("build-tools/tools/dev/build-selected.ts"),
    read("build-tools/tools/lib/artifact-environment-policy.ts"),
    read("build-tools/tools/dev/verify/coverage.ts"),
    read("build-tools/rust/private/nix_test.bzl"),
  ]);

  for (const tool of [
    "rust-analyzer",
    "viberootsCargoLlvmCov",
    "llvmPackages.lldb",
    "llvmPackages.lld",
    '"clippy"',
    '"rustfmt"',
    '"rust-src"',
  ]) {
    assert.match(context, new RegExp(tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(toolchains, /viberootsRustDeveloperTools/);
  for (const variable of [
    "RUST_ANALYZER_PATH",
    "RUSTFMT",
    "RUSTDOC",
    "CARGO_LLVM_COV",
    "RUST_SRC_PATH",
  ]) {
    assert.match(shell, new RegExp(variable));
  }
  assert.match(shell, /rust-tools\.json/);
  assert.match(quality, /cargo fmt --all --check/);
  assert.match(quality, /cargo clippy[\s\S]*-D warnings/);
  assert.match(quality, /cargo test[\s\S]*--doc/);
  assert.match(quality, /cargo test[\s\S]*--benches --no-run/);
  assert.match(quality, /viberootsCargoLlvmCov[\s\S]*cargo llvm-cov[\s\S]*--lcov/);
  assert.match(template, /rust-evidence-install\.nix/);
  assert.match(evidence, /dependency-inventory\.json/);
  assert.match(graph, /coverageEnabled/);
  assert.match(selected, /coverage: getFlagBool\("coverage"\)/);
  for (const variable of [
    "RUST_ANALYZER_PATH",
    "RUSTFMT",
    "RUSTDOC",
    "CARGO_LLVM_COV",
    "RUST_SRC_PATH",
  ]) {
    assert.match(policy, new RegExp(variable));
  }
  assert.match(coverage, /mergeRustLcov/);
  assert.match(runner, /--coverage/);
});

test("Rust direct dev mode is bounded and uses Nix-store tools", async () => {
  const watcher = await read("build-tools/tools/dev/rust-dev-watch.ts");
  const child = await read("build-tools/tools/dev/rust-dev-watch-child.ts");
  const spec = directRustDevSpec(
    "/workspace",
    "//projects/apps/demo:demo",
    "/nix/store/example-artifact-tools",
  );
  assert.equal(spec.argv[0], "/nix/store/example-artifact-tools/bin/zx-wrapper");
  const watcherEnv = directRustDevEnvironment({
    PATH: "/nix/store/tools/bin",
    RUST_WATCH_AMBIENT_SENTINEL: "must-not-reach-build",
    VBR_ARTIFACT_TOOLS_ROOT: "/nix/store/tools",
    VBR_CANONICAL_ARTIFACT_ENTRYPOINT: "1",
  });
  assert.deepEqual(watcherEnv, { PATH: "/nix/store/tools/bin" });
  assert.deepEqual(spec.argv.slice(-4), [
    "--workspace-root",
    "/workspace",
    "--artifact-tools-root",
    "/nix/store/example-artifact-tools",
  ]);
  assert.match(watcher, /target\.slice\(2\)\.split\(":"\)/);
  assert.match(
    watcher,
    /new Set\(\["target", "\.git", "\.viberoots", "buck-out", "node_modules"\]\)/,
  );
  assert.match(watcher, /process\.kill\(-child\.pid!, signal\)/);
  assert.match(watcher, /const signals = \["SIGINT", "SIGTERM", "SIGHUP"\]/);
  assert.match(watcher, /for \(const signal of signals\) process\.once\(signal, shutdown\)/);
  assert.match(
    watcher,
    /spawn\(childWrapper, \[childRunner, "--source=path", target, \.\.\.passthrough\]/,
  );
  const runnable = await read("build-tools/tools/dev/run-runnable.ts");
  assert.doesNotMatch(runnable, /allowedDevOverrideNames/);
  assert.match(runnable, /withoutCanonicalDevOverrideArgs\(opts\.argv\)/);
  assert.match(runnable, /allowDevOverrides: true,[\s\S]*?stripAmbientArtifactInfluence: true/);
  assert.match(
    runnable,
    /directRustDevSpec\(workspaceRoot, target, artifactToolsRoot, canonicalOverrideArg\)/,
  );
  assert.match(
    runnable,
    /sanitizeRustWatcherEnvironment \? directRustDevEnvironment\(\) : undefined/,
  );
  const runnableSource = await read("build-tools/tools/dev/run-runnable-source.ts");
  assert.match(runnableSource, /selectorEnv: baseEnv/);
  assert.match(watcher, /evaluationBundleDevOverrides\(argv, \{\}\)/);
  assert.match(child, /allowedDevOverrideNames: \[devOverrideEnvNameForLang\("rust"\)\]/);
  assert.match(child, /argv: \["--mode", "prod", \.\.\.getArgvTokens\(\)\]/);
});

test("Rust scaffold inventory covers the supported PR-10 shapes", async () => {
  const resolver = JSON.parse(await read("build-tools/tools/scaffolding/resolver.json")) as Record<
    string,
    Record<string, string>
  >;
  assert.deepEqual(Object.keys(resolver.rust).sort(), [
    "cli",
    "cross-root",
    "cxx-bridge",
    "lib",
    "node-addon",
    "proc-macro",
    "python-extension",
    "tauri-app",
    "wasm",
  ]);
  const expectedMacros = {
    cli: "rust_binary",
    lib: "rust_library",
    "proc-macro": "rust_proc_macro",
    "python-extension": "rust_python_extension",
    "node-addon": "rust_node_addon",
    "cxx-bridge": "rust_cxx_bridge_library",
    "tauri-app": "tauri_app",
    wasm: "rust_wasm_library",
  };
  for (const [shape, macro] of Object.entries(expectedMacros)) {
    const targets = await read(
      `build-tools/tools/scaffolding/templates/rust/${shape}/TARGETS.jinja`,
    );
    assert.match(targets, new RegExp(`${macro}\\(`));
    await fs.access(
      path.join(
        sourceRoot,
        `build-tools/tools/scaffolding/templates/rust/${shape}/Cargo.toml.jinja`,
      ),
    );
    await fs.access(
      path.join(
        sourceRoot,
        `build-tools/tools/scaffolding/templates/rust/${shape}/Cargo.lock.jinja`,
      ),
    );
  }
});

test("non-runnable Rust shapes reject before selected artifact realization", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "rust-run-reject-"));
  const graphPath = path.join(root, ".viberoots/workspace/buck/graph.json");
  const targets = [
    ["//projects/libs/demo_lib:demo_lib", "lib"],
    ["//projects/libs/demo_macro:demo_macro", "lib"],
    ["//projects/libs/demo_python:demo_python", "pyext"],
    ["//projects/libs/demo_node:demo_node", "addon"],
    ["//projects/libs/demo_cxx:demo_cxx", "lib"],
    ["//projects/libs/demo_wasm:demo_wasm", "wasm"],
  ] as const;
  await fs.mkdir(path.dirname(graphPath), { recursive: true });
  await fs.writeFile(
    graphPath,
    `${JSON.stringify(
      targets.map(([name, kind]) => ({
        name,
        labels: ["lang:rust", `kind:${kind}`],
      })),
    )}\n`,
  );

  const originalExit = process.exit;
  const originalError = console.error;
  let selectedBuilds = 0;
  const diagnostics: string[] = [];
  class ExpectedExit extends Error {
    readonly code: number;

    constructor(code: number) {
      super(`exit ${code}`);
      this.code = code;
    }
  }
  try {
    process.exit = ((code?: number): never => {
      throw new ExpectedExit(Number(code || 0));
    }) as typeof process.exit;
    console.error = (...args: unknown[]) => diagnostics.push(args.map(String).join(" "));
    for (const [target] of targets) {
      await assert.rejects(
        runRunnable({
          argv: ["--mode", "prod", target],
          workspaceRoot: root,
          artifactToolsRoot: "/nix/store/unavailable-artifact-tools",
          buildSelected: async () => {
            selectedBuilds++;
            throw new Error("hostile selected build must not execute");
          },
        }),
        (error: unknown) => error instanceof ExpectedExit && error.code === 2,
      );
    }
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    await fs.rm(root, { recursive: true, force: true });
  }
  assert.equal(selectedBuilds, 0);
  assert.equal(diagnostics.length, targets.length);
  for (const diagnostic of diagnostics) assert.match(diagnostic, /target is not runnable/u);
});
