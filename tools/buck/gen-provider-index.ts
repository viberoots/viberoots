#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { writeIfChanged } from "../lib/fs-helpers.ts";
import { readGoEntries } from "./providers/go.ts";
import { readNodeProviderIndexEntries } from "./providers/node.ts";

type IndexEntry = { kind: "go" | "node" | "cpp"; key: string };

function fq(labelTail: string): string {
  return `//third_party/providers:${labelTail}`;
}

async function readCppIndexEntries(): Promise<Record<string, IndexEntry>> {
  const out: Record<string, IndexEntry> = {};
  const mapFile = path.resolve("third_party/providers/nix_attr_map.bzl");
  if (!(await fs.pathExists(mapFile))) return out;
  const txt = await fs.readFile(mapFile, "utf8").catch(() => "");
  if (!txt) return out;
  // Parse lines like: "//third_party/providers:<name>": "nixpkg:<attr>",
  const re = /"(\/\/third_party\/providers:[^"]+)"\s*:\s*"(nixpkg:[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt)) !== null) {
    const fqLabel = m[1];
    const key = m[2];
    out[fqLabel] = { kind: "cpp", key };
  }
  return out;
}

async function readGoIndexEntries(): Promise<Record<string, IndexEntry>> {
  const out: Record<string, IndexEntry> = {};
  const entries = await readGoEntries({});
  for (const e of entries) {
    out[fq(e.provider)] = { kind: "go", key: `module:${e.moduleKey}` };
  }
  return out;
}

async function readNodeIndexEntries(): Promise<Record<string, IndexEntry>> {
  const out: Record<string, IndexEntry> = {};
  const entries = await readNodeProviderIndexEntries();
  for (const e of entries) {
    out[fq(e.provider)] = { kind: "node", key: e.key };
  }
  return out;
}

export async function generateProviderIndex(opts?: { outFile?: string; jsonOutFile?: string }) {
  const OUT = opts?.outFile || "third_party/providers/provider_index.bzl";
  const OUT_JSON = opts?.jsonOutFile || "third_party/providers/provider_index.json";

  const maps: Record<string, IndexEntry>[] = await Promise.all([
    readGoIndexEntries(),
    readNodeIndexEntries(),
    readCppIndexEntries(),
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
  const body = entries.map(([k, v]) => `    "${k}": { "kind": "${v.kind}", "key": "${v.key}" },`);
  const footer = ["}", ""]; // trailing newline
  const text = [...header, ...(body.length ? ["", ...body] : []), ...footer].join("\n");
  await writeIfChanged(OUT, text);

  // Also emit a JSON sidecar for machine consumption
  const jsonObj: Record<string, { kind: string; key: string }> = {};
  for (const [k, v] of entries) {
    jsonObj[k] = { kind: v.kind, key: v.key };
  }
  await writeIfChanged(OUT_JSON, JSON.stringify(jsonObj, null, 2) + "\n");
}

async function main() {
  const OUT = (argv.out as string) || "third_party/providers/provider_index.bzl";
  await generateProviderIndex({ outFile: OUT });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
