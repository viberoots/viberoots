#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { providersForLabels } from "../../lib/labels";
import { providerNameForImporter } from "../../lib/providers";

function fqImporterProvider(lockfile: string, importer: string): string {
  return `workspace_providers//:${providerNameForImporter(lockfile, importer)}`;
}

test("providersForLabels ignores lockfile labels with unsupported importer roots", () => {
  const labels = [
    "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",
    "lockfile:projects/libs/demo/pnpm-lock.yaml#projects/libs/demo",
    "lockfile:pnpm-lock.yaml#.",
    "lockfile:third_party/pnpm-lock.yaml#third_party",
    "lockfile:services/api/pnpm-lock.yaml#services/api",
  ];

  const got = providersForLabels(labels);

  assert.ok(
    got.includes(fqImporterProvider("projects/apps/demo/pnpm-lock.yaml", "projects/apps/demo")),
  );
  assert.ok(
    got.includes(fqImporterProvider("projects/libs/demo/pnpm-lock.yaml", "projects/libs/demo")),
  );
  assert.ok(got.includes(fqImporterProvider("pnpm-lock.yaml", ".")));

  assert.ok(!got.includes(fqImporterProvider("third_party/pnpm-lock.yaml", "third_party")));
  assert.ok(!got.includes(fqImporterProvider("services/api/pnpm-lock.yaml", "services/api")));
});
