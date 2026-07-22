import { normalizeNixpkgPins, normalizeNixpkgsProfile } from "../buck/source-selection";
import { normalizeTargetLabel } from "./target-label-normalization";

export type SourcePlanEvidence = {
  target: string;
  nixpkgs_profile: string;
  nixpkg_pins: Record<string, { nixpkgs_profile: string }>;
};

type GraphRecord = Record<string, unknown>;

function isRecord(value: unknown): value is GraphRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function graphNodes(raw: unknown): GraphRecord[] {
  const nodes = Array.isArray(raw)
    ? raw
    : isRecord(raw) && "nodes" in raw
      ? raw.nodes
      : isRecord(raw)
        ? Object.entries(raw).map(([name, value]) =>
            isRecord(value) ? { ...value, name: value.name ?? name } : value,
          )
        : null;
  if (!Array.isArray(nodes)) throw new Error("source-plan graph nodes must be an array");
  return nodes.map((node, index) => {
    if (!isRecord(node)) throw new Error(`source-plan graph node ${index} must be an object`);
    if (typeof node.name !== "string" || !node.name.trim()) {
      throw new Error(`source-plan graph node ${index} must have a target name`);
    }
    if (
      node.nixpkgs_profile !== undefined &&
      (typeof node.nixpkgs_profile !== "string" || !node.nixpkgs_profile.trim())
    ) {
      throw new Error(`source-plan graph node ${index} has malformed nixpkgs_profile`);
    }
    if (node.nixpkg_pins !== undefined) {
      if (!isRecord(node.nixpkg_pins)) {
        throw new Error(`source-plan graph node ${index} nixpkg_pins must be an object`);
      }
      for (const [attr, pin] of Object.entries(node.nixpkg_pins)) {
        if (!attr.trim() || !isRecord(pin)) {
          throw new Error(`source-plan graph node ${index} has malformed nixpkg pin ${attr}`);
        }
        if (
          typeof pin.nixpkgs_profile !== "string" ||
          !pin.nixpkgs_profile.trim() ||
          typeof pin.rationale !== "string" ||
          !pin.rationale.trim()
        ) {
          throw new Error(`source-plan graph node ${index} has malformed nixpkg pin ${attr}`);
        }
      }
    }
    return node;
  });
}

export function sourcePlanEvidenceFromNode(node: GraphRecord): SourcePlanEvidence | null {
  const target = normalizeTargetLabel(String(node.name || "").trim());
  if (!target) return null;
  const normalizedPins = normalizeNixpkgPins(node.nixpkg_pins);
  const nixpkg_pins = Object.fromEntries(
    Object.entries(normalizedPins).map(([attr, pin]) => [
      attr,
      { nixpkgs_profile: normalizeNixpkgsProfile(pin.nixpkgs_profile) },
    ]),
  );
  return {
    target,
    nixpkgs_profile: normalizeNixpkgsProfile(node.nixpkgs_profile),
    nixpkg_pins,
  };
}

export function sourcePlanEvidenceFromGraph(raw: unknown): SourcePlanEvidence[] {
  const byTarget = new Map<string, SourcePlanEvidence>();
  for (const node of graphNodes(raw)) {
    const evidence = sourcePlanEvidenceFromNode(node);
    if (evidence) byTarget.set(evidence.target, evidence);
  }
  return [...byTarget.values()].sort((left, right) => left.target.localeCompare(right.target));
}
