import type { ManagedDependencyValidationExpectations } from "./control-plane-managed-dependency-types";

export function roleNameFromArn(value: string): string {
  return value.split("/").pop() || value;
}

export function isPublicSupabaseHost(host: string): boolean {
  return /\.supabase\.co$/i.test(host) || /\.pooler\.supabase\.com$/i.test(host);
}

export function compareExpected(
  errors: string[],
  actual: unknown,
  expected: string | undefined,
  label: string,
): void {
  if (!expected) return;
  const actualText = text(actual);
  if (!actualText) {
    errors.push(`${label} proof is missing`);
    return;
  }
  if (actualText !== expected) errors.push(`${label} does not match expected value`);
}

export function compareExpectedPrivateLinkIdentity(
  errors: string[],
  actual: any,
  opts: ManagedDependencyValidationExpectations,
  label: string,
): void {
  if (opts.expectedPrivateLinkEndpointId) {
    compareExpected(
      errors,
      actual.privatelinkEndpointId,
      opts.expectedPrivateLinkEndpointId,
      `${label} endpoint id`,
    );
    return;
  }
  compareExpected(
    errors,
    actual.privatelinkResourceId,
    opts.expectedPrivateLinkResourceId,
    `${label} resource identity`,
  );
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
