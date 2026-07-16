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
  },
  deps: { register?: RegisterBundle; copyMode?: CopyFileCloneMode } = {},
): Promise<EvaluationBundle> {
  const tempRoot = await mkdtempNoindex("vbr-evaluation-bundle-", {
    baseName: "vbr-evaluation-bundle",
    tmpBase: process.env.TMPDIR || "/tmp",
  });
  const claim = await claimBundleTempRoot(tempRoot);
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
    const selection = {
      attr: opts.attr,
      platform: opts.platform || "",
      target: opts.target || "",
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
    const dependencies = { inputs: dependencyInputs(files) };
    const manifest = { schema: "viberoots.evaluation-bundle-manifest.v1", files };
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
    );
    assertRunning();
    await cleanupTempRoot();
    const storeSource = path.join(storePath, "source");
    return {
      bundlePath: storePath,
      digest: `sha256:${digest}`,
      flakeRef: `path:${path.join(storeSource, subdir)}#${opts.attr}`,
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
