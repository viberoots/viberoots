import { buildSupabaseManagedPostgresEvidence } from "../../deployments/control-plane-supabase-postgres-evidence";
import { reviewedSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-profile";

export function providerPayloadFor(id: string) {
  if (id === "aws-network-foundation") {
    return {
      providerPayload: {
        schemaVersion: "aws-foundation-hook-payload@1",
        ingressLifecycle: {
          schemaVersion: "aws-ingress-lifecycle-evidence@1",
          operation: {
            evidencePayload: { schemaVersion: "aws-ingress-hook-inspection@1" },
          },
        },
      },
    };
  }
  if (id === "supabase-privatelink-prerequisite") {
    return {
      providerPayload: {
        schemaVersion: "supabase-privatelink-provider-payload@1",
        evidenceMode: "evidence-only",
        supportMediated: true,
        supportEvidenceRef: "privatelink-request",
        ramPermissionEvidenceRef: "ram-acceptance-permission",
        latticePermissionEvidenceRef: "vpc-lattice-association-permission",
        privateDnsEvidenceRef: "private-dns-proof",
      },
    };
  }
  if (id === "supabase-managed-postgres") return supabasePayload();
  if (id !== "cloudflare-edge" && id !== "vercel-operator-ui") return {};
  return {
    providerPayload: {
      schemaVersion: "edge-ingress-provider-payload@1",
      hostname: "deploy.example.test",
      callbackHost: "deploy-auth.example.test",
      callbackPath: "/oidc/callback",
      originLoadBalancerArn:
        "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/cp/1",
    },
  };
}

function supabasePayload() {
  return {
    providerPayload: {
      schemaVersion: "supabase-managed-postgres-provider-payload@1",
      evidenceMode: "evidence-only",
      automatedProvisioningSuccess: false,
      mutationAuthority: false,
      expectedProfileIdentity: {
        organizationId: "org-control-plane-prod",
        projectRef: "project-review",
        region: "us-east-1",
        mode: "privatelink",
      },
      lifecycleEvidence: buildSupabaseManagedPostgresEvidence(
        reviewedSupabaseManagedPostgresProfile({
          instanceId: "cloud-control-plane",
          region: "us-east-1",
          mode: "privatelink",
          organizationId: "org-control-plane-prod",
          projectRef: "project-review",
        }),
      ),
    },
  };
}
