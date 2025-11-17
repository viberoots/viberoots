#!/usr/bin/env zx-wrapper
export type Mode = "ci" | "local";

export function maybePrintLocalOverridesNotice(mode: Mode): void {
  if (mode !== "local") return;
  const goOv = (process.env.NIX_GO_DEV_OVERRIDE_JSON || "").trim();
  const cppOv = (process.env.NIX_CPP_DEV_OVERRIDE_JSON || "").trim();
  if (!goOv && !cppOv) return;
  const vars = [goOv ? "NIX_GO_DEV_OVERRIDE_JSON" : "", cppOv ? "NIX_CPP_DEV_OVERRIDE_JSON" : ""]
    .filter(Boolean)
    .join(", ");
  console.warn(
    `[prebuild] dev overrides active (${vars}) — local derivation hashes will differ; clear with: node tools/dev/clear-overrides.ts`,
  );
}
