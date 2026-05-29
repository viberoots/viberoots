#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBuckRunSummary,
  collectBuckLogCommands,
  fingerprintConfig,
  redactBuckSummary,
  type BuckLogCommandName,
} from "../../remote-exec/buck-run-summary";

const outputs: Partial<Record<BuckLogCommandName, string>> = {
  "what-ran": [
    JSON.stringify({ target: "//pkg:t", reproducer: { executor: "Re" } }),
    JSON.stringify({ target: "//pkg:u", reproducer: { executor: "Cache" } }),
  ].join("\n"),
  summary: "build token=secret completed\n",
  "critical-path": "slow token=secret\nfast authorization=Bearer nope\n",
  "what-uploaded": "cas://a\ncas://b\n",
  "what-materialized": "/nix/store/a\n",
};

test("run summary records supported and unsupported Buck log subcommands", () => {
  const results = collectBuckLogCommands({
    eventLog: "buck-event-log.pb.zst",
    runCommand: (command) => ({
      command,
      supported: command in outputs,
      output: outputs[command] || "",
      error: command in outputs ? undefined : "unknown log subcommand",
    }),
  });
  const summary = buildBuckRunSummary({
    results,
    selectedProfile: "linux-x86_64-default",
    configText: "endpoint=grpc://example.invalid authorization=hidden\n",
    target: "//pkg:t",
    passName: "shared",
    env: {
      VBR_REMOTE_CACHE_ENDPOINT_IDENTITY: "cache.example.invalid",
      VBR_REMOTE_CACHE_PUBLIC_KEY_FINGERPRINT: "sha256:abc",
      VBR_REMOTE_CACHE_MANIFEST_DIGEST: "sha256:def",
      VBR_SOURCE_REVISION: "abc123",
      VBR_FLAKE_LOCK_FINGERPRINT: "sha256:lock",
      VBR_NIX_MATERIALIZATION_REPORT: "buck-out/tmp/materialization.json",
    },
  });

  assert.equal(summary.selectedProfile, "linux-x86_64-default");
  assert.deepEqual(summary.actionCounts, {
    remote: 1,
    cache: 1,
    "dep-file-cache": 0,
    local: 0,
    worker: 0,
    unknown: 0,
  });
  assert.equal(summary.uploads, 2);
  assert.equal(summary.materializations, 1);
  assert.ok(summary.unsupportedCommands.includes("slowest-path"));
  assert.equal(summary.provenance.VBR_REMOTE_CACHE_MANIFEST_DIGEST, "sha256:def");
  assert.equal(summary.normalizedSummary, "build token=<redacted> completed\n");
  assert.doesNotMatch(summary.slowestActions.join("\n"), /secret|Bearer nope/);
});

test("run summary redacts selected sensitive summary fragments", () => {
  const redacted = redactBuckSummary("token=abc password=swordfish api_key=xyz");

  assert.equal(redacted, "token=<redacted> password=<redacted> api_key=<redacted>");
  assert.match(fingerprintConfig(redacted), /^sha256:[0-9a-f]{16}$/);
});

test("run summary falls back to slowest-path when critical-path is unsupported", () => {
  const summary = buildBuckRunSummary({
    results: [
      { command: "what-ran", supported: true, output: "" },
      { command: "summary", supported: true, output: "" },
      { command: "critical-path", supported: false, output: "", error: "unsupported" },
      { command: "slowest-path", supported: true, output: "slow password=hidden\n" },
      { command: "what-uploaded", supported: true, output: "" },
      { command: "what-materialized", supported: true, output: "" },
    ],
  });

  assert.deepEqual(summary.slowestActions, ["slow password=<redacted>"]);
  assert.deepEqual(summary.unsupportedCommands, ["critical-path"]);
});
