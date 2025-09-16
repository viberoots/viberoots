#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import crypto from "node:crypto";
import { providerNameForImporter, providerNameForModuleKey } from "../lib/providers";

type Node = {
  name: string;
  rule_type?: string;
  labels?: string[];
};

const graphPath = (argv.graph as string) || "tools/buck/graph.json";
const outPath = (argv.out as string) || "third_party/providers/auto_map.bzl";

function writeIfChanged(dst: string, data: string) {
  return (async () => {
    if (await fs.pathExists(dst)) {
      const cur = await fs.readFile(dst, "utf8");
      const a = crypto.createHash("sha256").update(cur).digest("hex");
      const b = crypto.createHash("sha256").update(data).digest("hex");
      if (a === b) {
        console.log(`no-op (already applied): ${dst}`);
        return;
      }
    }
    await fs.outputFile(dst, data, "utf8");
    console.log("wrote", dst);
  })();
}

function fqProviderLabel(name: string): string {
  return `//third_party/providers:${name}`;
}

function providersForLabels(labels: string[] | undefined): string[] {
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
    }
  }
  return Array.from(out).sort();
}

async function main() {
  const txt = await fs.readFile(graphPath, "utf8");
  const nodes = JSON.parse(txt) as Node[] | Record<string, any>;
  const list: Node[] = Array.isArray(nodes) ? (nodes as Node[]) : (Object.values(nodes) as Node[]);
  const mapping: Record<string, string[]> = {};
  for (const n of list) {
    const provs = providersForLabels(n.labels);
    if (provs.length > 0 && n.name) mapping[n.name] = provs;
  }
  const keys = Object.keys(mapping).sort();
  const body = keys
    .map((k) => `    "${k}": [\n${mapping[k].map((p) => `        "${p}",`).join("\n")}\n    ],`)
    .join("\n\n");
  const header = `# //third_party/providers/auto_map.bzl\n# GENERATED FILE — DO NOT EDIT.\n\nMODULE_PROVIDERS = {\n`;
  const footer = `\n}\n`;
  const data = header + body + footer;
  await writeIfChanged(outPath, data);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
