#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInScratchTemp } from "../lib/test-helpers";
import { copyViberootsSourcePath, viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("langs.json valid passes validator", async () => {
  const sourceManifest = viberootsSourcePath("build-tools/tools/nix/langs.json");
  const sourceManifestBefore = await fs.readFile(sourceManifest, "utf8");
  try {
    await runInScratchTemp("langs-validate-valid", async (tmp, $) => {
      const fixtureManifest = path.join(tmp, "viberoots/build-tools/tools/nix/langs.json");
      await fs.ensureDir(path.dirname(fixtureManifest));
      const [realTmp, realFixtureDir, realSourceManifest] = await Promise.all([
        fs.realpath(tmp),
        fs.realpath(path.dirname(fixtureManifest)),
        fs.realpath(sourceManifest),
      ]);
      assert.ok(
        realFixtureDir.startsWith(`${realTmp}${path.sep}`),
        `fixture destination escaped scratch root: ${realFixtureDir}`,
      );
      assert.notEqual(
        path.join(realFixtureDir, path.basename(fixtureManifest)),
        realSourceManifest,
        "fixture destination must not resolve to source langs.json",
      );
      const manifest = {
        enabled: ["go"],
        languages: [
          {
            id: "go",
            displayName: "Go",
            requiredPaths: [
              "viberoots/build-tools/tools/nix/templates/go.nix",
              "viberoots/build-tools/go/defs.bzl",
            ],
            kinds: ["cli", "lib"],
            templatesDir: "viberoots/build-tools/tools/scaffolding/templates/go",
            hermetic: {
              status: "graduated",
              sourceRoles: true,
              dependencyReconciliation: true,
              immutableBundleInputs: true,
              storeQualifiedToolchain: true,
              selectorTransport: true,
              sandboxNetwork: true,
              remoteExecution: true,
              publicationAdmission: true,
              reproducibilityMatrixIds: ["go-lib"],
            },
          },
        ],
      } as any;
      await fs.outputFile(fixtureManifest, JSON.stringify(manifest, null, 2) + "\n");
      await copyViberootsSourcePath(
        "viberoots/build-tools/tools/dev/langs.schema.json",
        path.join(tmp, "viberoots/build-tools/tools/dev/langs.schema.json"),
      );
      await copyViberootsSourcePath(
        "viberoots/build-tools/tools/dev/validate-langs.ts",
        path.join(tmp, "viberoots/build-tools/tools/dev/validate-langs.ts"),
      );
      await copyViberootsSourcePath(
        "viberoots/build-tools/tools/lib/artifact-reproducibility-matrix.ts",
        path.join(tmp, "viberoots/build-tools/tools/lib/artifact-reproducibility-matrix.ts"),
      );
      const testNodeModules = String(process.env.ZX_TEST_NODE_MODULES_OUT || "").trim();
      const tempToolEnv = {
        ...process.env,
        NODE_PATH: [
          path.join(process.cwd(), "node_modules"),
          testNodeModules
            ? testNodeModules.endsWith("node_modules")
              ? testNodeModules
              : path.join(testNodeModules, "node_modules")
            : "",
          process.env.NODE_PATH || "",
        ]
          .filter(Boolean)
          .join(path.delimiter),
      };
      const res = await $({
        cwd: tmp,
        env: tempToolEnv,
      })`node viberoots/build-tools/tools/dev/validate-langs.ts`;
      assert.match(String(res.stdout), /langs\.json: OK/);
    });
  } finally {
    assert.equal(
      await fs.readFile(sourceManifest, "utf8"),
      sourceManifestBefore,
      "fixture must not mutate the source langs.json",
    );
  }
});
