import type { RunbookCommand } from "./cloud-control-runbook";
import { supabasePrivateLinkStackInputs } from "./cloud-control-setup-privatelink-iac";
import { setupAwsTopology } from "./cloud-control-setup-aws-topology";
import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import {
  SUPABASE_PRIVATELINK_IAC_PATHS,
  SUPABASE_PRIVATELINK_OPENTOFU_BACKEND,
  SUPABASE_PRIVATELINK_OPENTOFU_DIR,
  SUPABASE_PRIVATELINK_OPENTOFU_TFVARS,
} from "./cloud-control-supabase-privatelink-iac-rules";
import { PRIVATELINK_PSQL_PROOF_HELPER } from "./cloud-control-setup-privatelink-psql-helper";

type PrivateLinkAction = {
  id: string;
  output: string;
  guidance: string;
};

export function supabasePrivateLinkEvidenceCommands(
  input: CloudControlSetupInput,
  prelude: string,
): RunbookCommand[] {
  const topology = setupAwsTopology(input);
  if (input.mode !== "aws-ec2" || topology?.database?.mode !== "privatelink") return [];
  const privatelink = topology.database.privatelink;
  return actions(privatelink.endpointId ? "endpoint" : "service-network").map((action) => ({
    id: action.id,
    command: guidanceCommand(prelude, action),
    cwd: "profile-root",
    actionType: "operator-evidence",
    evidenceGuidance: action.guidance,
    inputs: [
      "$PROFILE_ROOT/aws-topology-evidence.json",
      "$PROFILE_ROOT/provider-capabilities.json",
    ],
    outputs: [`$PROFILE_ROOT/${action.output}`],
    mustPass: `operator records ${action.guidance}`,
  }));
}

export function supabasePrivateLinkIacCommands(
  input: CloudControlSetupInput,
  prelude: string,
): RunbookCommand[] {
  const topology = setupAwsTopology(input);
  if (input.mode !== "aws-ec2" || topology?.database?.mode !== "privatelink") return [];
  return [
    {
      id: "supabase-privatelink-opentofu-plan",
      command: opentofuPlanCommand(prelude),
      cwd: "profile-root",
      actionType: "reviewed-iac",
      evidenceGuidance:
        "run reviewed OpenTofu plan from the bundle-root stack, review the raw plan output, then write typed plan evidence",
      inputs: [
        "$PROFILE_ROOT/aws-topology-evidence.json",
        "$PROFILE_ROOT/provider-capabilities.json",
        ...supabasePrivateLinkStackInputs(),
      ],
      outputs: [
        "$PROFILE_ROOT/supabase-privatelink-opentofu.tfplan",
        "$PROFILE_ROOT/supabase-privatelink-opentofu-plan.out.json",
        SUPABASE_PRIVATELINK_IAC_PATHS.plan,
      ],
      mustPass: "reviewed OpenTofu plan evidence is supplied from bundle-root artifacts",
    },
    {
      id: "supabase-privatelink-opentofu-apply",
      command: opentofuApplyCommand(prelude),
      cwd: "profile-root",
      actionType: "reviewed-iac",
      evidenceGuidance:
        "apply the reviewed OpenTofu plan, review outputs/state-safe evidence, then write typed apply evidence",
      inputs: [
        "$PROFILE_ROOT/supabase-privatelink-opentofu.tfplan",
        SUPABASE_PRIVATELINK_IAC_PATHS.plan,
        ...supabasePrivateLinkStackInputs(),
      ],
      outputs: [
        "$PROFILE_ROOT/supabase-privatelink-opentofu-apply.out.json",
        SUPABASE_PRIVATELINK_IAC_PATHS.apply,
      ],
      mustPass: "reviewed OpenTofu apply evidence is supplied from bundle-root artifacts",
    },
    {
      id: "supabase-privatelink-readonly-evidence",
      command: readOnlyEvidenceCommand(prelude),
      cwd: "profile-root",
      actionType: "read-only-evidence",
      evidenceGuidance:
        "collect read-only AWS RAM/Lattice/DNS/security-group evidence plus psql proof, then write typed read-only evidence",
      inputs: ["$PROFILE_ROOT/aws-topology-evidence.json", SUPABASE_PRIVATELINK_IAC_PATHS.apply],
      outputs: [
        "$PROFILE_ROOT/supabase-privatelink-readonly-ram.json",
        "$PROFILE_ROOT/supabase-privatelink-readonly-lattice.json",
        "$PROFILE_ROOT/supabase-privatelink-readonly-private-dns.txt",
        "$PROFILE_ROOT/supabase-privatelink-readonly-security-groups.json",
        "$PROFILE_ROOT/supabase-privatelink-readonly-psql.json",
        SUPABASE_PRIVATELINK_IAC_PATHS.readOnly,
      ],
      mustPass: "read-only AWS and psql evidence is supplied from selected VPC path",
    },
  ];
}

function actions(variant: "endpoint" | "service-network"): PrivateLinkAction[] {
  return [
    {
      id: "supabase-privatelink-support-initiation",
      output: "supabase-privatelink-support-initiation.json",
      guidance: "Supabase dashboard/support initiation and resource configuration share evidence",
    },
    {
      id: "supabase-privatelink-ram-acceptance",
      output: "supabase-privatelink-ram-acceptance.json",
      guidance: "AWS RAM share acceptance/status and permission evidence",
    },
    {
      id: "supabase-privatelink-vpc-lattice",
      output: "supabase-privatelink-vpc-lattice.json",
      guidance: `AWS VPC Lattice ${variant} association evidence`,
    },
    {
      id: "supabase-privatelink-private-dns",
      output: "supabase-privatelink-private-dns.json",
      guidance: "private DNS enabled and selected-VPC resolution evidence",
    },
    {
      id: "supabase-privatelink-tcp-5432-sg",
      output: "supabase-privatelink-tcp-5432-sg.json",
      guidance: "TCP 5432 security-group evidence from service and worker SGs",
    },
    {
      id: "supabase-privatelink-private-psql",
      output: "supabase-privatelink-private-psql.json",
      guidance: "private psql evidence from the selected AWS EC2 VPC path",
    },
  ];
}

function guidanceCommand(prelude: string, action: PrivateLinkAction): string {
  return `${prelude}; printf '%s\\n' ${shellQuote(
    action.guidance,
  )}; test -f "$PROFILE_ROOT/${action.output}" || { echo ${shellQuote(
    `write reviewed evidence to $PROFILE_ROOT/${action.output}`,
  )} >&2; exit 2; }`;
}

function opentofuPlanCommand(prelude: string): string {
  return [
    prelude,
    `test -d "${SUPABASE_PRIVATELINK_OPENTOFU_DIR}"`,
    `test -f "${SUPABASE_PRIVATELINK_OPENTOFU_TFVARS}"`,
    `test -f "${SUPABASE_PRIVATELINK_OPENTOFU_BACKEND}"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/supabase-privatelink" tofu -chdir="${SUPABASE_PRIVATELINK_OPENTOFU_DIR}" init -input=false -backend-config="${SUPABASE_PRIVATELINK_OPENTOFU_BACKEND}"`,
    workspaceCommand(),
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/supabase-privatelink" tofu -chdir="${SUPABASE_PRIVATELINK_OPENTOFU_DIR}" plan -input=false -var-file="${SUPABASE_PRIVATELINK_OPENTOFU_TFVARS}" -out="$PROFILE_ROOT/supabase-privatelink-opentofu.tfplan"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/supabase-privatelink" tofu -chdir="${SUPABASE_PRIVATELINK_OPENTOFU_DIR}" show -json "$PROFILE_ROOT/supabase-privatelink-opentofu.tfplan" > "$PROFILE_ROOT/supabase-privatelink-opentofu-plan.out.json"`,
    requireEvidenceFile(
      SUPABASE_PRIVATELINK_IAC_PATHS.plan,
      "write reviewed typed OpenTofu plan evidence after reviewing supabase-privatelink-opentofu-plan.out.json",
    ),
  ].join("; ");
}

function opentofuApplyCommand(prelude: string): string {
  return [
    prelude,
    `test -f "${SUPABASE_PRIVATELINK_IAC_PATHS.plan}"`,
    `test -f "${SUPABASE_PRIVATELINK_OPENTOFU_BACKEND}"`,
    `test -f "$PROFILE_ROOT/supabase-privatelink-opentofu.tfplan"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/supabase-privatelink" tofu -chdir="${SUPABASE_PRIVATELINK_OPENTOFU_DIR}" init -input=false -backend-config="${SUPABASE_PRIVATELINK_OPENTOFU_BACKEND}"`,
    workspaceCommand(),
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/supabase-privatelink" tofu -chdir="${SUPABASE_PRIVATELINK_OPENTOFU_DIR}" apply -input=false "$PROFILE_ROOT/supabase-privatelink-opentofu.tfplan"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/supabase-privatelink" tofu -chdir="${SUPABASE_PRIVATELINK_OPENTOFU_DIR}" output -json > "$PROFILE_ROOT/supabase-privatelink-opentofu-apply.out.json"`,
    requireEvidenceFile(
      SUPABASE_PRIVATELINK_IAC_PATHS.apply,
      "write reviewed typed OpenTofu apply evidence after reviewing supabase-privatelink-opentofu-apply.out.json",
    ),
  ].join("; ");
}

function workspaceCommand(): string {
  return [
    `SUPABASE_PRIVATELINK_TOFU_WORKSPACE="${"${SUPABASE_PRIVATELINK_TOFU_WORKSPACE:-deployment-control-plane}"}"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/supabase-privatelink" tofu -chdir="${SUPABASE_PRIVATELINK_OPENTOFU_DIR}" workspace select "$SUPABASE_PRIVATELINK_TOFU_WORKSPACE" || TF_DATA_DIR="$PROFILE_ROOT/.tofu/supabase-privatelink" tofu -chdir="${SUPABASE_PRIVATELINK_OPENTOFU_DIR}" workspace new "$SUPABASE_PRIVATELINK_TOFU_WORKSPACE"`,
  ].join("; ");
}

function readOnlyEvidenceCommand(prelude: string): string {
  return [
    prelude,
    `test -f "${SUPABASE_PRIVATELINK_IAC_PATHS.apply}"`,
    `AWS_REGION="$(node -e 'const fs=require("fs"); const t=JSON.parse(fs.readFileSync(process.env.PROFILE_ROOT + "/aws-topology-evidence.json","utf8")); process.stdout.write(t.region || "")')"`,
    `PRIVATELINK_ENDPOINT_ID="$(node -e 'const fs=require("fs"); const t=JSON.parse(fs.readFileSync(process.env.PROFILE_ROOT + "/aws-topology-evidence.json","utf8")); process.stdout.write((((t.database||{}).privatelink||{}).endpointId) || "")')"`,
    `PRIVATELINK_ASSOCIATION_ID="$(node -e 'const fs=require("fs"); const t=JSON.parse(fs.readFileSync(process.env.PROFILE_ROOT + "/aws-topology-evidence.json","utf8")); process.stdout.write((((t.database||{}).privatelink||{}).serviceNetworkAssociationId) || "")')"`,
    `PRIVATELINK_HOSTNAME="$(node -e 'const fs=require("fs"); const t=JSON.parse(fs.readFileSync(process.env.PROFILE_ROOT + "/aws-topology-evidence.json","utf8")); process.stdout.write(((((t.database||{}).privatelink||{}).privateDns||{}).hostname) || "")')"`,
    `aws ram get-resource-shares --resource-owner OTHER-ACCOUNTS --region "$AWS_REGION" > "$PROFILE_ROOT/supabase-privatelink-readonly-ram.json"`,
    `if [ -n "$PRIVATELINK_ENDPOINT_ID" ]; then aws ec2 describe-vpc-endpoints --vpc-endpoint-ids "$PRIVATELINK_ENDPOINT_ID" --region "$AWS_REGION" > "$PROFILE_ROOT/supabase-privatelink-readonly-lattice.json"; fi`,
    `if [ -n "$PRIVATELINK_ASSOCIATION_ID" ]; then aws vpc-lattice get-service-network-resource-association --service-network-resource-association-identifier "$PRIVATELINK_ASSOCIATION_ID" --region "$AWS_REGION" > "$PROFILE_ROOT/supabase-privatelink-readonly-lattice.json"; fi`,
    `aws ec2 describe-security-group-rules --region "$AWS_REGION" > "$PROFILE_ROOT/supabase-privatelink-readonly-security-groups.json"`,
    `getent hosts "$PRIVATELINK_HOSTNAME" > "$PROFILE_ROOT/supabase-privatelink-readonly-private-dns.txt"`,
    `node "$PROFILE_ROOT/${PRIVATELINK_PSQL_PROOF_HELPER}" "/run/deployment-control-plane/credentials/control-plane-database-url" "$PROFILE_ROOT/supabase-privatelink-readonly-psql.json"`,
    requireEvidenceFile(
      SUPABASE_PRIVATELINK_IAC_PATHS.readOnly,
      "write typed read-only evidence after reviewing AWS read-only and psql outputs",
    ),
  ].join("; ");
}

function requireEvidenceFile(file: string, message: string): string {
  return `test -f "${file}" || { echo ${shellQuote(message)} >&2; exit 2; }`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
