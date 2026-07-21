import fs from "node:fs/promises";
import path from "node:path";
import {
  sourcePlanEvidenceFromGraph,
  sourcePlanEvidenceFromGraphFile,
  type SourcePlanEvidence,
} from "../lib/source-plan-evidence";
import { readArtifactSystem, runArtifactNix, runArtifactTool } from "./artifact-command";

type ExtraOutputs = { graph?: string[]; targets?: string[] };

type ArtifactContext = {
  workspaceRoot: string;
  artifactToolsRoot: string;
};

export async function packageNamesForCurrentSystem(
  flakeBase: string,
  context: ArtifactContext,
): Promise<string[]> {
  const system = await readArtifactSystem(
    context.workspaceRoot,
    process.env,
    context.artifactToolsRoot,
  );
  const result = await runArtifactNix({
    args: ["eval", "--json", "--accept-flake-config", `${flakeBase}#packages.${system}`],
    ...context,
  });
  return Object.keys(JSON.parse(result.stdout || "{}"));
}

export async function buildCacheAttrs(
  attrs: string[],
  flakeBase: string,
  context: ArtifactContext,
): Promise<Record<string, string[]>> {
  const outputs: Record<string, string[]> = {};
  for (const attr of attrs) {
    const result = await runArtifactNix({
      args: [
        "build",
        `${flakeBase}${attr.slice(1)}`,
        "--no-link",
        "--print-out-paths",
        "--accept-flake-config",
      ],
      ...context,
    });
    const paths = result.stdout.trim().split(/\s+/).filter(Boolean);
    if (!paths.length) throw new Error(`nix build produced no output path for ${attr}`);
    outputs[attr] = paths;
  }
  return outputs;
}

export async function readExtraOutputs(file: string): Promise<ExtraOutputs> {
  if (!file) return {};
  return JSON.parse(await fs.readFile(file, "utf8")) as ExtraOutputs;
}

export async function readSourcePlans(
  file: string,
  immutableSourceRoot: string,
): Promise<SourcePlanEvidence[]> {
  if (file) {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    if (Array.isArray(parsed)) return parsed as SourcePlanEvidence[];
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).sourcePlans)) {
      return (parsed as any).sourcePlans as SourcePlanEvidence[];
    }
    return sourcePlanEvidenceFromGraph(parsed);
  }
  return await sourcePlanEvidenceFromGraphFile(
    path.join(immutableSourceRoot, ".viberoots", "workspace", "buck", "graph.json"),
  );
}

export async function readToolVersions(context: ArtifactContext): Promise<Record<string, string>> {
  const nix = await runArtifactTool({ tool: "nix", args: ["--version"], ...context });
  const node = await runArtifactTool({ tool: "node", args: ["--version"], ...context });
  return { nix: nix.stdout.trim(), node: node.stdout.trim() };
}

export async function readDeclaredRemoteExecutables(
  immutableSourceRoot: string,
): Promise<string[]> {
  const text = await fs
    .readFile(
      path.join(
        immutableSourceRoot,
        "viberoots",
        "build-tools/tools/nix/flake/packages/remote-worker-tools.nix",
      ),
      "utf8",
    )
    .catch(() => "");
  const block = /declaredRemoteExecutablePackages\s*=\s*\{([\s\S]*?)\};/.exec(text)?.[1] || "";
  return [...block.matchAll(/\b([A-Za-z0-9_-]+)\s*=/g)].map((match) => match[1]);
}

export function requiredImmutableSourceRoot(workspaceRoot: string | undefined): string {
  if (!workspaceRoot || !workspaceRoot.startsWith("/nix/store/")) {
    throw new Error("cache publication requires an immutable evaluation-bundle source root");
  }
  return workspaceRoot;
}

export async function readImmutableFlakeLock(sourceRoot: string): Promise<string> {
  for (const relative of ["flake.lock", ".viberoots/workspace/flake.lock"]) {
    const value = await fs.readFile(path.join(sourceRoot, relative), "utf8").catch(() => "");
    if (value) return value;
  }
  throw new Error("immutable evaluation-bundle source is missing flake.lock");
}
