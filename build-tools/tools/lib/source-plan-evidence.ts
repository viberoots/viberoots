import fs from "node:fs/promises";
import { normalizeNixpkgPins, normalizeNixpkgsProfile } from "../buck/source-selection";
import { normalizeTargetLabel } from "./labels";

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
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (isRecord(raw) && Array.isArray(raw.nodes)) return raw.nodes.filter(isRecord);
  if (!isRecord(raw)) return [];
  return Object.entries(raw).flatMap(([name, value]) =>
    isRecord(value) ? [{ ...value, name: value.name ?? name }] : [{ name }],
  );
}

export function sourcePlanEvidenceFromNode(node: GraphRecord): SourcePlanEvidence | null {
  const target = normalizeTargetLabel(String(node.name || "").trim());
  if (!target) return null;
  const nixpkgPins = normalizeNixpkgPins(node.nixpkg_pins);
  return {
    target,
    nixpkgs_profile: normalizeNixpkgsProfile(node.nixpkgs_profile),
    nixpkg_pins: Object.fromEntries(
      Object.entries(nixpkgPins).map(([attr, pin]) => [
        attr,
        { nixpkgs_profile: normalizeNixpkgsProfile(pin.nixpkgs_profile) },
      ]),
    ),
  };
}

export function sourcePlanEvidenceFromGraph(raw: unknown): SourcePlanEvidence[] {
  const byTarget = new Map<string, SourcePlanEvidence>();
  for (const node of graphNodes(raw)) {
    const evidence = sourcePlanEvidenceFromNode(node);
    if (evidence) byTarget.set(evidence.target, evidence);
  }
  return [...byTarget.values()].sort((a, b) => a.target.localeCompare(b.target));
}

export async function sourcePlanEvidenceFromGraphFile(file: string): Promise<SourcePlanEvidence[]> {
  if (!file) return [];
  try {
    return sourcePlanEvidenceFromGraph(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    return [];
  }
}
