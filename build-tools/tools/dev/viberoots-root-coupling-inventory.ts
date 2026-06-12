#!/usr/bin/env zx-wrapper
import { spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFlagBool, getFlagStr } from "../lib/cli";

type Example = { file: string; line: number; text: string };
type Finding = { id: string; description: string; count: number; examples: Example[] };

const SKIP_DIRS = new Set([".git", ".direnv", "buck-out", "node_modules"]);

const PATTERNS: { id: string; description: string; test: (line: string) => boolean }[] = [
  {
    id: "buck_build_tools_label",
    description: "Buck labels rooted at //build-tools",
    test: (line) => /\/\/build-tools\b/.test(line),
  },
  {
    id: "workspace_root_build_tools_path",
    description: "Shell paths rooted at $WORKSPACE_ROOT/build-tools",
    test: (line) => /\$(?:\{WORKSPACE_ROOT\}|WORKSPACE_ROOT)\/build-tools\b/.test(line),
  },
  {
    id: "flk_root_build_tools_path",
    description: "Shell paths rooted at $FLK_ROOT/build-tools",
    test: (line) => /\$(?:\{FLK_ROOT\}|FLK_ROOT)\/build-tools\b/.test(line),
  },
  {
    id: "third_party_providers_label",
    description: "Buck labels rooted at //third_party/providers",
    test: (line) => /\/\/third_party\/providers\b/.test(line),
  },
  {
    id: "third_party_providers_path",
    description: "Filesystem paths rooted at third_party/providers",
    test: (line) => /(^|[^/])third_party\/providers\b/.test(line),
  },
];

function trackedFiles(root: string): string[] {
  const out = spawnSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (out.status !== 0 || !out.stdout.trim()) return [];
  return out.stdout.split("\0").filter(Boolean);
}

async function walkedFiles(root: string, dir = ""): Promise<string[]> {
  const entries = await fsp.readdir(path.join(root, dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walkedFiles(root, rel)));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

function emptyFindings(exampleLimit: number): Map<string, Finding> {
  return new Map(
    PATTERNS.map((pattern) => [
      pattern.id,
      {
        id: pattern.id,
        description: pattern.description,
        count: 0,
        examples: [] as Example[],
      },
    ]),
  );
}

async function readText(file: string): Promise<string | null> {
  try {
    const data = await fsp.readFile(file);
    if (data.includes(0)) return null;
    return data.toString("utf8");
  } catch {
    return null;
  }
}

export async function collectInventory(root: string, exampleLimit = 3): Promise<Finding[]> {
  const absRoot = path.resolve(root);
  const files = trackedFiles(absRoot);
  const relFiles = files.length > 0 ? files : await walkedFiles(absRoot);
  const findings = emptyFindings(exampleLimit);

  for (const rel of relFiles.sort()) {
    const text = await readText(path.join(absRoot, rel));
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || "";
      for (const pattern of PATTERNS) {
        if (!pattern.test(line)) continue;
        const finding = findings.get(pattern.id)!;
        finding.count++;
        if (finding.examples.length < exampleLimit) {
          finding.examples.push({ file: rel, line: i + 1, text: line.trim() });
        }
      }
    }
  }
  return Array.from(findings.values());
}

function printText(findings: Finding[]): void {
  console.log("Viberoots root-coupling inventory");
  for (const finding of findings) {
    console.log(`\n${finding.id}: ${finding.count}`);
    console.log(`  ${finding.description}`);
    for (const example of finding.examples) {
      console.log(`  - ${example.file}:${example.line}: ${example.text}`);
    }
  }
}

async function main(): Promise<void> {
  const root = getFlagStr("root", process.cwd());
  const examples = Number(getFlagStr("examples", "3"));
  const findings = await collectInventory(root, Number.isFinite(examples) ? examples : 3);
  if (getFlagBool("json")) console.log(JSON.stringify({ findings }, null, 2));
  else printText(findings);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
