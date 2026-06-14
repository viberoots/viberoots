#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerNameForImporter } from "../../lib/providers";
import {
  DEFAULT_PROVIDER_INDEX_JSON_PATH,
  DEFAULT_PROVIDER_INDEX_PATH,
  workspaceProviderLabel,
} from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("gen-provider-index: includes python entries (BZL and JSON)", async () => {
  await runInTemp("gen-provider-index-python", async (tmp, $) => {
    const importerDir = path.join(tmp, "projects", "apps", "pytool");
    const lockfile = path.join(importerDir, "uv.lock");
    await fsp.mkdir(importerDir, { recursive: true });
    await fsp.writeFile(lockfile, "", "utf8"); // content not required for index

    await $`node build-tools/tools/buck/gen-provider-index.ts --out .viberoots/workspace/providers/provider_index.bzl`;

    const relLf = "projects/apps/pytool/uv.lock";
    const importer = "projects/apps/pytool";
    const provider = providerNameForImporter(relLf, importer);
    const fq = workspaceProviderLabel(provider);
    const key = `lockfile:${relLf}#${importer}`;

    const bzlPath = path.join(tmp, DEFAULT_PROVIDER_INDEX_PATH);
    const jsonPath = path.join(tmp, DEFAULT_PROVIDER_INDEX_JSON_PATH);
    const bzl = await fsp.readFile(bzlPath, "utf8");
    const js = JSON.parse(await fsp.readFile(jsonPath, "utf8"));

    if (!bzl.includes(fq)) {
      console.error("expected python provider label missing in BZL:", fq);
      process.exit(2);
    }
    const entry = js[fq];
    if (!entry) {
      console.error("expected python provider entry missing in JSON:", fq);
      process.exit(2);
    }
    if (entry.kind !== "python" || entry.key !== key) {
      console.error("python entry mismatch", entry, { expected: { kind: "python", key } });
      process.exit(2);
    }
  });
});
