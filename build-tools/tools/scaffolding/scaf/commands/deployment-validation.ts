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
  validateCloudflareContainers(data);
}
