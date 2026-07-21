import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";
import { inventoryBundleSource } from "../../dev/evaluation-bundle-manifest";
import { resolveToolPathSync } from "../../lib/tool-paths";

export const artifactToolsRoot = canonicalArtifactToolsRoot(
  process.cwd(),
  String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
);

export function artifactEnvForTmp(tmp: string): NodeJS.ProcessEnv {
  return {
    ...buildCanonicalArtifactEnvironment(process.cwd(), { artifactToolsRoot }),
    TMPDIR: tmp,
  };
}

export async function writeEvaluationBundleFixture(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, "projects", "app"), { recursive: true });
  await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck"), { recursive: true });
  await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n");
  await fsp.writeFile(path.join(root, "flake.lock"), "{}\n");
  await fsp.writeFile(path.join(root, "projects", "app", "main.ts"), "export const n = 1;\n");
  await fsp.writeFile(path.join(root, ".viberoots", "workspace", "buck", "graph.json"), "[]\n");
}

export async function tempBundleDirs(tmp: string): Promise<string[]> {
  const parent =
    process.platform === "darwin" ? path.join(tmp, "vbr-evaluation-bundle.noindex") : tmp;
  return (await fsp.readdir(parent).catch(() => [] as string[])).filter((name) =>
    name.startsWith("vbr-evaluation-bundle-"),
  );
}

export async function assertUnsupportedBundleEntryRejected(): Promise<void> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-unsupported-"));
  await writeEvaluationBundleFixture(root);
  const fifo = path.join(root, "projects", "app", "pipe");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolveToolPathSync("mkfifo"), [fifo], { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`mkfifo ${code}`))));
  });
  try {
    await assert.rejects(inventoryBundleSource(root), /unsupported entry: projects\/app\/pipe/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}
