#!/usr/bin/env zx-wrapper
import type { ProjectConfig } from "./project-config";
import { validateProtectedSharedServiceTransport } from "./deployment-service-transport-policy";
import { deploymentContextError } from "./deployment-context-validation";

export type DeploymentControlPlaneProfile = {
  name: string;
  serviceClient: {
    controlPlaneUrl: string;
    controlPlaneTokenRef: string;
  };
  records: {
    backend: "service";
  };
};
export type DeploymentControlPlaneSelection = DeploymentControlPlaneProfile & {
  graphMetadata: ReturnType<typeof controlPlaneGraphMetadata>;
};

type ContextRecord = Record<string, unknown>;

const PROFILE_KEYS = new Set(["serviceClient", "records"]);
const SERVICE_CLIENT_KEYS = new Set(["controlPlaneUrl", "controlPlaneTokenRef"]);
const RECORDS_KEYS = new Set(["backend"]);
const TOKEN_REF = /^(secret|runtime):\/\/.+/;
const PLAINTEXT_TOKEN_FIELDS = new Set(["controlPlaneToken", "token", "bearerToken"]);

export function resolveContextControlPlane(opts: {
  config: ProjectConfig;
  selector: string;
  context: ContextRecord;
  label: string;
  errors: string[];
}): DeploymentControlPlaneSelection | undefined {
  const name = stringValue(opts.context.controlPlane);
  if (!name) return undefined;
  const profiles = opts.config.controlPlanes;
  if (!isRecord(profiles)) {
    opts.errors.push(
      deploymentContextError(
        opts.label,
        `unknown deployment_context ${opts.selector}.controlPlane "${name}"`,
      ),
    );
    return undefined;
  }
  const profile = profiles[name];
  if (!isRecord(profile)) {
    opts.errors.push(
      deploymentContextError(
        opts.label,
        `unknown deployment_context ${opts.selector}.controlPlane "${name}"`,
      ),
    );
    return undefined;
  }
  const normalized = normalizeControlPlaneProfile({
    name,
    profile,
    label: opts.label,
    errors: opts.errors,
  });
  return normalized
    ? { ...normalized, graphMetadata: controlPlaneGraphMetadata(normalized) }
    : undefined;
}

export function controlPlaneGraphMetadata(profile: DeploymentControlPlaneProfile) {
  return {
    name: profile.name,
    service_client: {
      control_plane_url: profile.serviceClient.controlPlaneUrl,
      control_plane_token_ref: profile.serviceClient.controlPlaneTokenRef,
    },
    records: {
      backend: profile.records.backend,
    },
  };
}

function normalizeControlPlaneProfile(opts: {
  name: string;
  profile: ContextRecord;
  label: string;
  errors: string[];
}): DeploymentControlPlaneProfile | undefined {
  const errorCount = opts.errors.length;
  validateKeys(opts, "controlPlanes", opts.profile, PROFILE_KEYS);
  rejectPlaintextTokenFields(opts, "controlPlanes", opts.profile);
  const serviceClient = readServiceClient(opts);
  const records = readRecords(opts);
  if (!serviceClient || opts.errors.length > errorCount) return undefined;
  return { name: opts.name, serviceClient, records };
}

function readServiceClient(opts: {
  name: string;
  profile: ContextRecord;
  label: string;
  errors: string[];
}): DeploymentControlPlaneProfile["serviceClient"] | undefined {
  const raw = opts.profile.serviceClient;
  const path = `controlPlanes.${opts.name}.serviceClient`;
  if (!isRecord(raw)) {
    opts.errors.push(deploymentContextError(opts.label, `${path} is required`));
    return undefined;
  }
  validateKeys(opts, path, raw, SERVICE_CLIENT_KEYS);
  rejectPlaintextTokenFields(opts, path, raw);
  const controlPlaneUrl = stringValue(raw.controlPlaneUrl);
  const controlPlaneTokenRef = stringValue(raw.controlPlaneTokenRef);
  if (!controlPlaneUrl)
    opts.errors.push(deploymentContextError(opts.label, `${path}.controlPlaneUrl is required`));
  if (!controlPlaneTokenRef) {
    opts.errors.push(
      deploymentContextError(opts.label, `${path}.controlPlaneTokenRef is required`),
    );
  } else if (!TOKEN_REF.test(controlPlaneTokenRef)) {
    opts.errors.push(
      deploymentContextError(
        opts.label,
        `${path}.controlPlaneTokenRef must be a secret:// or runtime:// ref`,
      ),
    );
  }
  if (!controlPlaneUrl || !controlPlaneTokenRef || !TOKEN_REF.test(controlPlaneTokenRef)) {
    return undefined;
  }
  try {
    return {
      controlPlaneUrl: validateProtectedSharedServiceTransport({
        controlPlaneUrl,
        context: path,
      }),
      controlPlaneTokenRef,
    };
  } catch (error) {
    opts.errors.push(
      deploymentContextError(opts.label, error instanceof Error ? error.message : String(error)),
    );
    return undefined;
  }
}

function readRecords(opts: {
  name: string;
  profile: ContextRecord;
  label: string;
  errors: string[];
}): DeploymentControlPlaneProfile["records"] {
  const raw = opts.profile.records;
  if (raw === undefined) return { backend: "service" };
  const path = `controlPlanes.${opts.name}.records`;
  if (!isRecord(raw)) {
    opts.errors.push(deploymentContextError(opts.label, `${path} must be an object`));
    return { backend: "service" };
  }
  validateKeys(opts, path, raw, RECORDS_KEYS);
  const backend = stringValue(raw.backend) || "service";
  if (backend !== "service") {
    opts.errors.push(deploymentContextError(opts.label, `${path}.backend only supports service`));
  }
  return { backend: "service" };
}

function validateKeys(
  opts: { name: string; label: string; errors: string[] },
  path: string,
  value: ContextRecord,
  allowed: Set<string>,
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      opts.errors.push(deploymentContextError(opts.label, `${path}.${key} is unsupported`));
    }
  }
}

function rejectPlaintextTokenFields(
  opts: { label: string; errors: string[] },
  path: string,
  value: ContextRecord,
) {
  for (const key of Object.keys(value)) {
    if (PLAINTEXT_TOKEN_FIELDS.has(key)) {
      opts.errors.push(
        deploymentContextError(opts.label, `${path}.${key} must not contain a plaintext token`),
      );
    }
  }
}

function isRecord(value: unknown): value is ContextRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
