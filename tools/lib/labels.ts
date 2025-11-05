#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import {
  normalizeNixAttr,
  providerNameForImporter,
  providerNameForModuleKey,
  providerNameForNixAttr,
} from "./providers";

function fqProviderLabel(name: string): string {
  return `//third_party/providers:${name}`;
}

// Returns fully qualified provider labels for supported mapping labels.

let cachedProviderIndex: Set<string> | null = null;
function loadProviderIndexIfPresent(): Set<string> | null {
  if (cachedProviderIndex) return cachedProviderIndex;
  try {
    const p = "third_party/providers/provider_index.json";
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, { kind: string; key: string }>;
    cachedProviderIndex = new Set(Object.keys(obj || {}));
    return cachedProviderIndex;
  } catch {
    return null;
  }
}

export function providersForLabels(labels: string[] | undefined): string[] {
  const out = new Set<string>();
  const index = loadProviderIndexIfPresent();
  for (const l of labels || []) {
    if (l.startsWith("lockfile:")) {
      const rest = l.slice("lockfile:".length);
      const [path, importer = ""] = rest.split("#");
      if (!path || !importer) continue;
      out.add(fqProviderLabel(providerNameForImporter(path, importer)));
    } else if (l.startsWith("nixpkg:")) {
      const attr = normalizeNixAttr(l.slice("nixpkg:".length));
      out.add(fqProviderLabel(providerNameForNixAttr(attr)));
    } else if (l.startsWith("module:")) {
      // Gate Go module providers on provider index presence to avoid dangling deps
      if (!index) continue;
      const key = l.slice("module:".length).toLowerCase();
      const at = key.lastIndexOf("@");
      if (at <= 0) continue;
      const imp = key.slice(0, at);
      const ver = key.slice(at + 1);
      const name = providerNameForModuleKey(imp, ver);
      const fq = fqProviderLabel(name);
      if (index.has(fq)) out.add(fq);
    }
  }
  return Array.from(out).sort();
}
