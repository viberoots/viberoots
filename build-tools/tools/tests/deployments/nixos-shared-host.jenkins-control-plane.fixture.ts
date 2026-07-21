import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { writeAuthSession } from "./nixos-shared-host.service-auth-boundary.helpers";

const CONTROL_PLANE_TOKEN = "test-control-plane-token";
type RemoteControlPlaneRuntime = {
  tmp: string;
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
};
export async function startObjectBackedControlPlaneWorker(opts: RemoteControlPlaneRuntime) {
  const objectStore = memoryControlPlaneArtifactStore();
  const controlPlane = await startNixosSharedHostControlPlaneServer({
    workspaceRoot: opts.tmp,
    paths: {
      statePath: opts.remoteStatePath,
      hostRoot: opts.remoteRuntimeRoot,
      recordsRoot: opts.remoteRecordsRoot,
    },
    backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(opts.remoteRecordsRoot),
    token: CONTROL_PLANE_TOKEN,
    objectStore,
  });
  const worker = startNixosSharedHostControlPlaneWorkerLoop({
    workspaceRoot: opts.tmp,
    recordsRoot: opts.remoteRecordsRoot,
    backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(opts.remoteRecordsRoot),
    objectStore,
  });
  return { controlPlane, worker };
}
export async function writeJenkinsSubmitterAuthSession(recordsRoot: string, deployment: any) {
  return await writeAuthSession({
    recordsRoot,
    deployment,
    operationKind: "deploy",
    principalId: "oidc:service-account-jenkins",
    roles: ["submitter", "admission_reporter"],
  });
}
