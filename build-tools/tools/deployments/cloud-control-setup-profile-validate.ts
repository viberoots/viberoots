import YAML from "yaml";

const CONFIG = "/etc/deployment-control-plane/config.yaml";
const CREDS = "/run/deployment-control-plane/credentials";
const STATE = "/var/lib/deployment-control-plane";

type RenderedProcess = {
  name: string;
  image: string;
  command: string[];
  mounts: string[];
  user?: string;
  environment?: Record<string, string>;
};

export function validateRenderedProfile(files: Record<string, string>): string[] {
  const errors: string[] = [];
  const processes = renderedProcesses(files);
  errors.push(...validateImagePublication(files, processes));
  const service = processes.find((process) => process.name === "deployment-control-plane-service");
  const worker1 = processes.find((process) => process.name === "deployment-control-plane-worker-1");
  const worker2 = processes.find((process) => process.name === "deployment-control-plane-worker-2");
  if (!service) errors.push("missing service process");
  if (!worker1) errors.push("missing worker 1");
  if (!worker2) errors.push("missing worker 2");
  for (const process of [service, worker1, worker2].filter(Boolean) as RenderedProcess[]) {
    validateProcess(process, errors);
  }
  errors.push(...validateOwnership(files));
  return errors;
}

function validateImagePublication(
  files: Record<string, string>,
  processes: RenderedProcess[],
): string[] {
  const evidence = parseJson(files["image-publication.json"]);
  if (!evidence) return ["missing image publication evidence"];
  const images = new Set(processes.map((process) => process.image).filter(Boolean));
  if (images.size === 0) return [];
  if (images.size > 1) return ["profile processes do not share one image reference"];
  const image = [...images][0]!;
  if (evidence.image !== image) {
    return ["image publication evidence does not match generated profile image"];
  }
  const expectedEnvironment = {
    VBR_CONTROL_PLANE_SOURCE_REVISION: evidence.sourceRevision,
    VBR_CONTROL_PLANE_IMAGE_REF: image,
    VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY: evidence.imageBuildIdentity,
    VBR_CONTROL_PLANE_IMAGE_DIGEST: evidence.digest,
    VBR_CONTROL_PLANE_IMAGE_INSPECTED_DIGEST: evidence.inspectedDigest,
    VBR_CONTROL_PLANE_IMAGE_TAG: evidence.tag,
    VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS: "verified-registry-publication",
  };
  for (const process of processes) {
    const env = process.environment || {};
    for (const [key, value] of Object.entries(expectedEnvironment)) {
      if (env[key] !== value) {
        return [`${process.name} runtime ${key} metadata does not match publication evidence`];
      }
    }
  }
  return [];
}

export function validateProtectedSharedProfileReadiness(files: Record<string, string>): string[] {
  const errors = validateRenderedProfile(files);
  errors.push(...validateInfisicalManifest(files));
  if (profileSelfMarksReady(files)) {
    errors.push("generated profile must not self-mark protectedSharedReady");
  }
  if (errors.length > 0) errors.unshift("profile cannot be marked protected/shared-ready");
  return errors;
}

function validateInfisicalManifest(files: Record<string, string>): string[] {
  const errors: string[] = [];
  const manifest = parseJson(files["credential-manifest.json"]);
  const config = parseYaml(files["config.yaml"]) as any;
  if (!manifest || !Array.isArray(manifest.requiredFiles)) {
    errors.push("credential manifest is required before protected/shared readiness");
    return errors;
  }
  const deployments = config?.credentials?.infisicalDeployments;
  if (!Array.isArray(deployments) || deployments.length === 0) {
    errors.push("config.yaml requires credentials.infisicalDeployments");
    return errors;
  }
  const expected = new Set<string>();
  for (const deployment of deployments) {
    const id = String(deployment?.deploymentId || "");
    if (!id) {
      errors.push("config.yaml has an Infisical deployment without deploymentId");
      continue;
    }
    expected.add(`${id}-infisical-client-id`);
    expected.add(`${id}-infisical-client-secret`);
  }
  const actual = new Set(
    manifest.requiredFiles
      .map(String)
      .filter((file: string) => /-infisical-client-(id|secret)$/.test(file)),
  );
  for (const file of expected) {
    if (!actual.has(file)) errors.push(`credential manifest missing ${file}`);
  }
  for (const file of actual) {
    if (!expected.has(file)) errors.push(`credential manifest has unexpected ${file}`);
  }
  return errors;
}

function validateProcess(process: RenderedProcess, errors: string[]): void {
  if (!/^[^:]+\/[^:]+@sha256:[a-f0-9]{64}$/.test(process.image)) {
    errors.push(`${process.name} image must be digest pinned`);
  }
  if (!process.command.includes("--config") || !process.command.includes(CONFIG)) {
    errors.push(`${process.name} command must reference ${CONFIG}`);
  }
  for (const required of [
    CONFIG,
    CREDS,
    `${STATE}/records`,
    `${STATE}/artifacts`,
    `${STATE}/runtime`,
  ]) {
    if (!process.mounts.some((mount) => mount.includes(required))) {
      errors.push(`${process.name} missing mount ${required}`);
    }
  }
}

function validateOwnership(files: Record<string, string>): string[] {
  if (files["compose.yaml"]) return validateComposeOwnership(files["compose.yaml"]);
  if (files["nixos-module.example.nix"]) return [];
  const profile = parseYaml(files["saas-oci-profile.yaml"] || files["aws-ec2-profile.yaml"]);
  const user = (profile as any)?.runtimeUser;
  return user?.uid === 10001 && user?.gid === 10001
    ? []
    : ["runtime ownership must be uid/gid 10001"];
}

function validateComposeOwnership(raw: string): string[] {
  const parsed = YAML.parse(raw) as Record<string, any>;
  const runtime = parsed?.["x-control-plane-runtime"];
  const errors: string[] = [];
  if (runtime?.uid !== 10001 || runtime?.gid !== 10001) {
    errors.push("compose runtime ownership must be uid/gid 10001");
  }
  const owned = Array.isArray(runtime?.ownedPaths) ? runtime.ownedPaths.map(String) : [];
  for (const required of [`${STATE}/records`, `${STATE}/artifacts`, `${STATE}/runtime`]) {
    if (!owned.includes(required)) errors.push(`compose ownership missing ${required}`);
  }
  for (const process of composeProcesses(raw)) {
    if (process.user !== "10001:10001") errors.push(`${process.name} must run as 10001:10001`);
  }
  return errors;
}

function renderedProcesses(files: Record<string, string>): RenderedProcess[] {
  if (files["compose.yaml"]) return composeProcesses(files["compose.yaml"]);
  if (files["saas-oci-profile.yaml"])
    return profileProcesses(files["saas-oci-profile.yaml"], "processes");
  if (files["aws-ec2-profile.yaml"])
    return profileProcesses(files["aws-ec2-profile.yaml"], "systemdPodmanUnits");
  return nixosProcesses(files["nixos-module.example.nix"] || "");
}

function composeProcesses(raw: string): RenderedProcess[] {
  const parsed = YAML.parse(raw) as { services?: Record<string, any> };
  return Object.entries(parsed.services || {}).map(([name, service]) => ({
    name,
    image: String(service.image || ""),
    command: Array.isArray(service.command) ? service.command.map(String) : [],
    mounts: Array.isArray(service.volumes) ? service.volumes.map(String) : [],
    user: typeof service.user === "string" ? service.user : undefined,
    environment: service.environment || {},
  }));
}

function profileProcesses(raw: string, key: string): RenderedProcess[] {
  const parsed = YAML.parse(raw) as Record<string, any>;
  return (Array.isArray(parsed[key]) ? parsed[key] : []).map((process) => ({
    name: String(process.name || ""),
    image: String(process.image || ""),
    command: Array.isArray(process.command) ? process.command.map(String) : [],
    mounts: Array.isArray(process.mounts) ? process.mounts.map(String) : [],
    environment: process.environment || {},
  }));
}

function nixosProcesses(raw: string): RenderedProcess[] {
  if (!raw.includes("services.viberoots.deploymentControlPlaneContainer")) return [];
  const image = (raw.match(/image = "([^"]+)"/) || [])[1] || "";
  const sourceRevision = (raw.match(/imageSourceRevision = "([^"]+)"/) || [])[1] || "";
  const imageBuildIdentity = (raw.match(/imageBuildIdentity = "([^"]+)"/) || [])[1] || "";
  const inspectedDigest = (raw.match(/imageInspectedDigest = "([^"]+)"/) || [])[1] || "";
  const imageTag = (raw.match(/imageTag = "([^"]+)"/) || [])[1] || "";
  return ["service", "worker-1", "worker-2"].map((role) => ({
    name: `deployment-control-plane-${role}`,
    image,
    command: [role.startsWith("worker") ? "worker" : "service", "--config", CONFIG],
    mounts: [CONFIG, CREDS, `${STATE}/records`, `${STATE}/artifacts`, `${STATE}/runtime`],
    environment: {
      VBR_CONTROL_PLANE_SOURCE_REVISION: sourceRevision,
      VBR_CONTROL_PLANE_IMAGE_REF: image,
      VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY: imageBuildIdentity,
      VBR_CONTROL_PLANE_IMAGE_DIGEST: image.split("@").at(-1) || "",
      VBR_CONTROL_PLANE_IMAGE_INSPECTED_DIGEST: inspectedDigest,
      VBR_CONTROL_PLANE_IMAGE_TAG: imageTag,
      VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS: "verified-registry-publication",
    },
  }));
}

function parseJson(raw?: string): any {
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function parseYaml(raw?: string): unknown {
  try {
    return raw ? YAML.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function profileSelfMarksReady(files: Record<string, string>): boolean {
  for (const name of ["saas-oci-profile.yaml", "aws-ec2-profile.yaml"]) {
    const parsed = parseYaml(files[name]);
    if ((parsed as any)?.protectedSharedReady === true) return true;
  }
  const compose = parseYaml(files["compose.yaml"]);
  return (compose as any)?.["x-control-plane-runtime"]?.protectedSharedReady === true;
}
