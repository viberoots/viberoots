#!/usr/bin/env zx-wrapper
import { DEV_OVERRIDE_LANGS, devOverrideEnvNameForLang } from "../../lib/dev-override-envs.ts";

export type Mode = "ci" | "local";

export function maybePrintLocalOverridesNotice(mode: Mode): void {
  if (mode !== "local") return;
  const vars = DEV_OVERRIDE_LANGS.map((lang) => {
    const envName = devOverrideEnvNameForLang(lang);
    const v = (process.env[envName] || "").trim();
    return v ? envName : "";
  })
    .filter(Boolean)
    .join(", ");
  if (!vars) return;
  console.warn(
    `[prebuild] dev overrides active (${vars}) — local derivation hashes will differ; clear with: node tools/dev/clear-overrides.ts`,
  );
}
