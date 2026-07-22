#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import fs from "fs-extra";
import { runInTemp } from "../lib/test-helpers";
import { viberootsTool } from "./lib/viberoots-tools";

test("scaf language doctor reports scaffold graduation gaps", async () => {
  await runInTemp("scaf-language-doctor-hermetic", async (tmp, $) => {
    const source = path.join(tmp, "viberoots");
    await fs.outputJson(path.join(source, "build-tools/tools/nix/langs.json"), {
      enabled: [],
      languages: [
        {
          id: "toy",
          displayName: "Toy",
          requiredPaths: [],
          kinds: ["lib"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/toy",
          hermetic: {
            status: "scaffold",
            sourceRoles: false,
            dependencyReconciliation: false,
            immutableBundleInputs: false,
            storeQualifiedToolchain: false,
            selectorTransport: false,
            sandboxNetwork: false,
            remoteExecution: false,
            publicationAdmission: false,
            reproducibilityMatrixIds: [],
          },
        },
      ],
    });
    const result = await $({
      cwd: tmp,
      env: {
        ...process.env,
        WORKSPACE_ROOT: tmp,
        VIBEROOTS_ROOT: source,
        VIBEROOTS_SOURCE_ROOT: source,
      },
    })`node ${viberootsTool("viberoots/build-tools/tools/scaffolding/scaf.ts")} language doctor --json`;
    const payload = JSON.parse(String(result.stdout));
    assert.equal(payload.ok, false);
    assert.match(payload.languages[0].graduationGaps.join(" "), /status is scaffold/);
    assert.match(payload.languages[0].graduationGaps.join(" "), /immutableBundleInputs/);
    assert.match(payload.languages[0].graduationGaps.join(" "), /reproducibilityMatrixIds/);
  });
});
