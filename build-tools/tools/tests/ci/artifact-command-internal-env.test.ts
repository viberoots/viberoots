import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewedArtifactCommandInternalEnv } from "../../ci/artifact-command";

const workspaceRoot = "/owned/consumer";
const artifactToolsRoot = `/nix/store/${"a".repeat(32)}-remote-ci-tools`;

test("artifact command internal environment is a fixed closed transport", () => {
  assert.deepEqual(
    reviewedArtifactCommandInternalEnv(
      {
        VBR_UPDATE: "1",
        VBR_WORKSPACE_ROOT: workspaceRoot,
        VBR_VIBEROOTS_URL: `path:${artifactToolsRoot}/share/viberoots-source`,
      },
      workspaceRoot,
      artifactToolsRoot,
    ),
    {
      VBR_UPDATE: "1",
      VBR_WORKSPACE_ROOT: workspaceRoot,
      VBR_VIBEROOTS_URL: `path:${artifactToolsRoot}/share/viberoots-source`,
    },
  );
  assert.throws(
    () =>
      reviewedArtifactCommandInternalEnv(
        { CC: "/host/compiler" } as never,
        workspaceRoot,
        artifactToolsRoot,
      ),
    /rejects unreviewed internal environment CC/,
  );
  assert.throws(
    () => reviewedArtifactCommandInternalEnv({ VBR_UPDATE: "0" }, workspaceRoot, artifactToolsRoot),
    /rejects unreviewed internal environment VBR_UPDATE/,
  );
});
