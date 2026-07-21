import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";

export type CommandSiteRole =
  | "canonical-artifact"
  | "live-d"
  | "update-install"
  | "non-artifact-orchestration";

export type CommandSiteRule = {
  pathPattern: string;
  role: CommandSiteRole;
  justification: string;
};

export type CommandSiteInventoryPolicy = {
  schemaVersion: 1;
  expectedCount: number;
  expectedDigest: string;
  classificationRules: CommandSiteRule[];
};

type CommandSite = {
  path: string;
  kind: string;
  line: number;
  signature: string;
  role: CommandSiteRole;
};

const allowedRoles = new Set<CommandSiteRole>([
  "canonical-artifact",
  "live-d",
  "update-install",
  "non-artifact-orchestration",
]);
const sourceExtensions = new Set([".ts", ".js", ".mjs", ".cjs", ".bzl", ".nix", ".sh", ".bash"]);
const excludedSegments = new Set([".git", ".viberoots", "buck-out", "node_modules", "tests"]);

function patternsForExtension(ext: string): Array<{ kind: string; regex: RegExp }> {
  if ([".ts", ".js", ".mjs", ".cjs"].includes(ext)) {
    return [
      {
        kind: "process-call",
        regex:
          /(?<![.\w])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|runCommand|runBoundedArtifactCommand)\s*\(/g,
      },
      { kind: "zx-command", regex: /\$\s*(?:\([^`]*\))?\s*`/g },
    ];
  }
  if (ext === ".bzl") {
    return [
      { kind: "buck-action", regex: /\bctx\.actions\.(?:run|run_shell)\s*\(/g },
      { kind: "genrule", regex: /\b(?:native\.)?genrule\s*\(/g },
      { kind: "action-command", regex: /^\s*(?:cmd|run_cmd)\s*=/g },
    ];
  }
  if (ext === ".nix") {
    return [
      {
        kind: "nix-derivation",
        regex:
          /\b(?:runCommandLocal|runCommand|stdenvNoCC\.mkDerivation|stdenv\.mkDerivation|mkDerivation|writeShellScriptBin|writeShellScript|writeScriptBin|writeScript)\b/g,
      },
    ];
  }
  return [{ kind: "shell-nix-buck", regex: /(^|[;&|({]\s*)(?:nix|nix-store|buck2)(?:\s|$)/g }];
}

async function productionSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(abs: string, rel: string): Promise<void> {
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || excludedSegments.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        await visit(childAbs, childRel);
      } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
        files.push(childRel);
      }
    }
  }
  await visit(path.join(root, "build-tools"), "build-tools");
  return files.sort();
}

function validatePolicy(policy: CommandSiteInventoryPolicy): void {
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.classificationRules)) {
    throw new Error(
      "command-site inventory policy must use schemaVersion 1 and classificationRules",
    );
  }
  for (const rule of policy.classificationRules) {
    if (!allowedRoles.has(rule.role) || !rule.pathPattern || !rule.justification) {
      throw new Error(
        "command-site inventory rule requires a reviewed role, pathPattern, and justification",
      );
    }
    new RegExp(rule.pathPattern);
  }
}

function classifySite(rel: string, rules: CommandSiteRule[]): CommandSiteRole | null {
  for (const rule of rules) {
    if (new RegExp(rule.pathPattern).test(rel)) return rule.role;
  }
  return null;
}

export async function inspectProductionCommandSites(
  root: string,
  policy: CommandSiteInventoryPolicy,
): Promise<{ count: number; digest: string; roleCounts: Record<CommandSiteRole, number> }> {
  validatePolicy(policy);
  const sites: CommandSite[] = [];
  const containingFiles = new Map<string, string>();
  for (const rel of await productionSourceFiles(root)) {
    const source = await fsp.readFile(path.join(root, rel), "utf8");
    const ext = path.extname(rel);
    const lines = source.split(/\r?\n/);
    let hasSite = false;
    const occurrences = new Map<string, number>();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const { kind, regex } of patternsForExtension(ext)) {
        regex.lastIndex = 0;
        while (regex.exec(line)) {
          const occurrence = (occurrences.get(kind) || 0) + 1;
          occurrences.set(kind, occurrence);
          const role = classifySite(rel, policy.classificationRules);
          if (!role) throw new Error(`unclassified production command site: ${rel}:${index + 1}`);
          sites.push({
            path: rel,
            kind,
            line: index + 1,
            signature: `${kind}#${occurrence}`,
            role,
          });
          hasSite = true;
          if (regex.lastIndex === 0) break;
        }
      }
    }
    if (hasSite) {
      containingFiles.set(
        rel,
        createHash("sha256").update(source.replace(/\s+/g, "")).digest("hex"),
      );
    }
  }
  sites.sort((a, b) =>
    `${a.path}:${a.kind}:${a.signature}`.localeCompare(`${b.path}:${b.kind}:${b.signature}`),
  );
  const stableSites = sites.map(({ path: sitePath, kind, signature, role }) => ({
    path: sitePath,
    kind,
    signature,
    role,
  }));
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        sites: stableSites,
        files: [...containingFiles].sort(([a], [b]) => a.localeCompare(b)),
      }),
    )
    .digest("hex");
  const roleCounts: Record<CommandSiteRole, number> = {
    "canonical-artifact": 0,
    "live-d": 0,
    "update-install": 0,
    "non-artifact-orchestration": 0,
  };
  for (const site of sites) roleCounts[site.role] += 1;
  return { count: sites.length, digest, roleCounts };
}

export async function enforceProductionCommandSiteInventory(
  root: string,
  policy: CommandSiteInventoryPolicy,
): Promise<Record<CommandSiteRole, number>> {
  const actual = await inspectProductionCommandSites(root, policy);
  if (actual.count !== policy.expectedCount || actual.digest !== policy.expectedDigest) {
    throw new Error(
      `production command-site inventory changed: expected count=${policy.expectedCount} digest=${policy.expectedDigest}; ` +
        `actual count=${actual.count} digest=${actual.digest}. Classify and review the changed executor sites before updating policy.`,
    );
  }
  return actual.roleCounts;
}
