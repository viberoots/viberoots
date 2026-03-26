#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { publishNixosSharedHostStaticWebapp } from "../../deployments/nixos-shared-host-static-publisher.ts";
import { runInTemp } from "../lib/test-helpers";

test("nixos-shared-host publisher rejects publish into a missing realized target", async () => {
  await runInTemp("nixos-shared-host-missing-target", async (tmp) => {
    const artifactDir = path.join(tmp, "artifact");
    await fsp.mkdir(artifactDir, { recursive: true });
    await fsp.writeFile(path.join(artifactDir, "index.html"), "<html>missing</html>\n", "utf8");
    await assert.rejects(
      publishNixosSharedHostStaticWebapp({
        artifactDir,
        containerRoot: path.join(tmp, "host", "containers", "pleomino"),
        layout: {
          releaseRoot: "/srv/static-app/releases",
          publishRoot: "/srv/static-app/current",
          activeReleaseLink: "/srv/static-app/live",
        },
      }),
      /missing required runtime path/,
    );
  });
});
