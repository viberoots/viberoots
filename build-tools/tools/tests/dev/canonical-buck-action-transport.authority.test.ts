#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { canonicalBuckActionTransport } from "../../dev/canonical-buck-action-transport";
import {
  artifactToolsRoot,
  buckTransportFixture as fixture,
  canonicalNode,
} from "./canonical-buck-action-transport.fixture";

test("declared Buck action must start under its declared canonical Node", async () => {
  const { root, manifest, stateRoot, marker, artifactMarker } = await fixture();
  try {
    assert.throws(
      () =>
        canonicalBuckActionTransport(
          [
            "--buck-action-inputs",
            manifest,
            "--buck-action-state-root",
            stateRoot,
            "--workspace-root-marker",
            marker,
            "--artifact-tools-marker",
            artifactMarker,
          ],
          { BUCK_TEST_SRC: root, VBR_ARTIFACT_TOOLS_ROOT: artifactToolsRoot },
          true,
          "/bin/sh",
        ),
      /must start under its declared canonical Node/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("declared Buck action never converts ambient planner or coverage selectors", async () => {
  const { root, manifest, stateRoot, marker, artifactMarker } = await fixture();
  try {
    const result = canonicalBuckActionTransport(
      [
        "--buck-action-inputs",
        manifest,
        "--buck-action-state-root",
        stateRoot,
        "--workspace-root-marker",
        marker,
        "--artifact-tools-marker",
        artifactMarker,
      ],
      {
        BUCK_TEST_SRC: root,
        COVERAGE: "1",
        PLANNER_ONLY_CPP: "1",
        VBR_ARTIFACT_TOOLS_ROOT: artifactToolsRoot,
      },
      true,
      canonicalNode,
    );
    assert.equal(result.argv.includes("--coverage"), false);
    assert.equal(result.argv.includes("--planner-only-cpp"), false);
    assert.equal(result.env.COVERAGE, undefined);
    assert.equal(result.env.PLANNER_ONLY_CPP, undefined);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("transported Buck tool authority must match its declared marker", async () => {
  const { root, manifest, stateRoot, marker, artifactMarker } = await fixture();
  try {
    assert.throws(
      () =>
        canonicalBuckActionTransport(
          [
            "--buck-action-inputs",
            manifest,
            "--buck-action-state-root",
            stateRoot,
            "--workspace-root-marker",
            marker,
            "--artifact-tools-marker",
            artifactMarker,
          ],
          {
            BUCK_TEST_SRC: root,
            VBR_ARTIFACT_TOOLS_ROOT:
              "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-other-artifact-tools",
          },
          true,
          canonicalNode,
        ),
      /tool authority does not match its declared marker/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("declared Buck tool authority marker must not be a symlink", async () => {
  const { root, manifest, stateRoot, marker, artifactMarker } = await fixture();
  const target = path.join(stateRoot, "real-artifact-tools-root");
  try {
    await fsp.rename(artifactMarker, target);
    await fsp.symlink(target, artifactMarker);
    assert.throws(
      () =>
        canonicalBuckActionTransport(
          [
            "--buck-action-inputs",
            manifest,
            "--buck-action-state-root",
            stateRoot,
            "--workspace-root-marker",
            marker,
            "--artifact-tools-marker",
            artifactMarker,
          ],
          { BUCK_TEST_SRC: root, VBR_ARTIFACT_TOOLS_ROOT: artifactToolsRoot },
          true,
        ),
      /artifact-tools marker must be an action-state-owned regular file/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("declared Buck input manifest must remain inside its action state root", async () => {
  const { root, graph, manifest, stateRoot, marker, artifactMarker } = await fixture();
  const outsideManifest = path.join(root, "outside-inputs.txt");
  await fsp.writeFile(outsideManifest, `${graph}\n`);
  try {
    assert.throws(
      () =>
        canonicalBuckActionTransport(
          [
            "--buck-action-inputs",
            outsideManifest,
            "--buck-action-state-root",
            stateRoot,
            "--workspace-root-marker",
            marker,
            "--artifact-tools-marker",
            artifactMarker,
          ],
          {
            WORKSPACE_ROOT: root,
            BUCK_TEST_SRC: root,
            BUCK_GRAPH_JSON: graph,
            VBR_ARTIFACT_TOOLS_ROOT: artifactToolsRoot,
          },
          true,
        ),
      /input manifest must be owned by its action state root/,
    );
    assert.notEqual(manifest, outsideManifest);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
