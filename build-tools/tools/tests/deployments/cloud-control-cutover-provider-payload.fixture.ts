import { buildSupabaseManagedPostgresEvidence } from "../../deployments/control-plane-supabase-postgres-evidence";
import { reviewedSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-profile";
import { freshCheckedAt, IMAGE_DIGEST, IMAGE_REF } from "./cloud-control-aws-topology.fixture";
import { privateLinkIacEvidence } from "./cloud-control-supabase-privatelink.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";

export function providerPayloadFor(id: string) {
  if (id === "aws-ec2-control-plane-host") return awsEc2Payload();
  if (id === "aws-ecr-control-plane-registry") return awsEcrPayload();
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
  if (id === "aws-attic-cache-service") return atticPayload();
  if (id === "cloudflare-edge") return cloudflarePayload();
  if (id === "vercel-operator-ui") return vercelPayload();
  if (id === "remote-build-worker-fleet") return fleetPayload();
  return {};
}

function awsEcrPayload() {
  return {
    providerPayload: {
      schemaVersion: "aws-ecr-control-plane-registry-hook-payload@1",
      registryProfile: ecrRegistryProfileForImage(IMAGE_REF, IMAGE_DIGEST),
    },
  };
}

function supabasePrivateLinkPayload() {
  return {
    providerPayload: {
      schemaVersion: "supabase-privatelink-provider-payload@1",
      evidenceMode: "iac-reviewed",
      supportMediated: true,
      supportEvidenceRef: "privatelink-request",
      expected: {
        accountId: "123456789012",
        region: "us-east-1",
        ramShareArn: "arn:aws:ram:us-east-1:123456789012:resource-share/share-123",
        resourceConfigurationArn:
          "arn:aws:vpc-lattice:us-east-1:123456789012:resourceconfiguration/rcfg-123",
        endpointId: "vpce-privatelink123",
      },
      iac: {
        orchestration: "reviewed-opentofu-artifacts",
        ownership: "opentofu-managed-or-reviewed-import",
        ...privateLinkIacEvidence(),
      },
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

function cloudflarePayload() {
  return {
    providerPayload: {
      ...remainingCommon("cloudflare-edge", "cloudflare-edge-evidence@1"),
      ownership: {
        boundary: "provider-owned-reviewed",
        reviewedReference: "iac://cloudflare-edge",
        allowsDirectMutation: false,
        mutationCommands: [],
      },
      cloudflare: { accountId: "cf-account", zoneId: "zone-1", zoneName: "example.test" },
      dns: { recordName: "deploy.example.test", target: "alb.example.test", proxied: true },
      tls: { mode: "full-strict", certificateStatus: "active" },
      waf: { selected: true, rulesetStatus: "active", rateLimitStatus: "active" },
      binding: edgeBinding(),
    },
  };
}

function vercelPayload() {
  return {
    providerPayload: {
      ...remainingCommon("vercel-operator-ui", "vercel-operator-ui-evidence@1"),
      vercel: {
        teamId: "team-1",
        projectId: "operator-ui",
        deploymentId: "dpl_1",
        environment: "production",
      },
      domain: { productionAlias: "deploy.example.test", bound: true },
      config: { provenance: "reviewed-env-digest", digest: "sha256:config" },
      posture: { readOnly: true, uiApiOnly: true },
      binding: edgeBinding(),
    },
  };
}

function atticPayload() {
  return {
    providerPayload: {
      ...remainingCommon("aws-attic-cache-service", "aws-attic-cache-service-evidence@1"),
      aws: { accountId: "123456789012", region: "us-east-1" },
      endpoint: { identity: "attic-prod-cache", url: "https://attic.example.test" },
      health: { atticdReady: true },
      cacheObject: { put: true, get: true, metadata: true, digestVerified: true },
      tokenScope: { cacheScoped: true, leastPrivilege: true },
    },
  };
}

function fleetPayload() {
  return {
    providerPayload: {
      ...remainingCommon("remote-build-worker-fleet", "remote-build-worker-fleet-evidence@1"),
      aws: { accountId: "123456789012", region: "us-east-1" },
      fleet: { fleetId: "linux-spot-builders" },
      authority: { buckSeparate: true, nixSeparate: true, notDeploymentScheduler: true },
      network: { allowedBoundary: "build-vpc-private-subnets" },
      scaling: { registrationProven: true, autoscalingPolicyReviewed: true },
      credentials: { protectedRuntimeCredentialsReused: false },
    },
  };
}

function remainingCommon(capabilityId: string, schemaVersion: string) {
  return {
    schemaVersion,
    capabilityId,
    checkedAt: freshCheckedAt(),
    ownership: {
      boundary: "reviewed-iac",
      reviewedReference: `iac://${capabilityId}`,
      allowsDirectMutation: false,
      mutationCommands: [],
    },
    smoke: { passed: true, heartbeat: true },
    rollback: { nonDestructive: true, previousTarget: "previous-reviewed-target" },
  };
}

function edgeBinding() {
  return {
    schemaVersion: "edge-ingress-provider-payload@1",
    hostname: "deploy.example.test",
    callbackHost: "deploy-auth.example.test",
    callbackPath: "/oidc/callback",
    originLoadBalancerArn:
      "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/cp/1",
  };
}
