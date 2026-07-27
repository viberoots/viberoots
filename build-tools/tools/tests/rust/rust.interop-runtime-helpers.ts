import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import {
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import {
  materializeNixStorePaths,
  parseMaterializationManifest,
} from "../../remote-exec/nix-store-materialize";
import { exportGraphInTemp } from "../lib/test-helpers";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { buildCanonicalBundle } from "./rust.source-selection.identity-bundle";

const sourceRoot = path.resolve(path.basename(process.cwd()) === "viberoots" ? "." : "viberoots");
const appTarget = "//projects/apps/rust_abi_consumer:app";

function hostileWorkerEnv(tmp: string): NodeJS.ProcessEnv {
  return {
    ...withoutArtifactEnvironmentInfluence(process.env),
    PATH: "/hostile",
    CARGO_HOME: path.join(tmp, "hostile-cargo"),
    RUSTUP_HOME: path.join(tmp, "hostile-rustup"),
  };
}

function immutableFixtureInput(): string {
  const immutableInput = String(process.env.VIBEROOTS_FLAKE_INPUT_ROOT || "");
  assert.match(immutableInput, /^\/nix\/store\//);
  return immutableInput;
}

async function assertRemotePreparedReplay(options: {
  tmp: string;
  $: typeof import("zx").$;
  selectedSource: string;
  selectedOutput: string;
}): Promise<void> {
  const { tmp, $, selectedSource, selectedOutput } = options;
  const snapshotSeed = path.join(tmp, "remote-prepared-rust-interop-seed");
  const snapshot = path.join(tmp, "remote-prepared-rust-interop");
  const snapshotManifest = `${snapshot}.manifest.json`;
  await fs.cp(selectedSource, snapshotSeed, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(selectedSource, source);
      return ![
        "build-tools",
        path.join(".viberoots", "workspace", "build-tools"),
        path.join("viberoots", "build-tools"),
      ].some((excluded) => relative === excluded || relative.startsWith(`${excluded}${path.sep}`));
    },
  });
  const graph = path.join(snapshotSeed, ".viberoots/workspace/buck/graph.json");
  const snapshotArgs = [
    `--workspace-root=${snapshotSeed}`,
    `--out=${snapshot}`,
    `--manifest=${snapshotManifest}`,
    `--graph=${graph}`,
    `--declared-root=${snapshot}`,
    `--declared-graph=${path.join(snapshot, ".viberoots/workspace/buck/graph.json")}`,
  ];
  await $({
    cwd: tmp,
    stdio: "pipe",
  })`${process.execPath} --experimental-strip-types --import ${path.join(
    sourceRoot,
    "build-tools/tools/dev/zx-init.mjs",
  )} ${path.join(sourceRoot, "build-tools/tools/dev/source-snapshot.ts")} ${snapshotArgs}`;
  const snapshotEvidence = await readJson(snapshotManifest);
  assert.equal(snapshotEvidence.declaredSnapshotRoot, snapshot);
  const nix = ensureNixStoreToolPathSync("nix");
  const immutableSnapshot =
    String(
      (
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`${nix} --extra-experimental-features ${"nix-command flakes"} store add-path ${snapshot}`
      ).stdout,
    ).trim() || "";
  assert.match(immutableSnapshot, /^\/nix\/store\//);
  const ambientRust = path.join(tmp, "projects/libs/rust_abi/src/lib.rs");
  const originalRust = await fs.readFile(ambientRust, "utf8");
  try {
    await fs.writeFile(
      ambientRust,
      `${originalRust}\ncompile_error!("ambient checkout must not enter remote replay");\n`,
    );
    const replay = await buildCanonicalBundle(
      snapshot,
      "graph-generator-selected",
      immutableFixtureInput(),
      {
        ...hostileWorkerEnv(tmp),
        CARGO_HOME: path.join(tmp, "replay-hostile-cargo"),
      },
      appTarget,
      canonicalArtifactToolsRoot(tmp),
      true,
    );
    assert.equal(replay.outPath, selectedOutput);
    assert.match(replay.bundleSource, /^\/nix\/store\//);
    const preparation = parseMaterializationManifest({
      schemaVersion: "viberoots.nix-store-materialization.v1",
      sourceRevision: "rust-pr8-interop",
      sourceSnapshot: path.dirname(replay.bundleSource),
      flakeDir: "source",
      flakeLockFingerprint: path.basename(immutableSnapshot),
      substituter: { trustedPublicKeys: [] },
      tools: { nix: canonicalArtifactToolsRoot(tmp) },
      storePaths: [
        {
          attr: "graph-generator-selected",
          path: replay.outPath,
          expectedOutputIdentity: path.basename(replay.outPath),
        },
      ],
    });
    const [prepared] = await materializeNixStorePaths({
      manifest: preparation,
      artifactToolsRoot: canonicalArtifactToolsRoot(tmp),
    });
    assert.equal(prepared?.path, replay.outPath);
    assert.equal(preparation.sourceSnapshot, path.dirname(replay.bundleSource));
    const replayApp = path.join(replay.outPath, "bin/projects-apps-rust_abi_consumer-app");
    const executed = await $({
      cwd: snapshot,
      env: hostileWorkerEnv(tmp),
      stdio: "pipe",
    })`${replayApp}`;
    assert.equal(String(executed.stdout).trim(), "42");
  } finally {
    await fs.writeFile(ambientRust, originalRust);
  }
}

export async function buildRustInteropTargets(
  tmp: string,
  $: typeof import("zx").$,
  targets: string[],
): Promise<string[]> {
  await exportGraphInTemp({ tmp, $ });
  const graph = path.join(tmp, ".viberoots/workspace/buck/graph.json");
  const document = JSON.parse(await fs.readFile(graph, "utf8")) as {
    nodes: Array<Record<string, unknown>>;
  };
  const nodes = document.nodes;
  const cConsumer = nodes.find((node) => node.name === "//projects/apps/rust_abi_consumer:c_app");
  if (cConsumer?.language_standard !== "c11") {
    throw new Error(JSON.stringify(cConsumer));
  }
  assert.equal(cConsumer?.stl, "none", JSON.stringify(cConsumer));
  const immutableInput = immutableFixtureInput();
  const hostileEnv = hostileWorkerEnv(tmp);
  const outputs: string[] = [];
  let selectedAppSource = "";
  for (const target of targets) {
    const built = await buildCanonicalBundle(
      tmp,
      "graph-generator-selected",
      immutableInput,
      hostileEnv,
      target,
      "",
      true,
    );
    assert.match(built.outPath, /^\/nix\/store\//);
    outputs.push(built.outPath);
    if (target === appTarget) selectedAppSource = built.bundleSource;
  }
  assert.ok(selectedAppSource);
  await assertRemotePreparedReplay({
    tmp,
    $,
    selectedSource: selectedAppSource,
    selectedOutput: outputs[targets.indexOf(appTarget)]!,
  });
  return outputs;
}

export async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function assertPanicAborts(
  $: typeof import("zx").$,
  tmp: string,
  appPath: string,
): Promise<void> {
  const child = await $({
    cwd: tmp,
    env: hostileWorkerEnv(tmp),
    stdio: "pipe",
  })`${appPath} panic-child`.nothrow();
  assert.notEqual(child.exitCode, 0, "panicking Rust export must terminate the isolated child");
  assert.doesNotMatch(`${String(child.stdout)}${String(child.stderr)}`, /PANIC_UNWOUND_ACROSS_ABI/);
}

export async function assertNativeConstruction(
  $: typeof import("zx").$,
  outputs: string[],
  dynamicPath: string,
): Promise<void> {
  const targetTriple =
    process.platform === "darwin"
      ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
      : `${process.arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-gnu`;
  assert.match(
    await fs.readFile(path.join(outputs[3]!, "build.log"), "utf8"),
    new RegExp(
      `std=c\\+\\+17\\nstl=libc\\+\\+\\ncompilerIdentity=/nix/store/[^\\n]+-clang-[^\\n]+\\ntargetTriple=${targetTriple}`,
    ),
  );
  assert.match(
    await fs.readFile(path.join(outputs[4]!, "build.log"), "utf8"),
    new RegExp(
      `std=c11\\nstl=none\\ncompilerIdentity=/nix/store/[^\\n]+-clang-[^\\n]+\\ntargetTriple=${targetTriple}`,
    ),
  );
  if (process.platform === "darwin") {
    const installName = await $({ stdio: "pipe" })`/usr/bin/otool -D ${dynamicPath}`;
    assert.match(String(installName.stdout), new RegExp(dynamicPath.replaceAll("/", "\\/")));
    const closure = await $({ stdio: "pipe" })`/usr/bin/otool -L ${dynamicPath}`;
    assert.match(String(closure.stdout), /librust_abi_rust_bridge\.dylib/);
  }
}
