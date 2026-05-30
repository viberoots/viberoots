import type { CloudControlSetupInput } from "./cloud-control-setup-types";

export const CONTROL_PLANE_CONFIG = "/etc/deployment-control-plane/config.yaml";
export const CONTROL_PLANE_CREDS = "/run/deployment-control-plane/credentials";
export const CONTROL_PLANE_STATE = "/var/lib/deployment-control-plane";
export const CONTROL_PLANE_UID = 10001;
export const CONTROL_PLANE_GID = 10001;

export type ControlPlaneProcessRole = "service" | "worker";

export type RenderedControlPlaneProcess = {
  name: string;
  role: ControlPlaneProcessRole;
  image: string;
  command: string[];
  mounts: string[];
  environment: Record<string, string>;
  workerId?: string;
  servicePort?: number;
  systemdUnit?: string;
};

export function controlPlaneProcessSpecs(
  input: CloudControlSetupInput,
): RenderedControlPlaneProcess[] {
  return [
    {
      name: "deployment-control-plane-service",
      role: "service",
      image: input.image,
      command: ["service", "--config", CONTROL_PLANE_CONFIG],
      mounts: mountedPaths(),
      environment: Object.fromEntries(controlPlaneMetadataEnv(input)),
      servicePort: 7780,
      systemdUnit: "deployment-control-plane-service.service",
    },
    ...workerIndexes(input).map((index) => {
      const workerId = `worker-${index}`;
      return {
        name: `deployment-control-plane-worker-${index}`,
        role: "worker" as const,
        image: input.image,
        command: ["worker", "--config", CONTROL_PLANE_CONFIG, "--worker-id", workerId],
        mounts: mountedPaths(),
        environment: Object.fromEntries(controlPlaneMetadataEnv(input)),
        workerId,
        systemdUnit: `deployment-control-plane-worker-${index}.service`,
      };
    }),
  ];
}

export function mountedPaths(): string[] {
  return [
    CONTROL_PLANE_CONFIG,
    CONTROL_PLANE_CREDS,
    `${CONTROL_PLANE_STATE}/records`,
    `${CONTROL_PLANE_STATE}/artifacts`,
    `${CONTROL_PLANE_STATE}/runtime`,
  ];
}

export function controlPlaneMountSpecs(kind: string) {
  return mountedPaths().map((target) => ({
    kind,
    target,
    readOnly: target === CONTROL_PLANE_CONFIG || target === CONTROL_PLANE_CREDS,
  }));
}

export function controlPlaneMetadataEnv(input: CloudControlSetupInput): Array<[string, string]> {
  return [
    ["VBR_CONTROL_PLANE_SOURCE_REVISION", input.imagePublication!.sourceRevision],
    ["VBR_CONTROL_PLANE_IMAGE_REF", input.image],
    ["VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY", input.expectedImageBuildIdentity],
    ["VBR_CONTROL_PLANE_IMAGE_DIGEST", input.imagePublication!.digest],
    ["VBR_CONTROL_PLANE_IMAGE_INSPECTED_DIGEST", input.imagePublication!.inspectedDigest],
    ["VBR_CONTROL_PLANE_IMAGE_TAG", input.imagePublication!.tag],
    ["VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS", "verified-registry-publication"],
  ];
}

export function workerIndexes(input: CloudControlSetupInput): number[] {
  return Array.from({ length: Math.max(2, input.workerReplicas) }, (_, index) => index + 1);
}
