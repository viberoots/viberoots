import path from "node:path";
import { isNixStorePath } from "./tool-paths";

export type ArtifactBuildClassification = "hermetic" | "local-development" | "diagnostic-impure";
export type ArtifactJobPurpose =
  | "local"
  | "ci"
  | "release"
  | "cache-publication"
  | "provenance"
  | "deployment";

export type ArtifactPolicyEvidence = {
  schema: "viberoots.artifact-policy-evidence.v1";
  classification: ArtifactBuildClassification;
  purpose: ArtifactJobPurpose;
  evaluation: { impure: boolean; selectorEnvironment: string[] };
  tools: Record<string, "nix-store" | "nix-bootstrap" | "host" | "missing">;
  nix: {
    inspection: "available" | "unavailable" | "invalid";
    sandbox: "enabled" | "disabled" | "unknown";
    builders: "local-only" | "configured" | "unknown";
    substituters: "configured" | "none" | "unknown";
  };
};

const protectedPurposes = new Set<ArtifactJobPurpose>([
  "ci",
  "release",
  "cache-publication",
  "provenance",
  "deployment",
]);
const validPurposes = new Set<ArtifactJobPurpose>(["local", ...protectedPurposes]);

export function classifyArtifactBuild(opts: {
  diagnosticImpure: boolean;
  localDevelopment: boolean;
}): ArtifactBuildClassification {
  if (opts.diagnosticImpure) return "diagnostic-impure";
  if (opts.localDevelopment) return "local-development";
  return "hermetic";
}

export function artifactJobPurpose(env: NodeJS.ProcessEnv): ArtifactJobPurpose {
  const explicit = String(env.VBR_ARTIFACT_JOB || "").trim();
  if (explicit) {
    if (!validPurposes.has(explicit as ArtifactJobPurpose)) {
      throw new Error(`invalid VBR_ARTIFACT_JOB '${explicit}'`);
    }
    if (String(env.CI || "").trim() && explicit === "local") return "ci";
    return explicit as ArtifactJobPurpose;
  }
  return String(env.CI || "").trim() ? "ci" : "local";
}

function configValue(config: unknown, key: string): unknown {
  if (!config || typeof config !== "object") return undefined;
  const entry = (config as Record<string, unknown>)[key];
  if (entry && typeof entry === "object" && "value" in entry) {
    return (entry as { value: unknown }).value;
  }
  return entry;
}

function listConfig(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return null;
  return value.trim().split(/\s+/).filter(Boolean);
}

function toolAuthority(tool: string, toolPath: string | undefined) {
  if (!toolPath) return "missing" as const;
  if (tool === "nix" && path.resolve(toolPath) === "/nix/var/nix/profiles/default/bin/nix") {
    return "nix-bootstrap" as const;
  }
  return isNixStorePath(toolPath) ? ("nix-store" as const) : ("host" as const);
}

export function buildArtifactPolicyEvidence(opts: {
  classification: ArtifactBuildClassification;
  purpose: ArtifactJobPurpose;
  impureEvaluation: boolean;
  env: NodeJS.ProcessEnv;
  toolPaths: Record<string, string | undefined>;
  nixConfig?: unknown;
  nixInspection?: "available" | "unavailable" | "invalid";
}): ArtifactPolicyEvidence {
  const selectors = [
    "BUCK_GRAPH_JSON",
    "BUCK_QUERY_ROOTS",
    "BUCK_TARGET",
    "BUCK_TARGET_ATTR",
    "WORKSPACE_ROOT",
  ].filter((name) => String(opts.env[name] || "").trim());
  const sandboxValue = configValue(opts.nixConfig, "sandbox");
  const builders = listConfig(configValue(opts.nixConfig, "builders"));
  const substituters = listConfig(configValue(opts.nixConfig, "substituters"));
  return {
    schema: "viberoots.artifact-policy-evidence.v1",
    classification: opts.classification,
    purpose: opts.purpose,
    evaluation: { impure: opts.impureEvaluation, selectorEnvironment: selectors.sort() },
    tools: Object.fromEntries(
      Object.entries(opts.toolPaths)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([tool, toolPath]) => [tool, toolAuthority(tool, toolPath)]),
    ),
    nix: {
      inspection: opts.nixInspection || "available",
      sandbox: sandboxValue === true ? "enabled" : sandboxValue === false ? "disabled" : "unknown",
      builders: builders === null ? "unknown" : builders.length === 0 ? "local-only" : "configured",
      substituters:
        substituters === null ? "unknown" : substituters.length === 0 ? "none" : "configured",
    },
  };
}

export function assertArtifactBuildAdmitted(evidence: ArtifactPolicyEvidence): void {
  if (!protectedPurposes.has(evidence.purpose)) return;
  if (evidence.nix.inspection !== "available") {
    throw new Error(
      `${evidence.purpose} artifact admission requires effective Nix policy inspection`,
    );
  }
  const unknownFields = Object.entries(evidence.nix)
    .filter(([key, value]) => key !== "inspection" && value === "unknown")
    .map(([key]) => key);
  if (unknownFields.length > 0) {
    throw new Error(
      `${evidence.purpose} artifact admission requires known effective Nix policy: ${unknownFields.join(", ")}`,
    );
  }
  if (evidence.classification !== "hermetic") {
    throw new Error(
      `${evidence.purpose} artifact admission rejects ${evidence.classification} builds`,
    );
  }
}

export function serializeArtifactPolicyEvidence(evidence: ArtifactPolicyEvidence): string {
  return JSON.stringify(evidence);
}
