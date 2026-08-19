#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { recordTauriMobileDoubleGenerationEvidence } from "../../rust/tauri-mobile-generation-evidence";

const cliDigest = `sha256:${"a".repeat(64)}`;

test("Tauri mobile double-generation evidence records Android and iOS determinism", () => {
  for (const platform of ["android", "ios"] as const) {
    const evidence = recordTauriMobileDoubleGenerationEvidence({
      platform,
      tauriCliDigest: cliDigest,
      sdkToolIdentities:
        platform === "android"
          ? { androidSdk: "35", buildTools: "35.0.0", gradle: "reviewed-gradle" }
          : { xcode: "reviewed-xcode", iosSdk: "17.0", cargo: "reviewed-cargo" },
      sourceFixtureFiles: [{ path: "src/main.rs", content: "fn main() {}\r\n" }],
      firstGeneratedFiles: [{ path: "./gen/mobile/app.txt", content: `${platform}\r\n` }],
      secondGeneratedFiles: [{ path: "gen/mobile/app.txt", content: `${platform}\n` }],
      decision: "action-local",
    });
    assert.equal(evidence.schemaVersion, "viberoots.tauri-mobile.double-generation@1");
    assert.equal(evidence.platform, platform);
    assert.equal(evidence.pinnedCliDigest, cliDigest);
    assert.match(evidence.sourceFixtureDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(evidence.normalizedDiffDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(evidence.actionLocalDecision, "action-local");
    assert.ok(Object.keys(evidence.sdkToolIdentities).length >= 3);
  }
});

test("Tauri mobile double-generation evidence rejects nondeterministic output", () => {
  assert.throws(
    () =>
      recordTauriMobileDoubleGenerationEvidence({
        platform: "android",
        tauriCliDigest: cliDigest,
        sdkToolIdentities: { androidSdk: "35" },
        sourceFixtureFiles: [{ path: "src/main.rs", content: "" }],
        firstGeneratedFiles: [{ path: "gen/mobile/app.txt", content: "one\n" }],
        secondGeneratedFiles: [{ path: "gen/mobile/app.txt", content: "two\n" }],
        decision: "tracked-source",
      }),
    /non-empty normalized diff/,
  );
});
