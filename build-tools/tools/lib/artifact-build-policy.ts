import path from "node:path";
import { isNixStorePath } from "./tool-paths";
import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "./artifact-nix-policy";

export { serializeArtifactPolicyEvidence } from "./artifact-policy-serialization";

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
  toolClosure: { root: string; paths: Record<string, string> };
  nix: {
    inspection: "available" | "unavailable" | "invalid";
    sandbox: "enabled" | "disabled" | "unknown";
    sandboxFallback: "disabled" | "enabled" | "unknown";
    hostPaths: "none" | "configured" | "unknown";
    multiUser: "daemon" | "direct" | "unknown";
    builders: "local-only" | "configured" | "unknown";
    substituters: "reviewed" | "unreviewed" | "none" | "unknown";
    publicKeys: "reviewed" | "unreviewed" | "none" | "unknown";
    network: "sandboxed-fixed-output-only" | "unrestricted" | "unknown";
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
  if (value && typeof value === "object") return Object.keys(value);
  if (typeof value !== "string") return null;
  return value.trim().split(/\s+/).filter(Boolean);
}

function boolConfig(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function sameReviewedValues(actual: string[] | null, reviewed: readonly string[]) {
  if (actual === null) return "unknown" as const;
  if (actual.length === 0) return "none" as const;
  const expected = new Set(reviewed);
  return actual.every((entry) => expected.has(entry))
    ? ("reviewed" as const)
    : ("unreviewed" as const);
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
  nixStoreUrl?: string;
}): ArtifactPolicyEvidence {
  const selectors = [
    "BUCK_GRAPH_JSON",
    "BUCK_QUERY_ROOTS",
    "BUCK_TARGET",
    "BUCK_TARGET_ATTR",
    "WORKSPACE_ROOT",
  ].filter((name) => String(opts.env[name] || "").trim());
  const sandboxValue = configValue(opts.nixConfig, "sandbox");
  const sandboxFallback = boolConfig(configValue(opts.nixConfig, "sandbox-fallback"));
  const hostPaths = listConfig(configValue(opts.nixConfig, "sandbox-paths"));
  const builders = listConfig(configValue(opts.nixConfig, "builders"));
  const substituters = listConfig(configValue(opts.nixConfig, "substituters"));
  const publicKeys = listConfig(configValue(opts.nixConfig, "trusted-public-keys"));
  const sandbox = boolConfig(sandboxValue);
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
    toolClosure: {
      root: String(opts.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
      paths: Object.fromEntries(
        Object.entries(opts.toolPaths)
          .filter(
            ([tool, toolPath]) =>
              Boolean(toolPath) &&
              (isNixStorePath(String(toolPath)) ||
                (tool === "nix" &&
                  path.resolve(String(toolPath)) === "/nix/var/nix/profiles/default/bin/nix")),
          )
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([tool, toolPath]) => [tool, String(toolPath)]),
      ),
    },
    nix: {
      inspection: opts.nixInspection || "available",
      sandbox: sandbox === true ? "enabled" : sandbox === false ? "disabled" : "unknown",
      sandboxFallback:
        sandboxFallback === false ? "disabled" : sandboxFallback === true ? "enabled" : "unknown",
      hostPaths: hostPaths === null ? "unknown" : hostPaths.length === 0 ? "none" : "configured",
      multiUser: opts.nixStoreUrl === "daemon" ? "daemon" : opts.nixStoreUrl ? "direct" : "unknown",
      builders: builders === null ? "unknown" : builders.length === 0 ? "local-only" : "configured",
      substituters: sameReviewedValues(substituters, REVIEWED_SUBSTITUTERS),
      publicKeys: sameReviewedValues(publicKeys, REVIEWED_PUBLIC_KEYS),
      network:
        sandbox === true && sandboxFallback === false
          ? "sandboxed-fixed-output-only"
          : sandbox === false || sandboxFallback === true
            ? "unrestricted"
            : "unknown",
    },
  };
}

export function assertArtifactBuildAdmitted(evidence: ArtifactPolicyEvidence): void {
  if (evidence.nix.inspection !== "available") {
    throw new Error(
      `${evidence.purpose} artifact admission requires effective Nix policy inspection`,
    );
  }
  const invalidFields = Object.entries(evidence.nix)
    .filter(([key, value]) => key !== "inspection" && value === "unknown")
    .map(([key]) => key)
    .concat(
      evidence.nix.sandbox !== "enabled" ? ["sandbox"] : [],
      evidence.nix.sandboxFallback !== "disabled" ? ["sandboxFallback"] : [],
      evidence.nix.hostPaths !== "none" ? ["hostPaths"] : [],
      evidence.nix.multiUser !== "daemon" ? ["multiUser"] : [],
      evidence.nix.builders !== "local-only" ? ["builders"] : [],
      evidence.nix.substituters !== "reviewed" ? ["substituters"] : [],
      evidence.nix.publicKeys !== "reviewed" ? ["publicKeys"] : [],
      evidence.nix.network !== "sandboxed-fixed-output-only" ? ["network"] : [],
    );
  if (invalidFields.length > 0) {
    throw new Error(
      `${evidence.purpose} artifact admission requires effective sandbox, daemon, builder, substituter, key, and network policy; fix: configure reviewed Nix policy (${[...new Set(invalidFields)].join(", ")})`,
    );
  }
  assertArtifactClassificationAdmitted({
    classification: evidence.classification,
    purpose: evidence.purpose,
    impureEvaluation: evidence.evaluation.impure,
  });
  const hostTools = Object.entries(evidence.tools)
    .filter(([, authority]) => authority === "host" || authority === "missing")
    .map(([tool]) => tool);
  if (hostTools.length > 0) {
    throw new Error(`artifact admission requires Nix-store tools: ${hostTools.join(", ")}`);
  }
  const exactPaths = Object.entries(evidence.toolClosure.paths);
  if (!isNixStorePath(evidence.toolClosure.root)) {
    throw new Error("artifact admission requires an exact canonical tool closure root");
  }
  const missingExactTools = ["node", "nix"].filter(
    (tool) => !String(evidence.toolClosure.paths[tool] || "").trim(),
  );
  if (missingExactTools.length > 0) {
    throw new Error(
      `artifact admission requires exact canonical tool evidence: ${missingExactTools.join(", ")}`,
    );
  }
  if (exactPaths.length > 0) {
    const closurePrefix = `${path.resolve(evidence.toolClosure.root)}${path.sep}`;
    const mismatched = exactPaths
      .filter(
        ([tool, toolPath]) =>
          !(tool === "nix" && path.resolve(toolPath) === "/nix/var/nix/profiles/default/bin/nix") &&
          !path.resolve(toolPath).startsWith(closurePrefix),
      )
      .map(([tool]) => tool);
    if (mismatched.length > 0) {
      throw new Error(
        `artifact admission rejects tools outside the canonical closure: ${mismatched.join(", ")}`,
      );
    }
  }
}

export function assertArtifactClassificationAdmitted(opts: {
  classification: ArtifactBuildClassification;
  purpose: ArtifactJobPurpose;
  impureEvaluation: boolean;
}): void {
  if (!protectedPurposes.has(opts.purpose)) return;
  if (opts.impureEvaluation) {
    throw new Error(`${opts.purpose} artifact admission rejects impure Nix evaluation`);
  }
  if (opts.classification !== "hermetic") {
    throw new Error(`${opts.purpose} artifact admission rejects ${opts.classification} builds`);
  }
}
