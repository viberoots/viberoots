import { sanitizeName } from "../../../lib/sanitize";

function wordsFromSanitizedName(value: string): string[] {
  return value.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0);
}

function toPascalIdentifier(value: string): string {
  const base = wordsFromSanitizedName(value)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  const identifier = `${base || "Deployment"}Container`;
  return /^[0-9]/.test(identifier) ? `Deployment${identifier}` : identifier;
}

function toBindingName(value: string): string {
  const base =
    value
      .replaceAll(/[^A-Za-z0-9]+/g, "_")
      .replaceAll(/^_+|_+$/g, "")
      .toUpperCase() || "DEPLOYMENT";
  return /^[0-9]/.test(base) ? `DEPLOYMENT_${base}_CONTAINER` : `${base}_CONTAINER`;
}

function deriveCloudflareContainersNames(data: Record<string, unknown>) {
  const sanitizedDeploymentName = sanitizeName(String(data.name || "")).trim() || "deployment";
  data.cloudflare_container_class_name = toPascalIdentifier(sanitizedDeploymentName);
  data.cloudflare_container_binding_name = toBindingName(sanitizedDeploymentName);
  data.cloudflare_container_migration_tag = `${sanitizedDeploymentName}-containers-v1`;
  data.cloudflare_worker_entrypoint_name = `${sanitizedDeploymentName}-worker`;
  data.cloudflare_worker_entrypoint_path = `src/${data.cloudflare_worker_entrypoint_name}.ts`;
}

function truthy(value: unknown): boolean {
  return ["true", "1", "yes"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function validateCloudflareContainers(data: Record<string, unknown>) {
  if (String(data.ingress_mode || "private").trim() !== "public") return;
  if (truthy(data.workers_dev_exception)) {
    throw new Error(
      "deployment/cloudflare-containers workers_dev_exception requires reviewed target_exception metadata, which this scaffold does not generate",
    );
  }
  const missing = ["domain", "cloudflare_zone_id"].filter(
    (field) => !String(data[field] || "").trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `deployment/cloudflare-containers public ingress requires ${missing
        .map((field) => `--${field}`)
        .join(", ")}`,
    );
  }
}

export function validateDeploymentScaffoldAnswers(
  language: string,
  template: string,
  data: Record<string, unknown>,
) {
  if (language !== "deployment" || template !== "cloudflare-containers") return;
  deriveCloudflareContainersNames(data);
  validateCloudflareContainers(data);
}
