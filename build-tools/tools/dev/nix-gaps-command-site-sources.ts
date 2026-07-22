import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const sourceExtensions = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".bzl",
  ".nix",
  ".sh",
  ".bash",
  ".jinja",
]);
const excludedSegments = new Set([".git", ".viberoots", "buck-out", "node_modules", "tests"]);
const reviewedProductionFiles = [
  ".buck2_env.sh",
  ".buck2_shim/bin/buck2",
  ".envrc",
  ".husky/pre-commit",
  "Jenkinsfile",
  "bootstrap",
  "flake.nix",
  "init",
  "post-clone",
  "third_party/uv2nix/flake.nix",
] as const;
const reviewedProductionFileSet = new Set<string>(reviewedProductionFiles);
const executableRootScopes = [".husky", ".buck2_shim"] as const;

function isPublicBinEntrypoint(rel: string): boolean {
  return rel.startsWith("build-tools/tools/bin/") && !path.extname(rel);
}

export function sourceRequiresInventoryFingerprint(rel: string): boolean {
  return (
    reviewedProductionFileSet.has(rel) ||
    !rel.includes("/") ||
    executableRootScopes.some((scope) => rel.startsWith(`${scope}/`)) ||
    isPublicBinEntrypoint(rel) ||
    rel === "build-tools/tools/bin/artifact-ingress-env.sh"
  );
}

const canonicalArtifactApiNames = [
  "copyArtifactPathsToEvidenceStore",
  "copyToEvidenceStore",
  "runArtifactNix",
  "runArtifactTool",
  "runDeclaredArtifactPublisher",
  "withActiveReviewedRemoteNix",
] as const;

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function importedCanonicalAliases(source: string): string[] {
  const aliases = new Set<string>();
  const canonical = new Set<string>(canonicalArtifactApiNames);
  for (const match of source.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/gu)) {
    for (const rawBinding of match[1].split(",")) {
      const binding = rawBinding.trim().replace(/^type\s+/u, "");
      const parsed = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u.exec(binding);
      if (parsed && canonical.has(parsed[1])) aliases.add(parsed[2]);
    }
  }
  return [...aliases].sort();
}

function directCallRegex(names: readonly string[]): RegExp {
  const alternatives = names.map(regexEscape).join("|");
  return new RegExp(
    `(?<!function\\s)(?<![.\\w$])(?:${alternatives})\\s*\\(` +
      `(?!\\s*[A-Za-z_$][\\w$]*\\s*:)(?![^()\\n]*\\)\\s*(?::[^{=\\n]+)?\\s*\\{)`,
    "gu",
  );
}

function qualifiedCallRegex(names: readonly string[]): RegExp {
  const alternatives = names.map(regexEscape).join("|");
  return new RegExp(
    `\\b[A-Za-z_$][\\w$]*(?:\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*)*\\s*\\??\\.\\s*(?:${alternatives})\\s*\\(`,
    "gu",
  );
}

export function patternsForCommandSite(
  rel: string,
  source = "",
): Array<{ kind: string; regex: RegExp }> {
  if (rel === "Jenkinsfile") {
    return [
      {
        kind: "jenkins-shell",
        regex: /(?<![.\w])sh\s*(?:\(\s*)?(?:script\s*:\s*)?(?=['"])/g,
      },
    ];
  }
  const ext = path.extname(rel);
  if ([".ts", ".js", ".mjs", ".cjs"].includes(ext)) {
    const aliases = importedCanonicalAliases(source).filter(
      (alias) =>
        !canonicalArtifactApiNames.includes(alias as (typeof canonicalArtifactApiNames)[number]),
    );
    return [
      {
        kind: "canonical-artifact-api",
        regex: directCallRegex(canonicalArtifactApiNames),
      },
      {
        kind: "qualified-canonical-artifact-api",
        regex: qualifiedCallRegex(canonicalArtifactApiNames),
      },
      ...(aliases.length
        ? [{ kind: "aliased-canonical-artifact-api", regex: directCallRegex(aliases) }]
        : []),
      {
        kind: "process-call",
        regex:
          /(?<![.\w])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|runCommand|runBoundedArtifactCommand)\s*\(/g,
      },
      {
        kind: "injected-nix-call",
        regex: directCallRegex(["runNix"]),
      },
      {
        kind: "qualified-injected-nix-call",
        regex: qualifiedCallRegex(["runNix"]),
      },
      { kind: "zx-command", regex: /\$\s*(?:\([\s\S]*?\))?\s*`/g },
    ];
  }
  if (ext === ".bzl") {
    return [
      { kind: "buck-action", regex: /\bctx\.actions\.(?:run|run_shell)\s*\(/g },
      { kind: "genrule", regex: /\b(?:native\.)?genrule\s*\(/g },
      { kind: "action-command", regex: /^\s*(?:cmd|run_cmd)\s*=/gm },
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
  const patterns = [
    {
      kind: "shell-nix-buck",
      regex:
        /(?:^|[;&|({])\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|]+\s+)*)?(?:(?:command|exec)\s+|timeout\s+\S+\s+)?(?:nix|nix-store|buck2)(?:\s|$)/gm,
    },
  ];
  if (rel === ".buck2_shim/bin/buck2") {
    patterns.push({
      kind: "pinned-buck-exec",
      regex: /(?:^|[;&|({])\s*exec\s+"\$orig"(?:\s|$)/gm,
    });
  }
  if (rel === "build-tools/tools/bin/gomod2nix") {
    patterns.push({
      kind: "gomod2nix-quoted-nix",
      regex: /^\s*try_run\s+"nix\s+(?:run|shell)(?:\s|$)/gm,
    });
  }
  if (rel === ".envrc") {
    patterns.push({ kind: "direnv-flake", regex: /^\s*use\s+flake(?:\s|$)/gm });
  }
  return patterns;
}

export async function productionCommandSiteSources(root: string): Promise<string[]> {
  const files = new Set<string>();
  async function visit(abs: string, rel: string): Promise<void> {
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || excludedSegments.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        await visit(childAbs, childRel);
      } else if (
        entry.isFile() &&
        (sourceExtensions.has(path.extname(entry.name)) || isPublicBinEntrypoint(childRel))
      ) {
        files.add(childRel);
      }
    }
  }
  await visit(path.join(root, "build-tools"), "build-tools");
  for (const rel of reviewedProductionFiles) {
    try {
      const stat = await fsp.lstat(path.join(root, rel));
      if (stat.isFile()) files.add(rel);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  try {
    const { stdout: topLevel } = await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" },
    );
    if (path.resolve(topLevel.trim()) !== path.resolve(root)) return [...files].sort();
    const { stdout } = await execFileAsync("git", ["-C", root, "ls-files", "--stage", "-z"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    for (const record of stdout.split("\0")) {
      const match = /^100755 [0-9a-f]+ \d+\t(.+)$/u.exec(record);
      if (!match) continue;
      const rel = match[1];
      if (!rel.includes("/") || executableRootScopes.some((scope) => rel.startsWith(`${scope}/`))) {
        files.add(rel);
      }
    }
  } catch (error) {
    if ((error as { code?: number }).code !== 128) throw error;
  }
  return [...files].sort();
}

export function activeSourceContains(source: string, token: string): boolean {
  return source.split(/\r?\n/).some((line) => !/^\s*(?:#|\/\/)/.test(line) && line.includes(token));
}
