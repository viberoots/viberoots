#!/usr/bin/env zx-wrapper
import { normalizeTargetLabel } from "./labels";

/**
 * Classify whether a Buck node name refers to a provider-package node,
 * i.e. a target under the legacy provider package or the workspace_providers cell.
 * The input may include a cell prefix or a Buck config suffix; we normalize first.
 */
export function isProviderPackageNode(name: string): boolean {
  const raw = String(name || "");
  const s = normalizeTargetLabel(raw);
  return s.startsWith("//third_party/providers:") || raw.includes("workspace_providers//:");
}
