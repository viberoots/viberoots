import path from "node:path";

export const remoteEnvVars = [
  "VBR_REMOTE_EXEC_MODE",
  "VBR_REMOTE_BUCK_CONFIG",
  "VBR_REMOTE_EXEC_SYSTEM",
  "VBR_REMOTE_ARTIFACT_DIR",
] as const;

export type FindingSeverity = "error" | "warning";

export type PolicyFinding = {
  severity: FindingSeverity;
  path: string;
  message: string;
};

export type PolicyReport = {
  ok: boolean;
  findings: PolicyFinding[];
  dormantSurfaces: string[];
};

export function repoPath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

export function classifyDormantSurface(relPath: string): string | undefined {
  if (relPath.startsWith("build-tools/tools/remote-exec/")) return "remote-exec-tooling";
  if (/remote_execution_(profiles|platforms)\.bzl$/.test(relPath)) return "remote-toolchain-model";
  if (
    /remote.*(template|example|fixture).*\.(json|toml|ya?ml|ini|cfg|buckconfig|txt)$/.test(relPath)
  ) {
    return "remote-config-template";
  }
  return undefined;
}
