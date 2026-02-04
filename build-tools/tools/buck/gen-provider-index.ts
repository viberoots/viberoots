#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "../lib/fs-helpers.ts";
import { readCompositeGraph } from "../lib/graph-view.ts";
import { getFlagStr } from "../lib/cli.ts";
import { parseLockfileLabel } from "../lib/labels.ts";
import { isSupportedImporterLabel } from "../lib/importers.ts";
import { normalizeNixAttr } from "../lib/providers.ts";
import { readImporterProviderIndexEntriesForSingleImporterLockfileBasenames } from "../lib/provider-index.ts";

type PatchScope = "package-local" | "importer-local";

type PatchInputsExpectedIn = {
  // True when patch invalidation is expected to come from real action inputs (e.g., srcs/resources)
  // attached by macros and/or shared wiring helpers.
  macroActionInputs: boolean;
  // "diagnostic": the provider records patch paths for visibility, but they are not action inputs.
  // "none": provider has no patch-path surface.
  providerPatchPaths: "none" | "diagnostic";
};

type IndexEntry = {
  kind: "node" | "cpp" | "python";
  key: string;
  // Additive diagnostics (keep kind/key stable for existing consumers)
  patch_scope: PatchScope;
  languages: Array<"go" | "cpp" | "node" | "python">;
  patch_inputs_expected_in: PatchInputsExpectedIn;
};

function fq(labelTail: string): string {
  return `//third_party/providers:${labelTail}`;
}

async function generateNodeLockIndex(outFile = "build-tools/tools/buck/node-lock-index.json") {
  const SIDE_SCHEMA = "https://example.com/schemas/node-lock-index.schema.json";
  const SCHEMA_VERSION = 1;

  // Read via Composite Graph API; tolerate missing graph.json by exiting quietly
  let comp: any = null;
  try {
    comp = await readCompositeGraph({});
  } catch {
    // Missing graph.json or unreadable graph — skip sidecar emission in this mode
    return;
  }
  const nodes = Array.isArray(comp?.nodes) ? comp.nodes : [];
  if (!nodes.length) return;
  const idx: Record<string, string> = {};
  for (const n of nodes) {
    const name = String(n?.name || "");
    if (!name) continue;
    const labs = Array.isArray(n.labels) ? (n.labels as string[]) : [];
    const locks = labs.filter((l) => l.startsWith("lockfile:"));
    if (locks.length !== 1) continue;
    const parsed = parseLockfileLabel(locks[0]);
    if (!parsed) continue;
    if (!isSupportedImporterLabel(parsed.importer)) continue;
    idx[name] = locks[0].toLowerCase();
  }
  // Deterministic order
  const ordered: Record<string, string> = {};
  for (const k of Object.keys(idx).sort((a, b) => a.localeCompare(b))) {
    ordered[k] = idx[k];
  }
  const data = {
    $schema: SIDE_SCHEMA,
    version: SCHEMA_VERSION,
    index: ordered,
  };
  await writeIfChanged(outFile, JSON.stringify(data, null, 2) + "\n");
}

function patchInputsExpectedForPatchScope(scope: PatchScope): PatchInputsExpectedIn {
  if (scope === "package-local") {
    return { macroActionInputs: true, providerPatchPaths: "none" };
  }
  // Importer-local providers may record patch paths, but invalidation is driven by macro action inputs.
  return { macroActionInputs: true, providerPatchPaths: "diagnostic" };
}

async function parseNixProvidersFromTargetsFile(
  fileRel: string,
): Promise<Array<{ name: string; attr: string }>> {
  let txt = "";
  try {
    txt = await fsp.readFile(path.resolve(fileRel), "utf8");
  } catch {
    return [];
  }
  if (!txt) return [];
  const out: Array<{ name: string; attr: string }> = [];
  const reCall = /nix_cxx_(?:library|provider)\(\s*([\s\S]*?)\)/g;
  let m: RegExpExecArray | null;
  while ((m = reCall.exec(txt)) !== null) {
    const body = m[1] || "";
    const nameMatch = /\bname\s*=\s*"([^"]+)"/.exec(body);
    const attrMatch = /\battr\s*=\s*"([^"]+)"/.exec(body);
    const name = nameMatch?.[1] || "";
    const attr = attrMatch?.[1] || "";
    if (!name || !attr) continue;
    out.push({ name, attr });
  }
  return out;
}

async function generateNixAttrMap(
  outFile = "third_party/providers/nix_attr_map.bzl",
): Promise<Record<string, string>> {
  const sources = ["third_party/providers/TARGETS", "third_party/providers/TARGETS.cpp.auto"];
  const entries: Array<{ provider: string; nixpkg: string }> = [];
  for (const src of sources) {
    for (const { name, attr } of await parseNixProvidersFromTargetsFile(src)) {
      const provider = `//third_party/providers:${name}`;
      const nixpkg = `nixpkg:${normalizeNixAttr(attr)}`;
      entries.push({ provider, nixpkg });
    }
  }
  // Deterministic order, first-wins.
  const map: Record<string, string> = {};
  for (const e of entries.sort((a, b) => a.provider.localeCompare(b.provider))) {
    if (!map[e.provider]) map[e.provider] = e.nixpkg;
  }

  const lines = [
    "# GENERATED FILE — DO NOT EDIT.",
    "",
    "NIX_ATTR_MAP = {",
    ...Object.entries(map).map(([k, v]) => `    "${k}": "${v}",`),
    "}",
    "",
  ];
  await writeIfChanged(outFile, lines.join("\n"));
  return map;
}

async function readCppIndexEntries(): Promise<Record<string, IndexEntry>> {
  const out: Record<string, IndexEntry> = {};
  const nixAttrMap = await generateNixAttrMap();
  for (const [provider, key] of Object.entries(nixAttrMap)) {
    // These nixpkgs-backed providers are used by both Go (CGO) and C++.
    out[provider] = {
      kind: "cpp",
      key,
      patch_scope: "package-local",
      languages: ["go", "cpp"],
      patch_inputs_expected_in: patchInputsExpectedForPatchScope("package-local"),
    };
  }
  return out;
}

async function readNodeIndexEntries(): Promise<Record<string, IndexEntry>> {
  const out: Record<string, IndexEntry> = {};
  const entries = await readImporterProviderIndexEntriesForSingleImporterLockfileBasenames({
    lockfileBasenames: ["pnpm-lock.yaml"],
    requireNodeModule: "yaml",
    onMissingRequiredModule: "return-empty",
    shouldInclude: (_lf: string, importerLabel: string) => isSupportedImporterLabel(importerLabel),
  });
  for (const e of entries) {
    out[fq(e.provider)] = {
      kind: "node",
      key: e.key,
      patch_scope: "importer-local",
      languages: ["node"],
      patch_inputs_expected_in: patchInputsExpectedForPatchScope("importer-local"),
    };
  }
  return out;
}

async function readPythonIndexEntries(): Promise<Record<string, IndexEntry>> {
  const out: Record<string, IndexEntry> = {};
  const entries = await readImporterProviderIndexEntriesForSingleImporterLockfileBasenames({
    lockfileBasenames: ["uv.lock"],
    shouldInclude: (_lf: string, importerLabel: string) => isSupportedImporterLabel(importerLabel),
  });
  for (const e of entries) {
    out[fq(e.provider)] = {
      kind: "python",
      key: e.key,
      patch_scope: "importer-local",
      languages: ["python"],
      patch_inputs_expected_in: patchInputsExpectedForPatchScope("importer-local"),
    };
  }
  return out;
}

export async function generateProviderIndex(opts?: { outFile?: string; jsonOutFile?: string }) {
  const OUT = opts?.outFile || "third_party/providers/provider_index.bzl";
  const OUT_JSON = opts?.jsonOutFile || "third_party/providers/provider_index.json";

  const maps: Record<string, IndexEntry>[] = await Promise.all([
    readNodeIndexEntries(),
    readCppIndexEntries(),
    readPythonIndexEntries(),
  ]);

  const merged = new Map<string, IndexEntry>();
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) {
      if (!merged.has(k)) merged.set(k, v);
    }
  }
  const entries = Array.from(merged.entries()).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );

  const header = ["# GENERATED FILE — DO NOT EDIT.", "", "PROVIDER_INDEX = {"];
  const body = entries.map(([k, v]) => {
    const langs = v.languages.map((x) => `"${x}"`).join(", ");
    return `    "${k}": { "kind": "${v.kind}", "key": "${v.key}", "patch_scope": "${v.patch_scope}", "languages": [${langs}], "patch_inputs_expected_in": { "macroActionInputs": ${v.patch_inputs_expected_in.macroActionInputs ? "True" : "False"}, "providerPatchPaths": "${v.patch_inputs_expected_in.providerPatchPaths}" } },`;
  });
  const footer = ["}", ""]; // trailing newline
  const text = [...header, ...(body.length ? ["", ...body] : []), ...footer].join("\n");
  await writeIfChanged(OUT, text);

  // Also emit a JSON sidecar for machine consumption
  const jsonObj: Record<string, IndexEntry> = {};
  for (const [k, v] of entries) {
    jsonObj[k] = v;
  }
  await writeIfChanged(OUT_JSON, JSON.stringify(jsonObj, null, 2) + "\n");

  // Emit Node lockfile sidecar from the current graph (kept adapter-agnostic)
  await generateNodeLockIndex();
}

async function main() {
  const OUT = getFlagStr("out", "third_party/providers/provider_index.bzl");
  await generateProviderIndex({ outFile: OUT });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
