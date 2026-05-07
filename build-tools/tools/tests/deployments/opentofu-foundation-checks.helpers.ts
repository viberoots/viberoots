#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import {
  runFoundationMigrationApply,
  FOUNDATION_POST_APPLY_CHECKS,
} from "../../deployments/foundation-migration";
import type { FoundationPostApplyCheck } from "../../deployments/foundation-migration";
import { runInTemp } from "../lib/test-helpers";
import {
  migrationAdapterWithChecks,
  writeMigrationBundleFixture,
} from "./opentofu-foundation-migration.helpers";

export function passedChecks(): FoundationPostApplyCheck[] {
  return FOUNDATION_POST_APPLY_CHECKS.map((name) => ({ name, status: "passed" }));
}

export async function assertPostApplyFailure(check: FoundationPostApplyCheck) {
  await runInTemp(`opentofu-foundation-${check.name}`, async (tmp) => {
    const bundle = await writeMigrationBundleFixture(tmp);
    const outcome = await runFoundationMigrationApply({
      bundlePath: bundle,
      targetSupabaseIdentity: "supabase://phase0/dev",
      sourceRevision: "rev-schema",
      secretRuntime: {
        async enterStep() {
          return { "supabase-service-role": "secret-supabase" };
        },
      },
      adapter: migrationAdapterWithChecks([
        ...passedChecks().filter((entry) => entry.name !== check.name),
        check,
      ]),
    });
    assert.equal(outcome.status, "failed");
    assert.match(outcome.diagnostics?.summary || "", /tenant|fk|ordering|extension|context/i);
  });
}
