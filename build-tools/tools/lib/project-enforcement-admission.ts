import * as fsp from "node:fs/promises";
import path from "node:path";
import type { ProjectEnforcementRunner } from "./project-enforcement-registration";
import { hasUnsafeFilesystemCapability } from "./project-enforcement-fs-admission";

const PROHIBITED_PATH_PARTS = [
  "/dev/install/",
  "/dev/update-pnpm-hash",
  "/services/",
  "/tests/lib/test-helpers/",
];
const ALLOWED_NODE_IMPORTS = new Set(["node:fs", "node:fs/promises", "node:path"]);

const PROHIBITED_SOURCE = [
  { pattern: /\brunInTemp\s*\(/, operation: "temp consumer creation" },
  { pattern: /\bmkdtemp\s*\(/, operation: "broad temp creation" },
  { pattern: /\b(?:spawn|fork)\s*\(/, operation: "unreviewed child process startup" },
  { pattern: /\b(?:createServer|startDevServer)\s*\(/, operation: "service startup" },
  { pattern: /\.listen\s*\(/, operation: "service listener startup" },
  {
    pattern: /\b(?:nix|nix-store|pnpm|buck2)\s+(?:build|develop|install|test|run)\b/,
    operation: "heavy tool execution",
  },
  {
    pattern: /\b(?:updatePnpmHash|requireUnifiedPnpmStore|linkNodeModules)\s*\(/,
    operation: "dependency-cache population",
  },
  { pattern: /\bimport\s*\(/, operation: "dynamic import outside the reviewed graph" },
  { pattern: /\brequire\s*\(/, operation: "CommonJS loading outside the reviewed graph" },
  { pattern: /\bfetch\s*\(/, operation: "network access" },
  { pattern: /\bawait\s+\$\s*`/, operation: "unreviewed command execution" },
];

function staticModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [
    /\bimport\s*["']([^"']+)["']/g,
    /\b(?:import|export)\s+[^;]*?\bfrom\s*["']([^"']+)["']/g,
  ]) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]!);
  }
  return specifiers;
}

async function resolveLocalImport(from: string, specifier: string): Promise<string | null> {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.mjs`, path.join(base, "index.ts")]) {
    try {
      if ((await fsp.stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  throw new Error(`project-enforcement admission cannot resolve ${specifier} from ${from}`);
}

export async function projectEnforcementAdmissionViolations(
  runners: readonly ProjectEnforcementRunner[],
  viberootsRoot: string,
): Promise<string[]> {
  const root = path.resolve(viberootsRoot);
  const pending = runners.map((runner) => path.resolve(runner.sourcePath));
  const visited = new Set<string>();
  const violations: string[] = [];

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const rel = path.relative(root, file).replaceAll(path.sep, "/");
    if (rel.startsWith("../") || path.isAbsolute(rel)) {
      violations.push(`${rel}: import escapes the reviewed viberoots source`);
      continue;
    }
    if (PROHIBITED_PATH_PARTS.some((part) => `/${rel}`.includes(part))) {
      violations.push(`${rel}: imports a prohibited heavy subsystem`);
      continue;
    }
    const source = await fsp.readFile(file, "utf8");
    for (const rule of PROHIBITED_SOURCE) {
      if (rule.pattern.test(source)) violations.push(`${rel}: ${rule.operation}`);
    }
    if (hasUnsafeFilesystemCapability(source)) {
      violations.push(`${rel}: filesystem mutation capability`);
    }
    for (const specifier of staticModuleSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        if (!ALLOWED_NODE_IMPORTS.has(specifier)) {
          violations.push(`${rel}: imports unsupported capability ${specifier}`);
        }
        continue;
      }
      const imported = await resolveLocalImport(file, specifier);
      if (imported) pending.push(imported);
    }
  }
  return violations.sort();
}

export async function assertProjectEnforcementRunnerAdmission(
  runners: readonly ProjectEnforcementRunner[],
  viberootsRoot: string,
): Promise<void> {
  const violations = await projectEnforcementAdmissionViolations(runners, viberootsRoot);
  if (violations.length > 0) {
    throw new Error(`project-enforcement runner admission failed:\n${violations.join("\n")}`);
  }
}
