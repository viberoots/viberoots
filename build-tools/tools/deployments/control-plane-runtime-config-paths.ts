import path from "node:path";
import { pathToFileURL } from "node:url";

export type CredentialPathPolicy = {
  credentialDirectory: string;
  repoRoot?: string;
};

export type CredentialDirectoryPolicy = {
  repoRoot?: string;
};

const IMAGE_LAYER_PREFIXES = ["/app", "/opt/deployment-control-plane", "/usr/local/bin"];
const ARGUMENT_STYLE_PATTERN = /^-{1,2}[a-z0-9][a-z0-9-]*(=|$)/i;

export function normalizeAbsolutePath(filePath: string, fieldName: string): string {
  if (!filePath || !path.isAbsolute(filePath)) {
    throw new Error(`${fieldName} must be an absolute file path`);
  }
  return path.resolve(filePath);
}

export function validateBasePath(value: string, fieldName: string): string {
  if (
    !value.startsWith("/") ||
    value.includes("//") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new Error(`${fieldName} must be an absolute URL base path`);
  }
  return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
}

export function assertCredentialDirectory(
  directory: string,
  policy: CredentialDirectoryPolicy = {},
): string {
  const resolved = normalizeAbsolutePath(directory, "credentials.directory");
  if (isDeniedCredentialDirectory(resolved, policy.repoRoot)) {
    throw new Error(`credential directory is not allowed: ${resolved}`);
  }
  return resolved;
}

export function assertReviewedCredentialPath(
  filePath: string,
  policy: CredentialPathPolicy,
): string {
  const resolved = normalizeAbsolutePath(filePath, "credential path");
  const normalizedDirectory = path.resolve(policy.credentialDirectory);
  if (isDeniedCredentialPath(resolved, policy.repoRoot, normalizedDirectory)) {
    throw new Error(`credential path is not allowed: ${resolved}`);
  }
  return resolved;
}

export function assertCredentialDirectoryPath(
  filePath: string,
  policy: CredentialPathPolicy,
): string {
  const resolved = assertReviewedCredentialPath(filePath, policy);
  const directory = path.resolve(policy.credentialDirectory);
  if (!isSubpath(resolved, directory)) {
    throw new Error(`credential path must be under credential directory: ${resolved}`);
  }
  return resolved;
}

export function resolveCredentialFileName(directory: string, fileName: string): string {
  if (
    !fileName ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName === "." ||
    fileName === ".."
  ) {
    throw new Error(`credential filename override must be a plain filename`);
  }
  return path.join(directory, fileName);
}

function isDeniedCredentialPath(
  filePath: string,
  repoRoot: string | undefined,
  directory: string,
): boolean {
  if (ARGUMENT_STYLE_PATTERN.test(filePath)) return true;
  if (filePath.includes(path.sep + ".env") || path.basename(filePath).startsWith(".env"))
    return true;
  if (isSubpath(filePath, "/nix/store")) return true;
  if (repoRoot && isSubpath(filePath, path.resolve(repoRoot))) return true;
  if (
    !isSubpath(filePath, directory) &&
    IMAGE_LAYER_PREFIXES.some((prefix) => isSubpath(filePath, prefix))
  ) {
    return true;
  }
  return pathToFileURL(filePath).href.includes("%00");
}

function isDeniedCredentialDirectory(directory: string, repoRoot: string | undefined): boolean {
  if (directory.includes(path.sep + ".env") || path.basename(directory).startsWith(".env"))
    return true;
  if (isSubpath(directory, "/nix/store")) return true;
  if (repoRoot && isSubpath(directory, path.resolve(repoRoot))) return true;
  return IMAGE_LAYER_PREFIXES.some((prefix) => isSubpath(directory, prefix));
}

function isSubpath(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
