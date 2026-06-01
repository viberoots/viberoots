import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import {
  opentofuStackInputs,
  renderOpenTofuStackFiles,
} from "./cloud-control-setup-opentofu-stack";
import {
  SUPABASE_PRIVATELINK_OPENTOFU_BACKEND,
  SUPABASE_PRIVATELINK_OPENTOFU_DIR,
  SUPABASE_PRIVATELINK_OPENTOFU_TFVARS,
} from "./cloud-control-supabase-privatelink-iac-rules";

export function renderPrivateLinkOpenTofuFiles(
  input: CloudControlSetupInput,
): Record<string, string> {
  const database = input.awsTopology?.database;
  if (database?.mode !== "privatelink") return {};
  return {
    ...renderOpenTofuStackFiles(),
    "supabase-privatelink-opentofu.tfvars.json": `${JSON.stringify(
      privateLinkTfvars(database.privatelink),
      null,
      2,
    )}\n`,
    "supabase-privatelink-backend.hcl": privateLinkBackendConfig(input),
    "supabase-privatelink-evidence-template.json": `${JSON.stringify(
      privateLinkEvidenceTemplate(),
      null,
      2,
    )}\n`,
  };
}

export function supabasePrivateLinkStackInputs(): string[] {
  return [
    SUPABASE_PRIVATELINK_OPENTOFU_BACKEND,
    SUPABASE_PRIVATELINK_OPENTOFU_TFVARS,
    ...opentofuStackInputs(),
  ];
}

function privateLinkBackendConfig(input: CloudControlSetupInput) {
  const region = input.awsTopology?.region || input.artifactRegion;
  return [
    `bucket         = ${JSON.stringify(`${input.instanceId}-tofu-state`)}`,
    `key            = ${JSON.stringify(`aws-foundation/${input.instanceId}/supabase-privatelink.tfstate`)}`,
    `region         = ${JSON.stringify(region)}`,
    `dynamodb_table = ${JSON.stringify(`${input.instanceId}-tofu-lock`)}`,
    "encrypt        = true",
    "",
  ].join("\n");
}

function privateLinkTfvars(evidence: any) {
  const serviceNetworkMode = !evidence.endpointId && !!evidence.serviceNetworkAssociationId;
  return {
    supabase_privatelink_enabled: true,
    supabase_privatelink_connection_mode: serviceNetworkMode ? "service-network" : "endpoint",
    supabase_privatelink_ram_share_arn: evidence.ramShareArn,
    supabase_privatelink_resource_configuration_arn: evidence.resourceConfigurationArn,
    supabase_privatelink_endpoint_subnet_ids: [],
    supabase_privatelink_private_dns_enabled: evidence.privateDns?.enabled === true,
    supabase_privatelink_service_network_identifier: serviceNetworkMode
      ? "<reviewed-service-network-id-or-arn>"
      : "",
    supabase_privatelink_import_adoption_metadata: {
      mode: "managed",
      reviewed_reference: "docs/control-plane-guide.md#step-2-enable-supabase-privatelink",
      import_block:
        "review and add import blocks before apply when adopting existing AWS resources",
    },
  };
}

function privateLinkEvidenceTemplate() {
  return {
    templateOnly: true,
    bundleRoot: "$PROFILE_ROOT",
    workingDirectory: SUPABASE_PRIVATELINK_OPENTOFU_DIR,
    backendConfig: SUPABASE_PRIVATELINK_OPENTOFU_BACKEND,
    requiredEvidenceFiles: [
      "$PROFILE_ROOT/supabase-privatelink-opentofu-plan.json",
      "$PROFILE_ROOT/supabase-privatelink-opentofu-apply.json",
      "$PROFILE_ROOT/supabase-privatelink-readonly-evidence.json",
    ],
    note: "Do not submit this template as evidence. Generate reviewed OpenTofu plan/apply evidence and read-only AWS/psql evidence with commands.json.",
  };
}
