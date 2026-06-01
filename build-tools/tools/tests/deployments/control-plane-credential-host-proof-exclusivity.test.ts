#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { validateRunbookBundle } from "../../deployments/cloud-control-runbook";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { runCredentialStaging } from "../../deployments/control-plane-credential-staging";
import { runInScratchTemp } from "../lib/test-helpers";
import { evidence } from "./cloud-control-cutover-fixture";
import {
  credentialOwner,
  writeCredentialFiles,
  writeLiveProfile,
} from "./control-plane-credential-live.fixture";
import { cutoverOptions, writeBundle } from "./control-plane-credential-staging.helpers";
import { startFakeInfisicalServer } from "./infisical.test-server";

test("host mount proof cannot be mixed with generated live backend writes", async () => {
  await runInScratchTemp("credential-host-proof-live-write", async (tmp) => {
    await writeBundle(tmp);
    const map = JSON.parse(await fsp.readFile(path.join(tmp, "credential-map.json"), "utf8"));
    const plan = map.entries.find(
      (entry: any) => entry.source.kind === "generated-secret-write-plan",
    );
    const server = await startFakeInfisicalServer(
      { clientId: "writer", clientSecret: "writer-secret", accessToken: "token" },
      [],
      { projectId: plan.source.selector.projectId, environment: plan.source.selector.environment },
    );
    try {
      const profile = path.join(tmp, "live-infisical-backend.profile.json");
      const credentials = path.join(tmp, "credentials");
      const hostProof = path.join(tmp, "external-host-mount-proof.json");
      await writeLiveProfile(profile, server.siteUrl, plan.source);
      await writeCredentialFiles(tmp, credentials);
      await fsp.writeFile(hostProof, JSON.stringify({ reviewedHostMount: true }), "utf8");
      const owner = await credentialOwner(credentials);
      const previous = process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
      try {
        process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = "1";
        const staging = await runCredentialStaging({
          bundleDir: tmp,
          live: true,
          liveBackendProfile: profile,
          hostMountEvidence: hostProof,
          credentialOwnerUid: owner.uid,
          credentialOwnerGid: owner.gid,
        });
        const message = "mixed external host proof/live backend write";
        assert.equal(staging.ok, false);
        assert.ok(staging.externalReviewedHostProof);
        assert.ok(staging.deploymentOwnedLiveBackendWrite);
        assert.equal(staging.deploymentOwnedLiveHostVerification, undefined);
        assert.match(staging.errors.join("\n"), new RegExp(message));
        const cutover = validateCloudControlCutover(
          evidence({ credentialStaging: staging }) as any,
          cutoverOptions(),
        );
        assert.match(cutover.errors.join("\n"), new RegExp(message));
        await writeRunbookEvidence(tmp, staging);
        const doctor = await validateRunbookBundle(tmp);
        assert.match(JSON.stringify(doctor.phases), new RegExp(message));
      } finally {
        if (previous === undefined) delete process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING;
        else process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING = previous;
      }
    } finally {
      await server.close();
    }
  });
});

async function writeRunbookEvidence(tmp: string, staging: any): Promise<void> {
  await fsp.writeFile(path.join(tmp, "credential-staging.live.json"), JSON.stringify(staging));
}
