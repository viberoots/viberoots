#!/usr/bin/env zx-wrapper
import {
  normalizeNixAttr,
  providerNameForImporter,
  providerNameForModuleKey,
  providerNameForNixAttr,
} from "./providers";

function fqProviderLabel(name: string): string {
  return `//third_party/providers:${name}`;
}

export function providersForLabels(labels: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const l of labels || []) {
    if (l.startsWith("module:")) {
      const key = l.slice("module:".length).toLowerCase();
      const at = key.lastIndexOf("@");
      if (at <= 0) continue;
      const imp = key.slice(0, at);
      const ver = key.slice(at + 1);
      out.add(fqProviderLabel(providerNameForModuleKey(imp, ver)));
    } else if (l.startsWith("lockfile:")) {
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
