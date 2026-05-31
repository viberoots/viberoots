import type { RunbookCommand } from "./cloud-control-runbook";
import { setupAwsTopology } from "./cloud-control-setup-aws-topology";
import type { CloudControlSetupInput } from "./cloud-control-setup-types";

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
