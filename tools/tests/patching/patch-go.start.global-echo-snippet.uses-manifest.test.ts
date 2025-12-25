#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go global echo snippet uses override env name from the manifest", async () => {
  await runInTemp("patch-go-start-global-echo-uses-manifest", async (tmp, $) => {
    const manifestPath = path.join(tmp, "tools", "lib", "dev-override-envs.json");
    const manifest = JSON.stringify(
      {
        go: "NIX_GO_DEV_OVERRIDE_JSON_FROM_MANIFEST",
        cpp: "NIX_CPP_DEV_OVERRIDE_JSON",
        python: "NIX_PY_DEV_OVERRIDE_JSON",
      },
      null,
      2,
    );
    await fsp.writeFile(manifestPath, manifest, "utf8");

    const origin = path.join(tmp, "gomodcache", "golang.org/x/net@v0.24.0");
    await fsp.mkdir(origin, { recursive: true });
    await fsp.writeFile(path.join(origin, "README.md"), "hello\n", "utf8");
    const importPath = "golang.org/x/net";
    const version = "v0.24.0";
    const map = { [importPath]: { version, originPath: origin } };

    await $`chmod +x tools/bin/patch-pkg`;
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`PATCH_ECHO_SNIPPET=1 NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON_FROM_MANIFEST={} tools/bin/patch-pkg start go ${importPath}`;

    const err = String(res.stderr || "");
    if (!err.includes("export NIX_GO_DEV_OVERRIDE_JSON_FROM_MANIFEST=")) {
      console.error("expected manifest-derived override env name in stderr export snippet\n", err);
      process.exit(2);
    }
  });
});
