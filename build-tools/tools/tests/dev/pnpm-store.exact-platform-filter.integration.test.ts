#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { externalNodeToolEnv } from "../../lib/external-node-env";
import {
  execFileAsync,
  pnpmArgs,
  PRESSURE_TIMEOUT_MS,
  productionConfig,
  SHORT_COMMAND_TIMEOUT_MS,
  timed,
} from "./pnpm-store.exact-platform-filter.integration.helpers";

test(
  "pnpm store fetch retains supported Nix os/cpu tuples with the deterministic Linux libc union",
  { timeout: PRESSURE_TIMEOUT_MS },
  async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-pnpm-platform-filter-"));
    const { pnpm, universalMarkers } = await productionConfig();
    const env = { ...externalNodeToolEnv(), CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" };
    try {
      await fsp.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "pnpm-platform-filter-proof",
          private: true,
          dependencies: { esbuild: "0.25.9", sharp: "0.33.5" },
        }) + "\n",
      );
      await timed(
        "lockfile install",
        async () =>
          await execFileAsync(
            pnpm,
            [
              "install",
              "--lockfile-only",
              "--ignore-scripts",
              "--ignore-pnpmfile",
              "--ignore-workspace",
              "--dir",
              ".",
            ],
            { cwd: root, env, timeout: SHORT_COMMAND_TIMEOUT_MS },
          ),
      );

      for (const marker of universalMarkers) {
        await fsp.writeFile(
          path.join(root, "pnpm-workspace.yaml"),
          ["packages:", "  - ./", marker].join("\n"),
        );
        await timed(
          `fetch ${marker}`,
          async () =>
            await execFileAsync(pnpm, ["fetch", ...pnpmArgs], {
              cwd: root,
              env,
              timeout: SHORT_COMMAND_TIMEOUT_MS,
              maxBuffer: 4 * 1024 * 1024,
            }),
        );
      }

      const index = (await fsp.readFile(path.join(root, "store", "v11", "index.db"))).toString(
        "latin1",
      );
      for (const expected of [
        "@esbuild/darwin-arm64@0.25.9",
        "@esbuild/linux-arm64@0.25.9",
        "@esbuild/linux-x64@0.25.9",
        "@img/sharp-linux-arm64@0.33.5",
        "@img/sharp-linux-x64@0.33.5",
        "@img/sharp-linuxmusl-arm64@0.33.5",
        "@img/sharp-linuxmusl-x64@0.33.5",
      ]) {
        assert.match(index, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
      for (const foreign of [
        "@esbuild/darwin-x64@0.25.9",
        "@esbuild/linux-arm@0.25.9",
        "@esbuild/win32-x64@0.25.9",
      ]) {
        assert.doesNotMatch(index, new RegExp(foreign.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }

      const storeSource = await fsp.readFile(
        path.resolve(import.meta.dirname, "../../nix/node-modules/store.nix"),
        "utf8",
      );
      assert.doesNotMatch(storeSource, /\$PNPM_BIN" fetch \\\n\s+--force/);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  },
);
