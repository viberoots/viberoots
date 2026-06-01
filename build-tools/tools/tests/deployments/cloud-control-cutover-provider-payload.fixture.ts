import { buildSupabaseManagedPostgresEvidence } from "../../deployments/control-plane-supabase-postgres-evidence";
import { reviewedSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-profile";
import { privateLinkEndpointEvidence } from "./cloud-control-supabase-privatelink.fixture";

export function providerPayloadFor(id: string) {
  if (id === "aws-ec2-control-plane-host") return awsEc2Payload();
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
  if (id === "supabase-privatelink-prerequisite") return supabasePrivateLinkPayload();
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

function supabasePrivateLinkPayload() {
  const evidence = privateLinkEndpointEvidence();
  return {
    providerPayload: {
      schemaVersion: "supabase-privatelink-provider-payload@1",
      evidenceMode: "aws-side-automated",
      supportMediated: true,
      supportEvidenceRef: "privatelink-request",
      awsApiInputsPresent: true,
      expected: {
        accountId: "123456789012",
        region: "us-east-1",
        ramShareArn: evidence.ramShareArn,
        resourceConfigurationArn: evidence.resourceConfigurationArn,
        endpointId: evidence.endpointId,
      },
      ram: {
        ramShareArn: evidence.ramShareArn,
        ramShareStatus: evidence.ramShareStatus,
      },
      lattice: {
        resourceConfigurationArn: evidence.resourceConfigurationArn,
        endpointId: evidence.endpointId,
      },
      privateDns: evidence.privateDns,
      routeSecurityGroupPosture: {
        endpointSecurityGroupId: evidence.endpointSecurityGroupId,
        serviceSecurityGroupId: evidence.serviceSecurityGroupId,
        workerSecurityGroupId: evidence.workerSecurityGroupId,
        rule: evidence.securityGroupRuleProof,
      },
      psql: {
        checkedAt: evidence.psql.checkedAt,
        proofDigest: evidence.psqlProofDigest,
        success: evidence.psql.success,
        vpcId: evidence.psql.vpcId,
      },
      mutationOutcomes: [{ action: "ram-share-acceptance", status: "accepted" }],
    },
  };
}

function awsEc2Payload() {
  return {
    providerPayload: {
      schemaVersion: "aws-ec2-host-hook-payload@1",
      capabilityId: "aws-ec2-control-plane-host",
      phase: "smoke",
      provisioningBoundary: "non-mutating-structured-ec2-host-adapter",
      hostProfile: "aws-ec2",
      mutationAuthority: false,
      identity: {
        accountId: "123456789012",
        region: "us-east-1",
        computeMode: "ec2-instance",
        instanceId: "i-0abc1234",
        launchTemplateId: "lt-123",
        launchTemplateVersion: "7",
        amiId: "ami-123",
        amiPinPath: "sha256:nixos-ami-import",
        instanceType: "m7i.large",
        instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/control-plane",
        privateSubnetIds: ["subnet-123", "subnet-456"],
        securityGroupIds: ["sg-service", "sg-worker"],
        bootstrapDigest: "sha256:user",
        containerRuntime: "podman-systemd",
        credentialMountMode: "bind-mounted-credential-directory",
      },
      generatedProfile: {
        credentialMountMode: "bind-mounted-credential-directory",
        compute: {
          amiId: "ami-123",
          amiPinPath: "sha256:nixos-ami-import",
          instanceId: "i-0abc1234",
          launchTemplateId: "lt-123",
          launchTemplateVersion: "7",
          selectedSubnetIds: ["subnet-123", "subnet-456"],
          securityGroupIds: ["sg-service", "sg-worker"],
          instanceType: "m7i.large",
          instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/control-plane",
          bootstrapDigest: "sha256:user",
          containerRuntime: "podman-systemd",
        },
        network: {
          subnetIds: ["subnet-123", "subnet-456"],
          securityGroupIds: ["sg-service", "sg-worker"],
        },
      },
      operation: { executed: false, mutationAuthority: false, outputDigest: "sha256:ec2" },
      smokeEvidence: true,
      rollback: { nonDestructive: true, proofRefs: ["worker-shutdown-proof"] },
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
