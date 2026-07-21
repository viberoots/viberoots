import * as fsp from "node:fs/promises";
import path from "node:path";
import type { ArtifactBuildClassification } from "../lib/artifact-build-policy";
import { copyTree, type CopyFileCloneMode } from "../lib/copy-tree";
import { mkdtempNoindex } from "../lib/macos-metadata";
import { rethrowAfterOwnedTempCleanup } from "../lib/owned-temp-cleanup";
import {
  dependencyInputs,
  inventoryBundleSource,
  manifestDigest,
} from "./evaluation-bundle-manifest";
import { registerEvaluationBundle } from "./evaluation-bundle-register";
import { claimBundleTempRoot } from "./evaluation-bundle-owner";
import { DEFAULT_GRAPH_PATH } from "../lib/workspace-state-paths";
import {
  captureEvaluationBundleSelectors,
  type DevOverrideValues,
} from "./evaluation-bundle-selectors";
import { buildCanonicalArtifactEnvironment } from "../lib/artifact-environment";

export type EvaluationBundle = {
  bundlePath: string;
  digest: string;
  flakeRef: string;
  workspaceRoot: string;
  cleanup: () => Promise<void>;
};

type RegisterBundle = (
  bundleRoot: string,
  recordProcessGroup: (processGroupId: number) => void,
  env?: NodeJS.ProcessEnv,
) => Promise<string>;

function cloneMode(): CopyFileCloneMode {
  const value = String(process.env.VBR_EVALUATION_BUNDLE_COPY_MODE || "try").trim();
  if (value === "none" || value === "try" || value === "force") return value;
  throw new Error(`invalid VBR_EVALUATION_BUNDLE_COPY_MODE: ${value}`);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function flakeSubdir(sourceRoot: string): Promise<string> {
  const hidden = path.join(sourceRoot, ".viberoots", "workspace", "flake.nix");
  if (
    await fsp
      .access(hidden)
      .then(() => true)
      .catch(() => false)
  ) {
    return ".viberoots/workspace";
  }
  const root = path.join(sourceRoot, "flake.nix");
  if (
    await fsp
      .access(root)
      .then(() => true)
      .catch(() => false)
  )
    return ".";
  throw new Error("evaluation bundle source has no workspace flake");
}

export async function materializeEvaluationBundle(
  opts: {
    stagedSource: string;
    attr: string;
    target?: string;
    classification: ArtifactBuildClassification;
    platform?: string;
    requireGraph?: boolean;
    selectorEnv?: NodeJS.ProcessEnv;
    devOverrides?: DevOverrideValues;
    wasmBackend?: string;
    onlyCpp?: boolean;
    coverage?: boolean;
    artifactEnv?: NodeJS.ProcessEnv;
    artifactToolsRoot?: string;
  },
  deps: { register?: RegisterBundle; copyMode?: CopyFileCloneMode } = {},
): Promise<EvaluationBundle> {
  const artifactEnv =
    opts.artifactEnv ||
    (opts.artifactToolsRoot
      ? buildCanonicalArtifactEnvironment(process.cwd(), {
          artifactToolsRoot: opts.artifactToolsRoot,
        })
      : undefined);
  if (!artifactEnv) {
    throw new Error(
      "materializeEvaluationBundle requires either artifactEnv or artifactToolsRoot; the caller must resolve authority at the public boundary.",
    );
  }
  const tempRoot = await mkdtempNoindex("vbr-evaluation-bundle-", {
    baseName: "vbr-evaluation-bundle",
    tmpBase: artifactEnv.TMPDIR || "/tmp",
  });
  const claim = await claimBundleTempRoot(tempRoot, artifactEnv);
  const cleanupTempRoot = claim.cleanup;
  let interrupted = "";
  const onSigint = () => (interrupted = "SIGINT");
  const onSigterm = () => (interrupted = "SIGTERM");
  const assertRunning = () => {
    if (interrupted) throw new Error(`evaluation bundle interrupted by ${interrupted}`);
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    const bundleRoot = path.join(tempRoot, "bundle");
    const sourceRoot = path.join(bundleRoot, "source");
    await fsp.mkdir(bundleRoot, { recursive: true });
    await inventoryBundleSource(opts.stagedSource);
    assertRunning();
    await copyTree(opts.stagedSource, sourceRoot, {
      cloneMode: deps.copyMode || cloneMode(),
      force: true,
    });
    assertRunning();
    const files = await inventoryBundleSource(sourceRoot);
    const selectors = await captureEvaluationBundleSelectors({
      bundleRoot,
      env: opts.selectorEnv || process.env,
      devOverrides: opts.devOverrides,
      copyMode: deps.copyMode || cloneMode(),
      wasmBackend: opts.wasmBackend,
      onlyCpp: opts.onlyCpp,
      coverage: opts.coverage,
    });
    assertRunning();
    if (
      opts.classification === "hermetic" &&
      Object.values(selectors.languageOverrides).some(
        (overrides) => Object.keys(overrides).length > 0,
      )
    ) {
      throw new Error("evaluation bundle with language overrides must be local-development");
    }
    const selection = {
      attr: opts.attr,
      languageOverrides: selectors.languageOverrides,
      onlyCpp: selectors.onlyCpp,
      coverage: selectors.coverage,
      platform: opts.platform || "",
      target: opts.target || "",
      verifySeed: selectors.verifySeed,
      wasmBackend: selectors.wasmBackend,
    };
    const classification = { classification: opts.classification };
    const graphPath = path.join(sourceRoot, DEFAULT_GRAPH_PATH);
    const graph = await fsp.readFile(graphPath).catch((error) => {
      if (opts.requireGraph !== false) {
        throw new Error(`evaluation bundle source is missing graph: ${DEFAULT_GRAPH_PATH}`, {
          cause: error,
        });
      }
      return Buffer.from("[]\n");
    });
    const rootModulesTomlPath = files.some((file) => file.path === "gomod2nix.toml")
      ? "gomod2nix.toml"
      : "";
    const dependencies = {
      artifactToolsRoot: String(artifactEnv.VBR_ARTIFACT_TOOLS_ROOT || ""),
      inputs: dependencyInputs(files),
      rootModulesTomlPath,
    };
    const manifest = {
      schema: "viberoots.evaluation-bundle-manifest.v1",
      files: [...files, ...selectors.overrideFiles],
    };
    const digest = manifestDigest({
      selection,
      classification,
      dependencies,
      graphSha256: manifestDigest(graph.toString("base64")),
      manifest,
    });
    await fsp.writeFile(path.join(bundleRoot, "graph.json"), graph);
    await writeJson(path.join(bundleRoot, "selection.json"), selection);
    await writeJson(path.join(bundleRoot, "classification.json"), classification);
    await writeJson(path.join(bundleRoot, "dependency-inputs.json"), dependencies);
    await writeJson(path.join(bundleRoot, "manifest.json"), manifest);
    await writeJson(path.join(bundleRoot, "schema.json"), {
      schema: "viberoots.evaluation-bundle.v1",
      digest: `sha256:${digest}`,
    });
    const subdir = await flakeSubdir(sourceRoot);
    const storePath = await (deps.register || registerEvaluationBundle)(
      bundleRoot,
      claim.recordProcessGroup,
      artifactEnv,
    );
    assertRunning();
    await cleanupTempRoot();
    const storeSource = path.join(storePath, "source");
    return {
      bundlePath: storePath,
      digest: `sha256:${digest}`,
      flakeRef: `path:${storePath}?dir=${path.posix.join("source", subdir)}#${opts.attr}`,
      workspaceRoot: storeSource,
      cleanup: async () => {},
    };
  } catch (error) {
    await rethrowAfterOwnedTempCleanup(error, [cleanupTempRoot]);
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}
