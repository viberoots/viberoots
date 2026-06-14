#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveSelectedTargetLabel } from "../../dev/target-label-resolver";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("resolveSelectedTargetLabel supports label, relative, absolute, and dot inputs", async () => {
  await runInTemp("target-label-resolver-selected", async (tmp) => {
    const graphDir = path.dirname(path.join(tmp, DEFAULT_GRAPH_PATH));
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(
      path.join(tmp, DEFAULT_GRAPH_PATH),
      JSON.stringify(
        [
          {
            name: "//projects/apps/demo:app",
            labels: ["lang:node", "kind:app", "webapp:ssr", "framework:vite"],
          },
          {
            name: "//projects/libs/core:core",
            labels: ["lang:cpp", "kind:lib"],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const demoDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(demoDir, { recursive: true });

    const fromLabel = await resolveSelectedTargetLabel(tmp, "//projects/apps/demo:app", {
      baseDir: demoDir,
    });
    assert.equal(fromLabel, "//projects/apps/demo:app");

    const fromRelative = await resolveSelectedTargetLabel(tmp, "projects/apps/demo", {
      baseDir: tmp,
    });
    assert.equal(fromRelative, "//projects/apps/demo:app");

    const fromAbsolute = await resolveSelectedTargetLabel(tmp, demoDir, { baseDir: tmp });
    assert.equal(fromAbsolute, "//projects/apps/demo:app");

    const fromDot = await resolveSelectedTargetLabel(tmp, ".", { baseDir: demoDir });
    assert.equal(fromDot, "//projects/apps/demo:app");
  });
});

test("resolveSelectedTargetLabel fails fast on ambiguous package selectors", async () => {
  await runInTemp("target-label-resolver-ambiguous", async (tmp) => {
    const graphDir = path.dirname(path.join(tmp, DEFAULT_GRAPH_PATH));
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(
      path.join(tmp, DEFAULT_GRAPH_PATH),
      JSON.stringify(
        [
          { name: "//projects/apps/ambig:one", labels: ["lang:go", "kind:lib"] },
          { name: "//projects/apps/ambig:two", labels: ["lang:go", "kind:test"] },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const ambigDir = path.join(tmp, "projects", "apps", "ambig");
    await fsp.mkdir(ambigDir, { recursive: true });

    await assert.rejects(
      () => resolveSelectedTargetLabel(tmp, ".", { baseDir: ambigDir }),
      /is ambiguous; use an explicit label/,
    );
  });
});
