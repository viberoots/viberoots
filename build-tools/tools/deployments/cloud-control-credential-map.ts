import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { setupArtifactCredentialMode } from "./cloud-control-setup-aws-topology";
import type { DeploymentInfisicalSelector } from "./deployment-secret-infisical-selectors";
import type { InfisicalLeastPrivilegeScope } from "./control-plane-credential-staging-types";

export const CREDENTIAL_MAP_SCHEMA = "cloud-control-credential-map@1";
export { validateCredentialMap } from "./cloud-control-credential-map-validation";

type CredentialSource =
  | {
      kind: "secret-backend-ref";
      backend: "infisical";
      ref: string;
      evidenceRef: string;
      scopeEvidenceRef: string;
    }
  | {
      kind: "host-credential-source";
      source: "aws-instance-profile";
      evidenceRef: string;
      hostSourceRef: string;
    }
  | {
      kind: "generated-secret-write-plan";
      backend: "infisical";
      selector: DeploymentInfisicalSelector;
      secretName: string;
      evidenceRef: string;
      writePlanRef: string;
      policyEvidenceRef: string;
      deploymentIdentityEvidenceRef: string;
      leastPrivilegeScopeEvidenceRef: string;
      leastPrivilegeScope: InfisicalLeastPrivilegeScope;
    };

export type CredentialMapEntry = {
  file: string;
  source: CredentialSource;
  rotation: {
    strategy: "import-refresh" | "regenerate-write-plan";
    staleAfterDays: number;
    staleDetectionEvidenceRef: string;
  };
};

export type CredentialMap = {
  schemaVersion: typeof CREDENTIAL_MAP_SCHEMA;
  credentialDirectory: string;
  hostMountWiring: {
    mode: "bind-mounted-credential-directory";
    evidence: string;
  };
  infisical: {
    projectEnvironmentEvidenceRef: string;
    universalAuthMachineIdentityEvidenceRef: string;
    leastPrivilegeScopeEvidenceRef: string;
    requiredSecretNamePlanRef: string;
  };
  databaseUrl: { supabaseProjectRef: string; connectionMode: string; hostnameEvidenceRef: string };
  reviewedSource: { mode: string; evidenceRef: string };
  entries: CredentialMapEntry[];
};

export function renderCredentialMap(
  input: CloudControlSetupInput,
  requiredFiles: string[],
): string {
  return `${JSON.stringify(credentialMap(input, requiredFiles), null, 2)}\n`;
}

export function credentialMap(
  input: CloudControlSetupInput,
  requiredFiles: string[],
): CredentialMap {
  const supabase = input.supabasePostgres;
  return {
    schemaVersion: CREDENTIAL_MAP_SCHEMA,
    credentialDirectory: "/run/deployment-control-plane/credentials",
    hostMountWiring: {
      mode: "bind-mounted-credential-directory",
      evidence:
        "systemd units mount /run/deployment-control-plane/credentials read-only into containers",
    },
    infisical: {
      projectEnvironmentEvidenceRef: "evidence://infisical/project-environment-import",
      universalAuthMachineIdentityEvidenceRef:
        "evidence://infisical/universal-auth-machine-identity",
      leastPrivilegeScopeEvidenceRef: "evidence://infisical/least-privilege-secret-paths",
      requiredSecretNamePlanRef: "evidence://infisical/required-secret-name-write-plan",
    },
    databaseUrl: {
      supabaseProjectRef: supabase?.provisioning.projectRef || "unavailable",
      connectionMode: supabase?.connection.mode || "public",
      hostnameEvidenceRef: `evidence://supabase/database-url-hostname/${supabase?.connection.mode || "public"}`,
    },
    reviewedSource: {
      mode: input.reviewedSourceMode,
      evidenceRef:
        input.reviewedSourceMode === "github-app"
          ? "evidence://reviewed-source/github-app-import"
          : "evidence://reviewed-source/ssh-deploy-key-known-hosts",
    },
    entries: requiredFiles.map((file) => credentialEntry(input, file)),
  };
}

function credentialEntry(input: CloudControlSetupInput, file: string): CredentialMapEntry {
  if (file === "control-plane-token") {
    return {
      file,
      source: {
        kind: "generated-secret-write-plan",
        backend: "infisical",
        selector: generatedSecretSelector(input, "control-plane-token"),
        secretName: "control-plane-token",
        evidenceRef: "evidence://secret-backend/control-plane-token-write-plan",
        writePlanRef: "evidence://secret-backend/control-plane-token-name-policy",
        policyEvidenceRef: "evidence://secret-backend/control-plane-token-access-policy",
        deploymentIdentityEvidenceRef: "evidence://infisical/universal-auth-machine-identity",
        leastPrivilegeScopeEvidenceRef: "evidence://infisical/least-privilege-secret-paths",
        leastPrivilegeScope: generatedSecretScope(input, "control-plane-token"),
      },
      rotation: rotation("regenerate-write-plan", file),
    };
  }
  if (
    file === "artifact-store-endpoint" &&
    setupArtifactCredentialMode(input) === "aws-instance-profile"
  ) {
    return secretRef(file, "evidence://artifact/aws-s3-endpoint-import");
  }
  if (
    file.startsWith("artifact-store-") &&
    setupArtifactCredentialMode(input) === "aws-instance-profile"
  ) {
    return hostSource(file);
  }
  if (file === "control-plane-database-url") {
    return secretRef(file, "evidence://supabase/database-url-import");
  }
  if (file.startsWith("reviewed-source-github-app-")) {
    return secretRef(file, "evidence://reviewed-source/github-app-import");
  }
  if (file.startsWith("reviewed-source-")) {
    return secretRef(file, "evidence://reviewed-source/ssh-deploy-key-known-hosts");
  }
  if (file.includes("infisical-client-")) {
    return secretRef(file, "evidence://infisical/universal-auth-import");
  }
  return secretRef(file, `evidence://secret-backend/${file}`);
}

function generatedSecretScope(
  input: CloudControlSetupInput,
  secretName: string,
): InfisicalLeastPrivilegeScope {
  const selector = generatedSecretSelector(input, secretName);
  return {
    projectId: selector.projectId,
    environment: selector.environment,
    secretPath: selector.secretPath,
    allowedSecretNames: [selector.secretName],
    permissions: ["create", "read", "update"],
  };
}

function generatedSecretSelector(
  input: CloudControlSetupInput,
  secretName: string,
): DeploymentInfisicalSelector {
  const runtime = input.runtimeInput?.infisicalDeployments[0];
  return {
    projectId: runtime?.projectId || "unavailable",
    environment: runtime?.environment || "production",
    secretPath: "/deployment-control-plane/generated",
    secretName,
  };
}

function secretRef(file: string, evidenceRef: string): CredentialMapEntry {
  return {
    file,
    source: {
      kind: "secret-backend-ref",
      backend: "infisical",
      ref: `/deployment-control-plane/${file}`,
      evidenceRef,
      scopeEvidenceRef: "evidence://infisical/least-privilege-secret-paths",
    },
    rotation: rotation("import-refresh", file),
  };
}

function hostSource(file: string): CredentialMapEntry {
  return {
    file,
    source: {
      kind: "host-credential-source",
      source: "aws-instance-profile",
      evidenceRef: "evidence://aws/instance-profile-artifact-iam",
      hostSourceRef: "aws-imdsv2-instance-profile",
    },
    rotation: rotation("import-refresh", file, 1),
  };
}

function rotation(
  strategy: CredentialMapEntry["rotation"]["strategy"],
  file: string,
  staleAfterDays = 90,
): CredentialMapEntry["rotation"] {
  return {
    strategy,
    staleAfterDays,
    staleDetectionEvidenceRef: `evidence://credential-rotation/stale-detection/${file}`,
  };
}
