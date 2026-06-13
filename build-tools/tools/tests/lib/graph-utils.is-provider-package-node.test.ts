#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { isProviderPackageNode } from "../../lib/graph-utils";

test("graph-utils: isProviderPackageNode classifies provider-package nodes correctly", async () => {
  const yesCases = [
    "//third_party/providers:lf_abcdef_apps_web__pnpm_lock_yaml",
    "root//third_party/providers:mod_deadbeef_tail (config//platforms:default#1234abcd)",
    "workspace_providers//:lf_abcdef_apps_web__pnpm_lock_yaml",
  ];
  const noCases = [
    "//projects/apps/web:bundle",
    "prelude//build-tools/cpp:lib",
    "",
    "projects/apps/web:lib",
  ];

  for (const s of yesCases) {
    if (!isProviderPackageNode(s)) {
      console.error("expected provider-package classification (true) for:", s);
      process.exit(2);
    }
  }
  for (const s of noCases) {
    if (isProviderPackageNode(s)) {
      console.error("expected non-provider-package classification (false) for:", s);
      process.exit(2);
    }
  }
});
