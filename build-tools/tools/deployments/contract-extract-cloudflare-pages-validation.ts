import { deploymentError, pushTokenFieldErrors } from "./contract-extract-shared";

const TARGET_TOKEN_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const PROVISION_MODES = new Set(["managed", "manual"]);

export function pushCloudflarePagesTargetFieldErrors(args: {
  errors: string[];
  label: string;
  protectionClass: string;
  publisher: string;
  publisherConfig: string;
  provisioner: string;
  account: string;
  accountId: string;
  project: string;
  targetId: string;
  customDomain: string;
  provisionMode: string;
  releaseActionRefs: string[];
}) {
  for (const [fieldPath, value, required] of [
    ["provider_target.account", args.account, true],
    ["provider_target.project", args.project, true],
    ["provider_target.id", args.targetId || args.project, false],
  ] as const) {
    pushTokenFieldErrors({
      errors: args.errors,
      label: args.label,
      fieldPath,
      value,
      pattern: TARGET_TOKEN_RE,
      required,
      invalidMessage: `${fieldPath} must be lowercase alphanumeric plus internal hyphens`,
    });
  }
  if (args.accountId && !/^[0-9a-f]{32}$/.test(args.accountId)) {
    args.errors.push(
      deploymentError(
        args.label,
        "provider_target.account_id must be a 32-character lowercase Cloudflare account id",
      ),
    );
  }
  if (!PROVISION_MODES.has(args.provisionMode)) {
    args.errors.push(
      deploymentError(args.label, 'provider_target.provision_mode must be "managed" or "manual"'),
    );
  }
  if (args.provisionMode === "managed" && args.customDomain && !args.accountId) {
    args.errors.push(
      deploymentError(
        args.label,
        "managed cloudflare-pages custom-domain provisioning requires provider_target.account_id",
      ),
    );
  }
  if (args.protectionClass !== "shared_nonprod" && args.protectionClass !== "production_facing") {
    args.errors.push(
      deploymentError(
        args.label,
        'cloudflare-pages deployments must use protection_class "shared_nonprod" or "production_facing"',
      ),
    );
  }
  if (args.publisher !== "wrangler-pages") {
    args.errors.push(
      deploymentError(
        args.label,
        `unsupported cloudflare-pages publisher "${args.publisher || "<empty>"}"`,
      ),
    );
  }
  if (!args.publisherConfig) {
    args.errors.push(deploymentError(args.label, "missing required publisher_config"));
  }
  if (args.provisioner) {
    args.errors.push(
      deploymentError(
        args.label,
        "deployment-owned provisioner is not supported for cloudflare-pages",
      ),
    );
  }
  if (args.releaseActionRefs.length > 0) {
    args.errors.push(
      deploymentError(
        args.label,
        "cloudflare-pages does not support protected/shared release_actions",
      ),
    );
  }
}
