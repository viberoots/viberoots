import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  activeSourceContains,
  patternsForCommandSite,
  productionCommandSiteSources,
  sourceRequiresInventoryFingerprint,
} from "./nix-gaps-command-site-sources";

export type CommandSiteRole =
  | "canonical-artifact"
  | "live-d"
  | "update-install"
  | "non-artifact-orchestration";

export type CommandSiteRule = {
  pathPattern: string;
  role: CommandSiteRole;
  justification: string;
  allowedEscapes?: Array<"diagnostic-impure">;
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
    for (const escape of rule.allowedEscapes || []) {
      if (escape !== "diagnostic-impure") {
        throw new Error(`unsupported command-site escape allowance: ${String(escape)}`);
      }
    }
  }
}

function classifySite(rel: string, rules: CommandSiteRule[]): CommandSiteRole | null {
  for (const rule of rules) {
    if (new RegExp(rule.pathPattern).test(rel)) return rule.role;
  }
  return null;
}

function classificationRule(rel: string, rules: CommandSiteRule[]): CommandSiteRule | null {
  return rules.find((rule) => new RegExp(rule.pathPattern).test(rel)) || null;
}

export async function inspectProductionCommandSites(
  root: string,
  policy: CommandSiteInventoryPolicy,
): Promise<{ count: number; digest: string; roleCounts: Record<CommandSiteRole, number> }> {
  validatePolicy(policy);
  const sites: CommandSite[] = [];
  const containingFiles = new Map<string, string>();
  for (const rel of await productionCommandSiteSources(root)) {
    const sourceBytes = await fsp.readFile(path.join(root, rel));
    const source = sourceBytes.toString("utf8");
    const fileRule = classificationRule(rel, policy.classificationRules);
    const fileRole = fileRule?.role || null;
    const requiresFingerprint = sourceRequiresInventoryFingerprint(rel);
    if (requiresFingerprint && !fileRule) {
      throw new Error(`unclassified production command source: ${rel}`);
    }
    if (
      fileRole === "canonical-artifact" &&
      activeSourceContains(
        rel === "flake.nix" ? source.replace(/^\s*"NIX_PNPM_ALLOW_GENERATE"\s*$/mu, "") : source,
        "NIX_PNPM_ALLOW_GENERATE",
      )
    ) {
      throw new Error(
        `canonical artifact route enables automatic pnpm lock generation: ${rel}. ` +
          "Artifact builds must fail with the u repair instruction.",
      );
    }
    if (
      (fileRole === "canonical-artifact" ||
        rel.startsWith("build-tools/tools/scaffolding/templates/")) &&
      activeSourceContains(source, "--impure") &&
      !fileRule?.allowedEscapes?.includes("diagnostic-impure")
    ) {
      throw new Error(
        `canonical artifact route contains unapproved --impure evaluation: ${rel}. ` +
          "Only the reviewed explicit diagnostic boundary may opt in.",
      );
    }
    let hasSite = false;
    const occurrences = new Map<string, number>();
    for (const { kind, regex } of patternsForCommandSite(rel, source)) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(source))) {
        const occurrence = (occurrences.get(kind) || 0) + 1;
        occurrences.set(kind, occurrence);
        const line = source.slice(0, match.index).split(/\r?\n/).length;
        const role = classifySite(rel, policy.classificationRules);
        if (!role) throw new Error(`unclassified production command site: ${rel}:${line}`);
        sites.push({
          path: rel,
          kind,
          line,
          signature: `${kind}#${occurrence}`,
          role,
        });
        hasSite = true;
        if (regex.lastIndex === 0) break;
      }
    }
    if (hasSite || requiresFingerprint) {
      containingFiles.set(rel, createHash("sha256").update(sourceBytes).digest("hex"));
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
