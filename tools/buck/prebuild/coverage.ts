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

async function readAllAutoFilesCombined(): Promise<string> {
  try {
    const dir = path.join("third_party", "providers");
    if (!fs.existsSync(dir)) return "";
    const names = fs.readdirSync(dir);
    const autoFiles = names.filter((n) => /^TARGETS\..*\.auto$/.test(n));
    if (!autoFiles.length) return "";
    const texts: string[] = [];
    for (const f of autoFiles) {
      try {
        const p = path.join(dir, f);
        const t = await fsp.readFile(p, "utf8").catch(() => "");
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
    if (!fq || !fq.startsWith("//third_party/providers:")) return false;
    if (providerIndex[fq]) return true;
    const tail = fq.split(":")[1] || "";
    if (tail.startsWith("lf_")) {
      // Fallback: scan across all TARGETS.*.auto files (Node, Python, etc.)
      if (autosCombinedText.includes(`name="${tail}"`)) return true;
      const re = new RegExp(`\\bname\\s*=\\s*"${escapeRegExp(tail)}"`, "m");
      return re.test(autosCombinedText);
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

    const autosCombinedText = await readAllAutoFilesCombined();
    const providerExists = providerExistsFactory(providerIndex, autosCombinedText);

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
