import { targetLabelFromScript } from "./template-owned-tests";

export type DocumentationImpactDiagnostics = {
  mode: "documentation-contract" | "no-documentation-contract";
  changedPaths: string[];
  documentationPaths: string[];
  nonDocumentationPaths: string[];
  selectedTargets: string[];
  reason: string;
};

export type DocumentationImpactResult = {
  mode: DocumentationImpactDiagnostics["mode"];
  targets: string[];
  diagnostics: DocumentationImpactDiagnostics;
};

const DEPLOYMENT_DOC_CONTRACT_SCRIPTS = [
  "build-tools/tools/tests/deployments/deployment-auth-session.admin-identity-workflows.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-auth-session.auth-group-realm-wiring.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-auth-session.keycloak-claim-grant-mapping.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-auth-session.remote-admin-flow.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-auth-session.reviewed-remote-admin.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-control-plane.admission-reporter-boundary.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-control-plane.admission-requirement-discovery.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-control-plane.governance-verification.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-control-plane.reviewed-source-snapshotting.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-control-plane.separated-roles.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-docs.front-door-parity.test.ts",
  "build-tools/tools/tests/deployments/deployment-docs.infisical-bootstrap-contract.test.ts",
  "build-tools/tools/tests/deployments/deployment-docs.infisical-mini-parity.test.ts",
  "build-tools/tools/tests/deployments/deployment-infisical-final-guardrails.test.ts",
  "build-tools/tools/tests/deployments/deployment-preview-cleanup.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-secret-fixture-docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-service.hosted-token-enforcement.docs.test.ts",
  "build-tools/tools/tests/deployments/deployment-verify-scope.boundary.test.ts",
  "build-tools/tools/tests/deployments/nixos-shared-host.identity-provider.host-secret-boundary.nix-eval.test.ts",
  "build-tools/tools/tests/deployments/nixos-shared-host.operator-docs.contract.test.ts",
  "build-tools/tools/tests/deployments/phase0-deployments.contract.test.ts",
  "build-tools/tools/tests/deployments/sprinkleref-infisical-storage.test.ts",
] as const;

export const DEPLOYMENT_DOC_CONTRACT_TARGETS = DEPLOYMENT_DOC_CONTRACT_SCRIPTS.map((script) =>
  targetLabelFromScript(script),
);

function normalizeRepoPath(relPath: string): string {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

function toSortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

export function isDocumentationPath(relPath: string): boolean {
  const p = normalizeRepoPath(relPath);
  return p.endsWith(".md") || p.endsWith(".rst");
}

export function isReviewedDeploymentDocumentationPath(relPath: string): boolean {
  const p = normalizeRepoPath(relPath);
  if (!isDocumentationPath(p)) return false;
  return (
    p === "README.md" ||
    p === "infisical-bootstrap.md" ||
    p.startsWith("docs/deployment") ||
    p.startsWith("docs/deployments") ||
    p.startsWith("docs/infisical") ||
    p.startsWith("docs/nixos-shared-host") ||
    p.startsWith("docs/sprinkleref") ||
    p.startsWith("docs/secrets-usage.md") ||
    p.startsWith("docs/mini-deployment.md") ||
    p.startsWith("docs/cloud-control") ||
    p.startsWith("docs/control-plane") ||
    p.startsWith("projects/docs/phase_0_") ||
    p.startsWith("projects/deployments/") ||
    p.startsWith("build-tools/tools/deployments/")
  );
}

export function resolveDocumentationImpactSelection(
  changedPaths: string[],
  opts?: { deploymentDocContractTargets?: readonly string[] },
): DocumentationImpactResult {
  const normalizedChangedPaths = toSortedUnique(changedPaths.map(normalizeRepoPath));
  const documentationPaths = normalizedChangedPaths.filter(isDocumentationPath);
  const nonDocumentationPaths = normalizedChangedPaths.filter((p) => !isDocumentationPath(p));
  const deploymentDocPaths = documentationPaths.filter(isReviewedDeploymentDocumentationPath);
  const selectedTargets = toSortedUnique(
    opts?.deploymentDocContractTargets || DEPLOYMENT_DOC_CONTRACT_TARGETS,
  );

  if (
    documentationPaths.length > 0 &&
    nonDocumentationPaths.length === 0 &&
    deploymentDocPaths.length > 0 &&
    selectedTargets.length > 0
  ) {
    return {
      mode: "documentation-contract",
      targets: selectedTargets,
      diagnostics: {
        mode: "documentation-contract",
        changedPaths: normalizedChangedPaths,
        documentationPaths,
        nonDocumentationPaths,
        selectedTargets,
        reason: "reviewed-deployment-documentation-changed",
      },
    };
  }

  return {
    mode: "no-documentation-contract",
    targets: [],
    diagnostics: {
      mode: "no-documentation-contract",
      changedPaths: normalizedChangedPaths,
      documentationPaths,
      nonDocumentationPaths,
      selectedTargets: [],
      reason:
        documentationPaths.length === 0
          ? "no-documentation-paths"
          : nonDocumentationPaths.length > 0
            ? "mixed-documentation-and-code"
            : "no-reviewed-documentation-contract",
    },
  };
}
