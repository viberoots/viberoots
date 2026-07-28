import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { GRAPH_PACKAGE_FILES_IN_SNAPSHOT } from "../../dev/source-snapshot-policy";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { inheritedBuckIsolation } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import {
  assertMaterializedTreeMatchesStore,
  parseBuckOutputs,
  verifyDeclaredToolClosure,
  verifyRemoteOutputs,
} from "./rust-wasm-remote-assertions";

const remoteNames = [
  "remote_static",
  "remote_wasi_static",
  "remote_browser",
  "remote_component",
  "remote_wasi_component",
] as const;

export async function verifyRustWasmRemoteReadiness(
  tmp: string,
  command: any,
  _current: string,
  _tools: string,
): Promise<void> {
  const labels = remoteNames.map((name) => `//projects/apps/rust-wasm:${name}`);
  const hostileBin = path.join(tmp, "rust-wasm-hostile-bin");
  await fs.mkdir(hostileBin, { recursive: true });
  for (const tool of ["cargo", "rustc", "nix", "wasm-tools", "wasmtime"]) {
    const executable = path.join(hostileBin, tool);
    await fs.writeFile(executable, `#!/bin/sh\necho hostile-${tool} >&2\nexit 97\n`);
    await fs.chmod(executable, 0o755);
  }
  const hostileEnv = {
    ...process.env,
    PATH: `${hostileBin}${path.delimiter}${String(process.env.PATH || "")}`,
    CARGO_HOME: path.join(tmp, "hostile-cargo-home"),
    RUSTUP_HOME: path.join(tmp, "hostile-rustup-home"),
    RUSTFLAGS: "-C link-arg=/definitely/host-only",
    NODE_OPTIONS: "",
    VIBEROOTS_ROOT: "",
    VIBEROOTS_SOURCE_ROOT: "",
    ZX_INIT: "",
  };
  const remoteIsolation = inheritedBuckIsolation("rust_wasm_remote");
  await command({
    cwd: tmp,
    env: hostileEnv,
    stdio: "pipe",
  })`buck2 --isolation-dir ${remoteIsolation} kill`;

  for (const label of labels) {
    const actionQuery = `deps(${label})`;
    const analysis = String(
      (
        await command({
          cwd: tmp,
          env: hostileEnv,
          stdio: "pipe",
        })`buck2 --isolation-dir ${remoteIsolation} aquery --output-all-attributes --target-platforms prelude//platforms:default ${actionQuery}`
      ).stdout,
    );
    assert.match(analysis, /rust_nix_build_remote_action_policy_remote_ready/);
    const providers = String(
      (
        await command({
          cwd: tmp,
          env: hostileEnv,
          stdio: "pipe",
        })`buck2 --isolation-dir ${remoteIsolation} audit providers --print-debug --target-platforms prelude//platforms:default ${label}`
      ).stdout,
    );
    assert.match(providers, /NixRemoteActionPolicyInfo/);
    assert.match(providers, /remote-action-policy:remote-ready|builder_policy.*inherit_config/s);
  }

  const built = await command({
    cwd: tmp,
    env: hostileEnv,
    stdio: "pipe",
  })`buck2 --isolation-dir ${remoteIsolation} build --target-platforms prelude//platforms:default --show-full-output ${labels}`;
  const buckOutputs = parseBuckOutputs(String(built.stdout), tmp, labels);
  assert.equal(buckOutputs.size, labels.length, String(built.stdout));
  await verifyRemoteOutputs(command, buckOutputs);
  const declaredToolClosure = JSON.parse(
    await fs.readFile(
      path.join(tmp, "projects/apps/rust-wasm/remote-evidence/tool-closure.json"),
      "utf8",
    ),
  );
  const buckSourceRevisions = new Map<string, string>();
  const buckStorePaths = new Map<string, string>();
  for (const [label, output] of buckOutputs) {
    const materialization = JSON.parse(
      await fs.readFile(
        path.join(output, "share/viberoots-rust/materialization-manifest.json"),
        "utf8",
      ),
    );
    const storePath = materialization.storePaths?.find(
      (entry: { path?: string }) => typeof entry.path === "string",
    );
    assert.match(storePath?.path, /^\/nix\/store\//);
    assert.equal(storePath?.expectedOutputIdentity, path.basename(storePath.path));
    assert.match(materialization.sourceRevision, /^[0-9a-f]{64}$/);
    assert.match(materialization.tools?.nix, /^\/nix\/store\//);
    await fs.access(path.join(materialization.tools.nix, "bin/nix"));
    await assertMaterializedTreeMatchesStore(output, storePath.path);
    await verifyDeclaredToolClosure(output, declaredToolClosure);
    buckSourceRevisions.set(label, materialization.sourceRevision);
    buckStorePaths.set(label, storePath.path);
  }

  const executionSnapshot = path.join(tmp, "rust-wasm-remote-execution-snapshot");
  const executionManifest = path.join(tmp, "rust-wasm-remote-execution-snapshot.json");
  const graphPackageArgs = GRAPH_PACKAGE_FILES_IN_SNAPSHOT.flatMap((relative) => [
    "--file",
    relative,
    path.join(tmp, relative),
  ]);
  graphPackageArgs.push("--file", ".buckroot", path.join(tmp, ".buckroot"));
  graphPackageArgs.push("--file", ".buckconfig", path.join(tmp, ".buckconfig"));
  await command({
    cwd: tmp,
    env: hostileEnv,
    stdio: "pipe",
  })`zx-wrapper ${viberootsSourcePath("viberoots/build-tools/tools/dev/source-snapshot.ts")} --workspace-root ${tmp} --tree ${tmp} --out ${executionSnapshot} --manifest ${executionManifest} --graph ${path.join(tmp, DEFAULT_GRAPH_PATH)} --declared-root ${executionSnapshot} --declared-graph ${path.join(executionSnapshot, DEFAULT_GRAPH_PATH)} ${graphPackageArgs}`;
  const snapshotEvidence = JSON.parse(await fs.readFile(executionManifest, "utf8"));
  assert.equal(snapshotEvidence.declaredSnapshotRoot, executionSnapshot);
  assert.equal(snapshotEvidence.graphPathInSnapshot, DEFAULT_GRAPH_PATH);
  assert.ok(snapshotEvidence.files.includes(".buckroot"));
  assert.ok(snapshotEvidence.files.includes(".buckconfig"));
  for (const relative of GRAPH_PACKAGE_FILES_IN_SNAPSHOT) {
    assert.ok(snapshotEvidence.files.includes(relative));
  }

  const ownerSource = path.join(tmp, "projects/apps/rust-wasm/src/lib.rs");
  const originalSource = await fs.readFile(ownerSource);
  await fs.writeFile(ownerSource, 'compile_error!("ambient owner source must not be consumed");\n');
  try {
    const replayBuild = await command({
      cwd: executionSnapshot,
      env: hostileEnv,
      stdio: "pipe",
    })`buck2 --isolation-dir ${inheritedBuckIsolation("rust_wasm_remote_snapshot_replay")} build --target-platforms prelude//platforms:default --show-full-output ${labels}`;
    const replayOutputs = parseBuckOutputs(String(replayBuild.stdout), executionSnapshot, labels);
    assert.equal(replayOutputs.size, labels.length, String(replayBuild.stdout));
    for (const [label, replayOutput] of replayOutputs) {
      const replayMaterialization = JSON.parse(
        await fs.readFile(
          path.join(replayOutput, "share/viberoots-rust/materialization-manifest.json"),
          "utf8",
        ),
      );
      assert.equal(
        replayMaterialization.sourceRevision,
        buckSourceRevisions.get(label),
        `${label} selected a different source revision from the immutable snapshot`,
      );
      assert.equal(
        replayMaterialization.storePaths[0]?.path,
        buckStorePaths.get(label),
        `${label} changed its declared store identity in the immutable snapshot`,
      );
      await verifyDeclaredToolClosure(replayOutput, declaredToolClosure);
    }
    await verifyRemoteOutputs(command, replayOutputs);
    const repeatedBuild = await command({
      cwd: executionSnapshot,
      env: hostileEnv,
      stdio: "pipe",
    })`buck2 --isolation-dir ${inheritedBuckIsolation("rust_wasm_remote_snapshot_replay")} build --target-platforms prelude//platforms:default --show-full-output ${labels}`;
    const repeatedOutputs = parseBuckOutputs(
      String(repeatedBuild.stdout),
      executionSnapshot,
      labels,
    );
    assert.equal(repeatedOutputs.size, labels.length, String(repeatedBuild.stdout));
    for (const [label, output] of repeatedOutputs) {
      const repeatedMaterialization = JSON.parse(
        await fs.readFile(
          path.join(output, "share/viberoots-rust/materialization-manifest.json"),
          "utf8",
        ),
      );
      assert.equal(repeatedMaterialization.storePaths[0]?.path, buckStorePaths.get(label));
    }
  } finally {
    await fs.writeFile(ownerSource, originalSource);
  }
}
