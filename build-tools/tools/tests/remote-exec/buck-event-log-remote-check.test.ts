#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseWhatRanText,
  validateRemoteConformance,
} from "../../remote-exec/buck-event-log-remote-check";

const readyTarget =
  "@viberoots//build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_ready_handles";

test("Buck what-ran parser classifies pinned executor variants", () => {
  const actions = parseWhatRanText(
    [
      JSON.stringify({ target: "//pkg:remote", reproducer: { executor: "Re" } }),
      JSON.stringify({ target: "//pkg:cache", reproducer: { executor: "Cache" } }),
      JSON.stringify({ target: "//pkg:dep", reproducer: { executor: "ReDepFileCache" } }),
      JSON.stringify({ target: "//pkg:local", reproducer: { executor: "Local" } }),
      JSON.stringify({ target: "//pkg:worker", reproducer: { executor: "WorkerInit" } }),
      JSON.stringify({ target: "//pkg:unknown", reproducer: { executor: "CacheQuery" } }),
    ].join("\n"),
  );

  assert.deepEqual(
    actions.map((action) => action.classification),
    ["remote", "cache", "dep-file-cache", "local", "worker", "unknown"],
  );
});

test("remote conformance fails when remote-ready actions run locally", () => {
  const findings = validateRemoteConformance({
    actions: parseWhatRanText(
      JSON.stringify([
        { target: readyTarget, reproducer: { executor: "Local" } },
        { target: "//pkg:local-only", reproducer: { executor: "Local" } },
      ]),
    ),
    remoteReadyTargets: [readyTarget],
  });

  assert.deepEqual(findings, [
    { target: readyTarget, message: "remote-ready action ran as local" },
  ]);
});

test("remote conformance accepts remote and cache evidence", () => {
  const actions = parseWhatRanText(
    JSON.stringify([
      { target: readyTarget, reproducer: { executor: "Re" } },
      { target: readyTarget, reproducer: { executor: "Cache" } },
    ]),
  );

  assert.deepEqual(validateRemoteConformance({ actions, remoteReadyTargets: [readyTarget] }), []);
});

test("remote conformance gates dep-file cache explicitly", () => {
  const actions = parseWhatRanText(
    JSON.stringify([{ target: readyTarget, reproducer: { executor: "ReDepFileCache" } }]),
  );

  assert.deepEqual(
    validateRemoteConformance({
      actions,
      remoteReadyTargets: [readyTarget],
      allowDepFileCache: true,
    }),
    [],
  );
});
