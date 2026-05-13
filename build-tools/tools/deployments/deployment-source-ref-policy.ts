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
