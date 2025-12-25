#!/usr/bin/env zx-wrapper
// tools/dev/clear-overrides.ts — Unsets Go and C++ dev overrides and prints their values.

import { DEV_OVERRIDE_LANGS, devOverrideEnvNameForLang } from "../lib/dev-override-envs.ts";

const has = (v?: string) => Boolean(v && v.trim() !== "");

for (const lang of DEV_OVERRIDE_LANGS) {
  const envName = devOverrideEnvNameForLang(lang);
  if (has(process.env[envName])) delete process.env[envName];
}
for (const lang of DEV_OVERRIDE_LANGS) {
  const envName = devOverrideEnvNameForLang(lang);
  console.log(`${envName}=`, JSON.stringify(process.env[envName] || ""));
}
