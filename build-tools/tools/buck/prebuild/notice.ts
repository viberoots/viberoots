#!/usr/bin/env zx-wrapper
import fs from "node:fs";

import { DEV_OVERRIDE_LANGS, devOverrideEnvNameForLang } from "../../lib/dev-override-envs";

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
  const clearOverridesPath = fs.existsSync("build-tools/tools/dev/clear-overrides.ts")
    ? "build-tools/tools/dev/clear-overrides.ts"
    : "viberoots/build-tools/tools/dev/clear-overrides.ts";
  console.warn(
    `[prebuild] dev overrides active (${vars}) — local derivation hashes will differ; clear with: node ${clearOverridesPath}`,
  );
}
