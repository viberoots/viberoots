#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { providersForLabels } from "../../lib/labels";
import { providerNameForImporter } from "../../lib/providers";

function fqImporterProvider(lockfile: string, importer: string): string {
  return `//third_party/providers:${providerNameForImporter(lockfile, importer)}`;
}

test("providersForLabels ignores lockfile labels with unsupported importer roots", () => {
  const labels = [
    "lockfile:apps/demo/pnpm-lock.yaml#apps/demo",
    "lockfile:libs/demo/pnpm-lock.yaml#libs/demo",
    "lockfile:pnpm-lock.yaml#.",
    "lockfile:third_party/pnpm-lock.yaml#third_party",
    "lockfile:services/api/pnpm-lock.yaml#services/api",
  ];

  const got = providersForLabels(labels);

  assert.ok(got.includes(fqImporterProvider("apps/demo/pnpm-lock.yaml", "apps/demo")));
  assert.ok(got.includes(fqImporterProvider("libs/demo/pnpm-lock.yaml", "libs/demo")));
  assert.ok(got.includes(fqImporterProvider("pnpm-lock.yaml", ".")));

  assert.ok(!got.includes(fqImporterProvider("third_party/pnpm-lock.yaml", "third_party")));
  assert.ok(!got.includes(fqImporterProvider("services/api/pnpm-lock.yaml", "services/api")));
});
