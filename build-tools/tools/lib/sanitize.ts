// Canonical sanitizer for labels and attribute names.
//
// Contract (must match):
// - Starlark: //lang:sanitize.bzl:sanitize_name
// - Nix:      build-tools/tools/nix/lib/lang-helpers.nix:sanitizeName
//
// This transform intentionally only applies the four replacements below.
export function sanitizeName(input: string): string {
  return String(input ?? "")
    .replaceAll("//", "")
    .replaceAll(":", "-")
    .replaceAll("/", "-")
    .replaceAll(" ", "-");
}
