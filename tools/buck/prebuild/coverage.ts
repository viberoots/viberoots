#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readCompositeGraph } from "../../lib/graph-view.ts";
import { providersForLabels } from "../../lib/labels.ts";

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

function providerExistsFactory(
  providerIndex: Record<string, unknown>,
  targetsNodeText: string,
): (fq: string) => boolean {
  return (fq: string): boolean => {
    if (!fq || !fq.startsWith("//third_party/providers:")) return false;
    if (providerIndex[fq]) return true;
    const tail = fq.split(":")[1] || "";
    if (tail.startsWith("lf_")) {
      return targetsNodeText.includes(`name="${tail}"`);
    }
    if (tail.startsWith("nix_")) {
      const stamp = path.join("third_party", "providers", "stamps", `${tail}.stamp`);
      return fs.existsSync(stamp);
    }
    return false;
  };
}

export async function computeCoverageMissing(): Promise<CoverageMiss[]> {
  const coverageMissing: CoverageMiss[] = [];
  try {
    const autoMapPath = path.join("third_party", "providers", "auto_map.bzl");
    let autoMapText = "";
    try {
      autoMapText = await fsp.readFile(autoMapPath, "utf8");
    } catch {}
    const moduleProviders = parseModuleProviders(autoMapText);

    const comp = await readCompositeGraph();
    const providerIndex = comp.providerIndex || {};

    const targetsNodeAutoPath = path.join("third_party", "providers", "TARGETS.node.auto");
    const targetsNodeText = fs.existsSync(targetsNodeAutoPath)
      ? await fsp.readFile(targetsNodeAutoPath, "utf8").catch(() => "")
      : "";
    const providerExists = providerExistsFactory(providerIndex, targetsNodeText);

    for (const n of comp.nodes) {
      const nodeName = (n as any)?.name || "";
      if (!nodeName) continue;
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
