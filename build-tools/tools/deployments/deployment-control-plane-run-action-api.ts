#!/usr/bin/env zx-wrapper
import { handleControlPlaneRunActionService } from "./deployment-control-plane-run-action-service";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneRunActionRequest,
} from "./deployment-control-plane-contract";
import type { DeploymentPrincipal } from "./deployment-admission-evidence";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";

export type ServiceRunActionRequest = DeploymentControlPlaneRunActionRequest & {
  deployRunId?: string;
  authSessionId?: string;
  requestedBy?: DeploymentPrincipal;
  authorization?: DeploymentControlPlaneAuthorization;
};

export async function handleControlPlaneRunAction(
  request: ServiceRunActionRequest,
  opts: { backend: NixosSharedHostControlPlaneBackendTarget; workspaceRoot: string },
) {
  return await handleControlPlaneRunActionService(request, opts);
}
