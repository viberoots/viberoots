#!/usr/bin/env zx-wrapper
import { normalizeTargetLabel } from "../lib/labels.ts";
import type { GraphNode } from "../lib/graph.ts";
import { readString } from "./deployment-graph-readers.ts";

export type DeploymentLanePromotionCompatibility = {
  crossProviderPromotionEdges: string[];
};

function policyError(ref: string, message: string): string {
  return `${normalizeTargetLabel(ref)}: ${message}`;
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

export function readLanePromotionCompatibility(
  node: GraphNode,
  ref: string,
): {
  value?: DeploymentLanePromotionCompatibility;
  errors: string[];
} {
  const raw = readString(node, "promotion_compatibility");
  if (!raw) return { errors: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      errors: [policyError(ref, "promotion_compatibility must be valid JSON")],
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      errors: [policyError(ref, "promotion_compatibility must be a JSON object")],
    };
  }
  const record = parsed as Record<string, unknown>;
  const crossProviderPromotionEdges = sortedUnique(
    readStringList(record.cross_provider_promotion_edges || record.crossProviderPromotionEdges),
  );
  return {
    value: { crossProviderPromotionEdges },
    errors: [],
  };
}

export function lanePromotionCompatibilityFingerprintPart(
  value?: DeploymentLanePromotionCompatibility,
): Record<string, unknown> {
  return value
    ? {
        promotionCompatibility: {
          crossProviderPromotionEdges: value.crossProviderPromotionEdges,
        },
      }
    : {};
}

export function edgeAllowsCrossProviderPromotion(
  value: DeploymentLanePromotionCompatibility | undefined,
  edge: string,
): boolean {
  return !!value?.crossProviderPromotionEdges.includes(edge);
}
