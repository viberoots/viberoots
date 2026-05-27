#!/usr/bin/env zx-wrapper
import type { MiniCloudMigrationEvidence } from "./control-plane-mini-migration-preflight";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract";

export type MiniMigrationPreflightRequirement = { enabled: boolean } | undefined;

export function miniMigrationPreflightForNixosSubmit(
  requirement: MiniMigrationPreflightRequirement,
  request: NixosSharedHostControlPlaneSubmitRequest,
) {
  return requirement
    ? {
        miniMigrationPreflight: {
          enabled: requirement.enabled,
          evidence: request.miniMigrationEvidence as
            | Partial<MiniCloudMigrationEvidence>
            | undefined,
        },
      }
    : {};
}
