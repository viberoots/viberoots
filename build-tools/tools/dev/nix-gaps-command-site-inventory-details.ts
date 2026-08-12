import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  patternsForCommandSite,
  productionCommandSiteSources,
  sourceRequiresInventoryFingerprint,
} from "./nix-gaps-command-site-sources";
import type {
  CommandSiteInventoryPolicy,
  CommandSiteRole,
  CommandSiteRule,
} from "./nix-gaps-command-sites";

const execFileAsync = promisify(execFile);

type CommandSiteFile = {
  path: string;
  role: CommandSiteRole;
  siteCount: number;
};

function classifySite(rel: string, rules: CommandSiteRule[]): CommandSiteRole | null {
  for (const rule of rules) {
    if (new RegExp(rule.pathPattern).test(rel)) return rule.role;
  }
  return null;
}

async function changedGitPaths(root: string): Promise<Set<string>> {
  try {
    const { stdout: topLevel } = await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" },
    );
    if (path.resolve(topLevel.trim()) !== path.resolve(root)) return new Set();
    const args = [
      ["diff", "--name-only"],
      ["diff", "--cached", "--name-only"],
      ["ls-files", "--others", "--exclude-standard"],
    ];
    const values = await Promise.all(
      args.map(async (gitArgs) => {
        const { stdout } = await execFileAsync("git", ["-C", root, ...gitArgs], {
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        });
        return stdout
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean);
      }),
    );
    return new Set(values.flat());
  } catch {
    return new Set();
  }
}

async function commandSiteFiles(
  root: string,
  rules: CommandSiteRule[],
): Promise<CommandSiteFile[]> {
  const files: CommandSiteFile[] = [];
  for (const rel of await productionCommandSiteSources(root)) {
    const source = (await fsp.readFile(path.join(root, rel))).toString("utf8");
    const role = classifySite(rel, rules);
    if (!role) continue;
    const requiresFingerprint = sourceRequiresInventoryFingerprint(rel);
    let siteCount = 0;
    for (const { regex } of patternsForCommandSite(rel, source)) {
      regex.lastIndex = 0;
      while (regex.exec(source)) {
        siteCount += 1;
        if (regex.lastIndex === 0) break;
      }
    }
    if (siteCount > 0 || requiresFingerprint) files.push({ path: rel, role, siteCount });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function inventoryMismatchDetails(
  root: string,
  policy: CommandSiteInventoryPolicy,
  actual: { count: number },
): Promise<string> {
  const changed = await changedGitPaths(root);
  if (changed.size === 0) {
    return [
      "",
      "No git changed-file list was available for this root.",
      "Review production command-source changes, then update docs/handbook/nix-command-site-policy.json only after that review.",
    ].join("\n");
  }
  const inventoryFiles = await commandSiteFiles(root, policy.classificationRules);
  const changedInventoryFiles = inventoryFiles.filter((file) => changed.has(file.path));
  if (changedInventoryFiles.length === 0) {
    return [
      "",
      "No changed git paths matched current command-site inventory files.",
      "This usually means the mismatch came from generated/untracked executable surfaces, file mode changes, or an inventory source outside the current diff.",
      "Review production command-source changes before updating docs/handbook/nix-command-site-policy.json.",
    ].join("\n");
  }
  const lines = changedInventoryFiles
    .slice(0, 30)
    .map((file) => `- ${file.path} role=${file.role} command_sites=${file.siteCount}`);
  const omitted = changedInventoryFiles.length - lines.length;
  return [
    "",
    ...(actual.count === policy.expectedCount
      ? ["Command-site count is unchanged; review file content drift in command-capable sources."]
      : ["Command-site count changed; review added or removed command execution sites."]),
    "Changed command-site inventory files to review:",
    ...lines,
    ...(omitted > 0 ? [`- ... ${omitted} more changed inventory file(s) omitted`] : []),
    "",
    "Do not update the digest against unrelated dirty-tree changes. Review the listed command-source files, confirm their roles are still correct, then update docs/handbook/nix-command-site-policy.json.",
  ].join("\n");
}
