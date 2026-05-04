#!/usr/bin/env zx-wrapper
import { failStaticDeployWithRecord } from "./nixos-shared-host-static-deploy-progressive";
import { writeNixosSharedHostSuccessRecord } from "./nixos-shared-host-provision-record";

export async function failNixosSharedHostStaticDeploy(
  opts: Parameters<typeof failStaticDeployWithRecord>[0],
) {
  await failStaticDeployWithRecord(opts);
}

export async function writeSuccessfulNixosSharedHostStaticDeployRecord(
  opts: Parameters<typeof writeNixosSharedHostSuccessRecord>[0],
) {
  return await writeNixosSharedHostSuccessRecord(opts);
}
