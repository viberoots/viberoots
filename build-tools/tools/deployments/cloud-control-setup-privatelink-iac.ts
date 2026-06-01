import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../lib/repo";
import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import {
  SUPABASE_PRIVATELINK_OPENTOFU_DIR,
  SUPABASE_PRIVATELINK_OPENTOFU_TFVARS,
} from "./cloud-control-supabase-privatelink-iac-rules";

const OPENTOFU_SOURCE_DIR = "build-tools/deployments/aws-control-plane-foundation/opentofu";
const OPENTOFU_BUNDLE_DIR = "opentofu/aws-control-plane-foundation";

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
    "supabase-privatelink-evidence-template.json": `${JSON.stringify(
      privateLinkEvidenceTemplate(),
      null,
      2,
    )}\n`,
  };
}

export function supabasePrivateLinkStackInputs(): string[] {
  return [
    SUPABASE_PRIVATELINK_OPENTOFU_TFVARS,
    ...opentofuSourceFilenames().map((name) => `$PROFILE_ROOT/${OPENTOFU_BUNDLE_DIR}/${name}`),
  ];
}

function renderOpenTofuStackFiles(): Record<string, string> {
  return Object.fromEntries(
    opentofuSourceFilenames().map((name) => [
      `${OPENTOFU_BUNDLE_DIR}/${name}`,
      readFileSync(path.join(repoRoot(), OPENTOFU_SOURCE_DIR, name), "utf8"),
    ]),
  );
}

function opentofuSourceFilenames(): string[] {
  return readdirSync(path.join(repoRoot(), OPENTOFU_SOURCE_DIR))
    .filter((name) => name.endsWith(".tf") || name.endsWith(".hcl.example"))
    .sort();
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
    requiredEvidenceFiles: [
      "$PROFILE_ROOT/supabase-privatelink-opentofu-plan.json",
      "$PROFILE_ROOT/supabase-privatelink-opentofu-apply.json",
      "$PROFILE_ROOT/supabase-privatelink-readonly-evidence.json",
    ],
    note: "Do not submit this template as evidence. Generate reviewed OpenTofu plan/apply evidence and read-only AWS/psql evidence with commands.json.",
  };
}
