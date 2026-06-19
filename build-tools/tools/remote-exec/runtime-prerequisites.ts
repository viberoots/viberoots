import fs from "node:fs/promises";
import { candidatePolicyFiles, readOptional } from "./default-local-policy-files";
import type { PolicyFinding } from "./default-local-policy-model";

const allowedPrimitiveNames = new Set([
  "kernel-sandbox-support",
  "disk-capacity",
  "network-reachability",
  "mounted-credentials-or-workload-identity",
  "trust-anchors",
  "clock",
  "minimal-nix-bootstrap",
]);

const forbiddenAmbientExecutables = [
  "ssh",
  "aws",
  "gcloud",
  "az",
  "cachix",
  "attic",
  "rclone",
  "sentry-cli",
  "datadog-ci",
  "buildkite-agent",
  "gh",
];

const declaredExecutablePackagesPattern = /declaredRemoteExecutablePackages\s*=\s*\{([\s\S]*?)\};/;
const declaredExecutablePathsToken = "declaredRemoteExecutablePaths";

export async function checkAllowedPrimitiveInventory(root: string): Promise<PolicyFinding[]> {
  const rel = await remoteWorkerToolsPath(root);
  const text = await readOptional(root, rel);
  const allowedBlock = /allowedPrimitives\s*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] || "";
  const findings: PolicyFinding[] = [];
  for (const name of allowedPrimitiveNames) {
    if (!allowedBlock.includes(`"${name}"`)) {
      findings.push(error(rel, `allowed primitive inventory omits ${name}`));
    }
  }
  for (const exe of forbiddenAmbientExecutables) {
    if (allowedBlock.includes(`"${exe}"`) || allowedBlock.includes(`pkgs.${exe}`)) {
      findings.push(
        error(rel, `executable ${exe} must be declared in a Nix closure, not a primitive`),
      );
    }
  }
  return findings;
}

export async function checkRemoteReadyAmbientExecutables(root: string): Promise<PolicyFinding[]> {
  const findings: PolicyFinding[] = [];
  const declaredExecutables = await declaredRemoteExecutables(root);
  for (const rel of (await candidatePolicyFiles(root)).filter(isRemoteReadyScriptSurface)) {
    const text = await readOptional(root, rel);
    if (!isRemoteReadySurface(text)) continue;
    for (const exe of forbiddenAmbientExecutables) {
      const re = new RegExp(`(?:command\\s+-v|\\$\\{|\\$\\(|\\b)${escapeRe(exe)}\\b`);
      if (re.test(text) && !declaredExecutables.has(exe)) {
        findings.push(
          error(rel, `remote-ready helper invokes undeclared ambient executable: ${exe}`),
        );
      }
    }
  }
  return findings;
}

async function declaredRemoteExecutables(root: string): Promise<Set<string>> {
  const rel = await remoteWorkerToolsPath(root);
  const text = await readOptional(root, rel);
  const declaredBlock = declaredExecutablePackagesPattern.exec(text)?.[1] || "";
  const closureComposesDeclaredPackages =
    (/\bworkerPaths\s*=([\s\S]*?);/.test(text) &&
      new RegExp(`\\bworkerPaths\\b[\\s\\S]*\\+\\+\\s*${declaredExecutablePathsToken}`).test(
        text,
      )) ||
    (/\bciPaths\s*=([\s\S]*?);/.test(text) &&
      new RegExp(`\\bciPaths\\b[\\s\\S]*\\+\\+\\s*${declaredExecutablePathsToken}`).test(text));
  const declared = new Set<string>();
  if (!closureComposesDeclaredPackages) return declared;
  for (const exe of forbiddenAmbientExecutables) {
    if (new RegExp(`\\b${escapeRe(exe)}\\s*=`).test(declaredBlock)) {
      declared.add(exe);
    }
  }
  return declared;
}

function error(path: string, message: string): PolicyFinding {
  return { severity: "error", path, message };
}

function isRemoteReadyScriptSurface(rel: string): boolean {
  if (rel.endsWith("runtime-prerequisites.ts")) return false;
  if (rel.endsWith("default-local-policy-rules.ts")) return false;
  if (rel.endsWith("default-local-policy-model.ts")) return false;
  return isToolPath(rel, "remote-exec") || isToolPath(rel, "ci");
}

async function remoteWorkerToolsPath(root: string): Promise<string> {
  const candidates = [
    "viberoots/build-tools/tools/nix/flake/packages/remote-worker-tools.nix",
    "build-tools/tools/nix/flake/packages/remote-worker-tools.nix",
  ];
  for (const rel of candidates) {
    if ((await readOptional(root, rel)) !== "") return rel;
  }
  return candidates[0];
}

function isToolPath(rel: string, dir: string): boolean {
  return (
    rel.startsWith(`viberoots/build-tools/tools/${dir}/`) ||
    rel.startsWith(`build-tools/tools/${dir}/`)
  );
}

function isRemoteReadySurface(text: string): boolean {
  return /remote:ready|remote-ready|VBR_REMOTE_EXEC_MODE|remote-worker/.test(text);
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function loadPrimitiveInventory(path: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path, "utf8"));
}
