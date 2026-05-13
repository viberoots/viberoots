#!/usr/bin/env zx-wrapper

export function isStaleEnvironmentBranchRef(ref: string): boolean {
  return ref === "env" || ref.startsWith("env/");
}

export function staleEnvironmentRefErrors(opts: {
  label: string;
  field: string;
  refs: string[];
}): string[] {
  return opts.refs
    .filter(isStaleEnvironmentBranchRef)
    .map(
      (ref) =>
        `${opts.label}: ${opts.field} must not use environment branch ${ref}; use source-ref policy and control-plane stage state`,
    );
}

export function sourceRefMatchesAllowedRef(sourceRef: string, allowedRef: string): boolean {
  if (sourceRef === allowedRef) return true;
  if (!allowedRef.endsWith("*")) return false;
  return sourceRef.startsWith(allowedRef.slice(0, -1));
}

export function sourceRefAllowed(sourceRef: string, allowedRefs: string[]): boolean {
  return allowedRefs.some((allowedRef) => sourceRefMatchesAllowedRef(sourceRef, allowedRef));
}

export function isSourceRefPolicyPattern(ref: string): boolean {
  return ref.trim().endsWith("*");
}

export function isExplicitReviewedCommitRef(ref: string): boolean {
  return /^commit:[0-9a-f]{40}$/i.test(ref.trim());
}

export function explicitReviewedCommitSha(ref: string): string | undefined {
  const value = ref.trim();
  return isExplicitReviewedCommitRef(value) ? value.slice("commit:".length) : undefined;
}

export function sourceRefPolicyKind(
  ref: string,
): "protected_main" | "release_tag" | "explicit_reviewed_commit" | "closed_ref" {
  const value = ref.trim();
  if (value === "main" || value === "refs/heads/main") return "protected_main";
  if (value === "refs/tags/release/*" || value.startsWith("refs/tags/release/")) {
    return "release_tag";
  }
  if (isExplicitReviewedCommitRef(value)) return "explicit_reviewed_commit";
  return "closed_ref";
}
