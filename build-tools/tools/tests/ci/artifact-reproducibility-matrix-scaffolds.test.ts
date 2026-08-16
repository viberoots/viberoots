import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ARTIFACT_REPRODUCIBILITY_MATRIX } from "../../lib/artifact-reproducibility-matrix";
import { VIBEROOTS_SOURCE_ROOT, viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function ownedScaffoldLeaks(root: string): Promise<string[]> {
  try {
    return (await fs.readdir(root)).filter((name) => name.startsWith("pr12-scaf."));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

test("every matrix recipe binds the target emitted by its actual scaffold template", async () => {
  const contracts = [
    ["go-lib", "go/lib/TARGETS.jinja", "projects/libs/repro-go", "repro-go"],
    ["node-artifact", "ts/lib/TARGETS.jinja", "projects/libs/repro-node", "repro-node"],
    ["python-artifact", "python/app/TARGETS.jinja", "projects/apps/repro-python", "repro-python"],
    ["cpp-lib", "cpp/lib/TARGETS.jinja", "projects/libs/repro-cpp", "repro-cpp"],
    ["wasm-artifact", "python/wasm-lib/TARGETS.jinja", "projects/libs/repro-wasm", "repro-wasm"],
    ["rust-pr5", "rust/cli/TARGETS.jinja", "projects/apps/repro-rust", "repro-rust"],
    [
      "rust-test-pr12",
      "rust/cli/TARGETS.jinja",
      "projects/apps/repro-rust-test",
      "repro-rust-test-test",
    ],
    ["rust-lib-pr12", "rust/lib/TARGETS.jinja", "projects/libs/repro-rust-lib", "repro-rust-lib"],
    [
      "rust-static-library-pr12",
      "rust/lib/TARGETS.jinja",
      "projects/libs/repro-rust-static",
      "repro-rust-static-static",
    ],
    [
      "rust-cdylib-pr12",
      "rust/lib/TARGETS.jinja",
      "projects/libs/repro-rust-dynamic",
      "repro-rust-dynamic-dynamic",
    ],
    [
      "rust-proc-macro-pr12",
      "rust/proc-macro/TARGETS.jinja",
      "projects/libs/repro-rust-proc-macro",
      "repro-rust-proc-macro",
    ],
    [
      "rust-python-extension-pr12",
      "rust/python-extension/TARGETS.jinja",
      "projects/libs/repro-rust-python",
      "repro-rust-python",
    ],
    [
      "rust-pyodide-extension-pr14",
      "rust/pyodide-extension/TARGETS.jinja",
      "projects/apps/repro-rust-pyodide",
      "repro-rust-pyodide",
    ],
    [
      "rust-node-addon-pr12",
      "rust/node-addon/TARGETS.jinja",
      "projects/libs/repro-rust-node",
      "repro-rust-node",
    ],
    [
      "rust-c-ffi-pr12",
      "rust/cxx-bridge/TARGETS.jinja",
      "projects/libs/repro-rust-c-ffi",
      "repro-rust-c-ffi-c",
    ],
    [
      "rust-cxx-bridge-pr12",
      "rust/cxx-bridge/TARGETS.jinja",
      "projects/libs/repro-rust-cxx",
      "repro-rust-cxx",
    ],
    [
      "rust-wasm-pr12",
      "rust/wasm/TARGETS.jinja",
      "projects/libs/repro-rust-wasm",
      "repro-rust-wasm",
    ],
    [
      "rust-wasi-pr12",
      "rust/wasm/TARGETS.jinja",
      "projects/libs/repro-rust-wasi",
      "repro-rust-wasi-wasi",
    ],
    [
      "rust-wasm-static-pr12",
      "rust/wasm/TARGETS.jinja",
      "projects/libs/repro-rust-wasm-static",
      "repro-rust-wasm-static-static",
    ],
    [
      "rust-wasi-static-pr12",
      "rust/wasm/TARGETS.jinja",
      "projects/libs/repro-rust-wasi-static",
      "repro-rust-wasi-static-wasi-static",
    ],
    [
      "rust-wasm-browser-pr12",
      "rust/wasm/TARGETS.jinja",
      "projects/libs/repro-rust-wasm-browser",
      "repro-rust-wasm-browser-browser",
    ],
    [
      "rust-wasm-component-pr12",
      "rust/wasm/TARGETS.jinja",
      "projects/libs/repro-rust-wasm-component",
      "repro-rust-wasm-component-component",
    ],
    [
      "rust-cross-root-pr12",
      "rust/cross-root/libs/{{ name }}-app/TARGETS.jinja",
      "projects",
      "repro-rust-cross-app",
    ],
    [
      "rust-tauri-darwin-pr12",
      "rust/tauri-app/TARGETS.jinja",
      "projects/apps/repro-rust-tauri",
      "repro-rust-tauri",
    ],
    [
      "mixed-artifact",
      "ts/go-cpp-lib/libs/{{ name }}-ts/TARGETS.jinja",
      "projects",
      "{{ name }}_ts_pkg",
    ],
  ] as const;
  for (const [id, template, destination, targetName] of contracts) {
    const entry = ARTIFACT_REPRODUCIBILITY_MATRIX.find((candidate) => candidate.id === id)!;
    assert.equal(entry.scaffoldRecipe.destination, destination);
    const expectedTargetPath =
      id === "mixed-artifact"
        ? `//${destination}/libs/${entry.scaffoldRecipe.name}-ts:${entry.scaffoldRecipe.name}_ts_pkg`
        : id === "rust-cross-root-pr12"
          ? `//projects/libs/${entry.scaffoldRecipe.name}-app:${targetName}`
          : `//${destination}:${targetName}`;
    assert.equal(entry.graphSelection.target, expectedTargetPath);
    const targets = await fs.readFile(
      viberootsSourcePath(`build-tools/tools/scaffolding/templates/${template}`),
      "utf8",
    );
    const templateTargetName =
      id === "mixed-artifact"
        ? targetName
        : targetName.replace(entry.scaffoldRecipe.name, "{{ name }}");
    assert.ok(targets.includes(`name = ${JSON.stringify(templateTargetName)}`));
  }
  const cppTargets = await fs.readFile(
    viberootsSourcePath("build-tools/tools/scaffolding/templates/cpp/lib/TARGETS.jinja"),
    "utf8",
  );
  assert.equal(cppTargets.match(/nix_cpp_library\(/gu)?.length, 1);
  assert.equal(cppTargets.match(/nix_cpp_test\(/gu)?.length, 1);
});

test("Rust interop scaffold separates C and identifier-safe C++ binding configs", async () => {
  const cxxTemplate = await fs.readFile(
    viberootsSourcePath(
      "build-tools/tools/scaffolding/templates/rust/cxx-bridge/bindings.json.jinja",
    ),
    "utf8",
  );
  const cTemplate = await fs.readFile(
    viberootsSourcePath(
      "build-tools/tools/scaffolding/templates/rust/cxx-bridge/bindings-c.json.jinja",
    ),
    "utf8",
  );
  const targets = await fs.readFile(
    viberootsSourcePath("build-tools/tools/scaffolding/templates/rust/cxx-bridge/TARGETS.jinja"),
    "utf8",
  );
  assert.match(cxxTemplate, /name \| replace\("-", "_"\)/);
  assert.doesNotMatch(cTemplate, /namespace/);
  assert.match(targets, /rust_c_ffi_library\([\s\S]*binding_config = "bindings-c\.json"/);
});

test("cross-root scaffold inspection uses system temp and cannot leak Buck targets", async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pr12-scaf."));
  const buckRoots = [
    process.env.WORKSPACE_ROOT,
    process.cwd(),
    path.join(path.dirname(VIBEROOTS_SOURCE_ROOT), ".viberoots", "workspace"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const root of buckRoots) {
    assert.equal(path.relative(root, scratch).startsWith(".."), true);
  }
  try {
    const rendered = path.join(scratch, "projects");
    await fs.cp(
      viberootsSourcePath("build-tools/tools/scaffolding/templates/rust/cross-root"),
      rendered,
      { recursive: true },
    );
    const appTargets = await fs.readFile(
      path.join(rendered, "libs", "{{ name }}-app", "TARGETS.jinja"),
      "utf8",
    );
    const coreTargets = await fs.readFile(
      path.join(rendered, "libs", "{{ name }}-core", "TARGETS.jinja"),
      "utf8",
    );
    const appCargo = await fs.readFile(
      path.join(rendered, "libs", "{{ name }}-app", "Cargo.toml.jinja"),
      "utf8",
    );
    assert.match(appTargets, /deps = \["\/\/projects\/libs\/\{\{ name \}\}-core:/u);
    assert.match(coreTargets, /visibility = \["PUBLIC"\]/u);
    assert.match(
      appCargo,
      /\{\{ name \| replace\("-", "_"\) \}\}_core = \{ package = "\{\{ name \}\}-core"/u,
    );
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
  await assert.rejects(fs.stat(scratch), { code: "ENOENT" });
  for (const root of buckRoots) {
    assert.deepEqual(await ownedScaffoldLeaks(root), []);
  }
});
