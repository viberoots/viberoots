#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";
import { providerNameForModuleKey, providerNameForImporter } from "../../lib/providers";

test("gen-auto-map: mixed module+lockfile labels map to both providers", async () => {
  await runInTemp("auto-map-mixed", async (tmp, $) => {
    const node = {
      name: "//svc:api",
      labels: [
        "module:github.com/sirupsen/logrus@v1.9.0",
        "lockfile:apps/web/pnpm-lock.yaml#apps/web",
      ],
    };
    await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "tools", "buck", "graph.json"),
      JSON.stringify([node]),
      "utf8",
    );
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    const out = await fsp.readFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "utf8",
    );
    const mod = `//third_party/providers:${providerNameForModuleKey("github.com/sirupsen/logrus", "v1.9.0")}`;
    const lf = `//third_party/providers:${providerNameForImporter("apps/web/pnpm-lock.yaml", "apps/web")}`;
    if (!out.includes(mod) || !out.includes(lf)) {
      console.error("missing expected providers in mixed mapping");
      process.exit(2);
    }
  });
});
