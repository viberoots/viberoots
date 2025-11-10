#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import { normalizeNixAttr, providerNameForImporter, providerNameForNixAttr } from "./providers";

function fqProviderLabel(name: string): string {
  return `//third_party/providers:${name}`;
}

// Returns fully qualified provider labels for supported mapping labels.

export function providersForLabels(labels: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const l of labels || []) {
    if (l.startsWith("lockfile:")) {
      const rest = l.slice("lockfile:".length);
      const [path, importer = ""] = rest.split("#");
      if (!path || !importer) continue;
      out.add(fqProviderLabel(providerNameForImporter(path, importer)));
    } else if (l.startsWith("nixpkg:")) {
      const attr = normalizeNixAttr(l.slice("nixpkg:".length));
      out.add(fqProviderLabel(providerNameForNixAttr(attr)));
    }
  }
  return Array.from(out).sort();
}
