#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { DEV_OVERRIDE_LANGS, devOverrideEnvNameForLang } from "../../lib/dev-override-envs";

test("dev override env manifest contains artifact languages and resolves expected env names", () => {
  const got = Object.fromEntries(DEV_OVERRIDE_LANGS.map((l) => [l, devOverrideEnvNameForLang(l)]));
  const expected = {
    go: "NIX_GO_DEV_OVERRIDE_JSON",
    cpp: "NIX_CPP_DEV_OVERRIDE_JSON",
    python: "NIX_PY_DEV_OVERRIDE_JSON",
    rust: "NIX_RUST_DEV_OVERRIDE_JSON",
  };
  for (const [k, v] of Object.entries(expected)) {
    if (got[k] !== v) {
      console.error(`expected ${k} -> ${v}, got ${k} -> ${String(got[k])}`);
      process.exit(2);
    }
  }
});
