import * as fsp from "node:fs/promises";
import path from "node:path";
import type {
  CloudflarePagesDeployment,
  KubernetesDeployment,
  NixosSharedHostDeployment,
  S3StaticDeployment,
} from "../../deployments/contract.ts";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query.ts";
import { stableBuckIsolation } from "../../lib/buck-command-env.ts";

export type ReviewedDeployment =
  | CloudflarePagesDeployment
  | KubernetesDeployment
  | NixosSharedHostDeployment
  | S3StaticDeployment;

export type TargetsFileFragment = {
  loadLines: string[];
  bodyLines: string[];
};

const SYNTHETIC_TARGETS_MANIFEST = ".tmp-deployment-targets.fragments.json";
let syntheticInstallBuckNonce = 0;

export function labelDir(label: string): string {
  return label.replace(/^\/\//, "").split(":")[0] || "";
}

export function labelName(label: string): string {
  return label.split(":")[1] || "";
}

export function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

function splitBodyBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line === "") {
      if (current.length > 0) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

function blockIdentity(block: string): string {
  const lines = block.split("\n");
  const ruleLine = lines[0] || "";
  const nameLine = lines.find((line) => line.trimStart().startsWith("name = "));
  return nameLine ? `${ruleLine}|${nameLine.trim()}` : block;
}

export function appendTargetsFragment(
  fragments: Map<string, TargetsFileFragment>,
  dir: string,
  fragment: TargetsFileFragment,
) {
  const current = fragments.get(dir) || { loadLines: [], bodyLines: [] };
  for (const line of fragment.loadLines) {
    if (line && !current.loadLines.includes(line)) current.loadLines.push(line);
  }
  const currentBlocks = splitBodyBlocks(current.bodyLines);
  const blockIndexes = new Map(
    currentBlocks.map((block, index) => [blockIdentity(block), index] as const),
  );
  const bodyBlocks = splitBodyBlocks(fragment.bodyLines);
  for (const block of bodyBlocks) {
    if (!block) continue;
    const identity = blockIdentity(block);
    const existingIndex = blockIndexes.get(identity);
    if (existingIndex === undefined) {
      blockIndexes.set(identity, currentBlocks.length);
      currentBlocks.push(block);
      continue;
    }
    currentBlocks[existingIndex] = block;
  }
  current.bodyLines = currentBlocks.flatMap((block, index) =>
    index === 0 ? block.split("\n") : ["", ...block.split("\n")],
  );
  fragments.set(dir, current);
}

async function readTargetsFragments(
  workspaceRoot: string,
): Promise<Map<string, TargetsFileFragment>> {
  const manifestPath = path.join(workspaceRoot, SYNTHETIC_TARGETS_MANIFEST);
  try {
    const content = await fsp.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, TargetsFileFragment>;
    return new Map(Object.entries(parsed));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
}

async function writeTargetsManifest(
  workspaceRoot: string,
  fragments: Map<string, TargetsFileFragment>,
): Promise<void> {
  const manifestPath = path.join(workspaceRoot, SYNTHETIC_TARGETS_MANIFEST);
  await fsp.writeFile(
    manifestPath,
    JSON.stringify(Object.fromEntries(fragments.entries()), null, 2) + "\n",
    "utf8",
  );
}

export async function writeTargetsFragments(
  workspaceRoot: string,
  newFragments: Map<string, TargetsFileFragment>,
): Promise<void> {
  const fragments = await readTargetsFragments(workspaceRoot);
  for (const [dir, fragment] of newFragments.entries()) {
    appendTargetsFragment(fragments, dir, fragment);
  }
  await Promise.all(
    Array.from(fragments.entries()).map(async ([dir, fragment]) => {
      const targetPath = path.join(workspaceRoot, dir, "TARGETS");
      const lines = [...fragment.loadLines, "", ...fragment.bodyLines];
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      await ensureParentDir(targetPath);
      await fsp.writeFile(targetPath, lines.join("\n") + "\n", "utf8");
    }),
  );
  await writeTargetsManifest(workspaceRoot, fragments);
}

export async function synchronizeInstalledDeployments(
  workspaceRoot: string,
  deployments: ReviewedDeployment[],
): Promise<void> {
  const queryEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // Use a fresh temp-repo buck isolation after rewriting synthetic TARGETS so cquery does not
    // reuse a stale package view from an earlier install in the same temp workspace.
    BUCK_NESTED_ISO: stableBuckIsolation(
      path.join(workspaceRoot, `.synthetic-install-sync-${++syntheticInstallBuckNonce}`),
      "zxtest-install-sync",
    ),
  };
  const resolved = await Promise.all(
    deployments.map((deployment) =>
      resolveDeploymentFromTarget(workspaceRoot, deployment.label, { env: queryEnv }),
    ),
  );
  for (const [index, deployment] of deployments.entries()) {
    Object.assign(deployment, resolved[index]);
  }
}
