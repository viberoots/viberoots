#!/usr/bin/env zx-wrapper
import { normalizeTargetLabel } from "./labels.ts";

/**
 * Classify whether a Buck node name refers to a provider-package node,
 * i.e. a target under //third_party/providers:*
 * The input may include a cell prefix or a Buck config suffix; we normalize first.
 */
export function isProviderPackageNode(name: string): boolean {
  const s = normalizeTargetLabel(String(name || ""));
  return s.startsWith("//third_party/providers:");
}
