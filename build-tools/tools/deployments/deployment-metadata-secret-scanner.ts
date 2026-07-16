export const DEPLOYMENT_METADATA_FILE_PATTERN = /\.(bzl|json|md|nix|tf)$/;

const FORBIDDEN_SECRET_PATTERNS = [
  /\bINFISICAL_ACCESS_TOKEN\s*=/,
  /\bINFISICAL_TOKEN\s*=/,
  /\bINFISICAL_PERSONAL_TOKEN\s*=/,
  /\binfisical_access_token\b/i,
  /\binfisical_personal_token\b/i,
  /\bclient_secret\s*[:=]\s*["'][^"']+["']/i,
  /\bsecret_value\s*[:=]\s*["'][^"']+["']/i,
];

export function scanDeploymentMetadataSecrets(relPath: string, text: string): string[] {
  return FORBIDDEN_SECRET_PATTERNS.filter((pattern) => pattern.test(text)).map(
    (pattern) => `${relPath} matches ${pattern}`,
  );
}
