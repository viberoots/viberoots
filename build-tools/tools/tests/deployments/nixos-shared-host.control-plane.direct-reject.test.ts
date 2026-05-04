#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runNixosSharedHostStaticDeploy } from "../../deployments/nixos-shared-host-static-deploy";
import { runInTemp } from "../lib/test-helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("shared control plane rejects direct local shared_nonprod mutation outside the worker path", async () => {
  await runInTemp("nixos-shared-host-control-plane-direct-reject", async (tmp) => {
    await assert.rejects(
      runNixosSharedHostStaticDeploy({
        deployment: nixosSharedHostDeploymentFixture(),
        artifact: {
          kind: "nixos-shared-host-static-webapp",
          identity: "static-webapp:direct-local-reject",
          storedArtifactPath: path.join(tmp, "artifact"),
          provenancePath: path.join(tmp, "artifact.json"),
        },
        statePath: path.join(tmp, "platform-state.json"),
        hostRoot: path.join(tmp, "host"),
        recordsRoot: path.join(tmp, "records"),
      }),
      /must execute through the shared control plane/,
    );
  });
});
