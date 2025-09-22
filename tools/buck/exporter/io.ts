#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import { Node } from "./types";

export const attrList = [
  "name",
  "rule_type",
  "srcs",
  "deps",
  "labels",
  "args",
  "env",
  "main",
  "main_class",
  "includes",
  "defines",
  "cflags",
  "ldflags",
];

export async function cqueryNodes(scope: string, attrs: string[]): Promise<Node[]> {
  const query = scope ? `attrfilter(labels, ${scope}, //...)` : `//...`;
  const flags = attrs.flatMap((a) => ["--output-attribute", a]);
  const platformFlags = ["--target-platforms", "prelude//platforms:default"];
  const { stdout } = await $`buck2 cquery ${platformFlags} ${query} --json ${flags}`;
  const obj = JSON.parse(String(stdout)) as Record<string, any>;
  return Object.values(obj) as any[];
}

export async function readSimulatedNodes(path: string): Promise<Node[]> {
  const txt = await fs.readFile(path, "utf8");
  return JSON.parse(txt) as Node[];
}

export async function writeIfChangedJSON(file: string, data: any) {
  const { writeIfChanged } = await import("../../lib/fs-helpers.ts");
  const txt = JSON.stringify(data, null, 2) + "\n";
  await writeIfChanged(file, txt);
}

export function parseArgs(argv: any): {
  out: string;
  scope: string;
  simulate: string;
  maxParallel: number;
  cacheDir: string;
  metricsOut: string;
} {
  return {
    out: (argv.out as string) || "tools/buck/graph.json",
    scope: (argv.scope as string) || "",
    simulate: (argv.simulate as string) || "",
    maxParallel: Number(argv["max-parallel"] || 4),
    cacheDir: (argv["cache-dir"] as string) || "tools/buck/.export-cache",
    metricsOut: (argv["metrics-out"] as string) || "",
  };
}
