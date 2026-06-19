#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { isProviderPackageNode } from "../../lib/graph-utils";
import { readCompositeGraph } from "../../lib/graph-view";
import { providersForLabels } from "../../lib/labels";
import { DEFAULT_AUTO_MAP_PATH, WORKSPACE_PROVIDER_DIR } from "../../lib/workspace-state-paths";

export type CoverageMiss =
  | { kind: "provider"; node: string; provider: string }
  | { kind: "mapping"; node: string; provider: string };

function parseModuleProviders(txt: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!txt) return out;
  const lines = txt.split(/\r?\n/);
  let curKey: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!curKey) {
      const m = line.match(/^"([^"]+)":\s*\[$/);
      if (m) {
        curKey = m[1];
        if (!out[curKey]) out[curKey] = [];
      }
    } else {
      if (line === "],") {
        curKey = null;
        continue;
      }
      const m = line.match(/^"([^"]+)",$/);
      if (m) {
        out[curKey].push(m[1]);
      }
    }
  }
  return out;
}

async function readAllAutoFilesCombined(): Promise<string> {
  try {
    if (!fs.existsSync(WORKSPACE_PROVIDER_DIR)) return "";
    const autoFiles = fs
      .readdirSync(WORKSPACE_PROVIDER_DIR)
      .filter((n) => /^TARGETS\..*\.auto$/.test(n))
      .map((n) => path.join(WORKSPACE_PROVIDER_DIR, n));
    if (!autoFiles.length) return "";
    const texts: string[] = [];
    for (const f of autoFiles) {
      try {
        const t = await fsp.readFile(f, "utf8").catch(() => "");
        if (t) texts.push(t);
      } catch {}
    }
    return texts.join("\n\n");
  } catch {
    return "";
  }
}

function providerExistsFactory(
  providerIndex: Record<string, unknown>,
  autosCombinedText: string,
): (fq: string) => boolean {
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (fq: string): boolean => {
    if (!fq || !fq.startsWith("workspace_providers//:")) return false;
    if (providerIndex[fq]) return true;
    const tail = fq.split(":")[1] || "";
    if (tail.startsWith("lf_") || tail.startsWith("nix_")) {
      // Fallback: scan across all TARGETS.*.auto files (Node, Python, etc.)
      if (autosCombinedText.includes(`name="${tail}"`)) return true;
      const re = new RegExp(`\\bname\\s*=\\s*"${escapeRegExp(tail)}"`, "m");
      return re.test(autosCombinedText);
    }
    return false;
  };
}

export async function computeCoverageMissing(): Promise<CoverageMiss[]> {
  const coverageMissing: CoverageMiss[] = [];
  try {
    let autoMapText = "";
    try {
      autoMapText = await fsp.readFile(DEFAULT_AUTO_MAP_PATH, "utf8");
    } catch {}
    const moduleProviders = parseModuleProviders(autoMapText);

    const comp = await readCompositeGraph();
    const providerIndex = comp.providerIndex || {};

    const autosCombinedText = await readAllAutoFilesCombined();
    const providerExists = providerExistsFactory(providerIndex, autosCombinedText);

    for (const n of comp.nodes) {
      const nodeName = (n as any)?.name || "";
      if (!nodeName) continue;
      if (isProviderPackageNode(nodeName)) continue;
      const expected = providersForLabels((n as any).labels);
      if (expected.length === 0) continue;
      for (const prov of expected) {
        if (!providerExists(prov)) {
          coverageMissing.push({ kind: "provider", node: nodeName, provider: prov });
          continue;
        }
        const mapped = (moduleProviders[nodeName] || []).includes(prov);
        if (!mapped) {
          coverageMissing.push({ kind: "mapping", node: nodeName, provider: prov });
        }
      }
    }
  } catch {}
  return coverageMissing;
}
