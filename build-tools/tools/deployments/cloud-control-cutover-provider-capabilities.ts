import type { CutoverEvidence } from "./cloud-control-cutover-types";
import { evidenceObject, evidenceText } from "./cloud-control-evidence-helpers";
import type { ProviderCapabilityDeclaration } from "./cloud-control-setup-types";
import { validateProviderCapabilityDeclaration } from "./cloud-control-setup-validate";
import {
  hookEvidenceRefs,
  validateProviderCapabilityHookEvidenceShape,
} from "./cloud-control-provider-capability-hook-contract";

const INVALID_SOURCE = /\b(dashboard-only|raw-iac-only|manual-notes?)\b/i;

export function validateCutoverProviderCapabilities(
  evidence: CutoverEvidence,
  selected: string[],
  maxAgeMinutes = 60,
): string[] {
  const capabilities = evidence.providerCapabilities || {};
  return selected.flatMap((id) => {
    const capability = capabilities[id];
    if (!capability) return [`${id}: missing provider-capability`];
    return validateCapability(id, capability, evidence, maxAgeMinutes);
  });
}

function validateCapability(
  id: string,
  capability: Record<string, unknown>,
  evidence: CutoverEvidence,
  maxAgeMinutes = 60,
): string[] {
  const errors: string[] = [];
  const source = String(capability.source || "");
  const declaration = providerDeclaration(capability.declaration);
  if (INVALID_SOURCE.test(source)) {
    errors.push(
      `${id}: raw dashboard or IaC state, or manual notes, is not control-plane audit evidence`,
    );
  }
  errors.push(
    ...validateProviderCapabilityHookEvidenceShape(id, capability, {
      allowedPhases: id === "supabase-managed-postgres" ? ["smoke", "evidence"] : ["smoke"],
      maxAgeMinutes,
      expectedAwsTopology: evidence.awsTopology,
      expectedSupabasePostgresProfile: evidence.supabasePostgresProfile,
    }),
  );
  if (!declaration) {
    errors.push(`${id}: missing concrete provider-capability declaration evidence`);
  } else {
    if (declaration.id !== id) {
      errors.push(`${id}: concrete declaration belongs to unrelated capability ${declaration.id}`);
    }
    errors.push(...validateProviderCapabilityDeclaration(declaration));
    errors.push(...validateEvidenceContract(id, declaration, hookEvidenceRefs(capability)));
  }
  if (!capability.auditIdentity) errors.push(`${id}: missing provider-capability audit identity`);
  if (!capability.rollbackProcedure) errors.push(`${id}: missing rollback procedure evidence`);
  if (!capability.smokeEvidence && capability.phase !== "evidence") {
    errors.push(`${id}: missing smoke evidence`);
  }
  errors.push(...validateIngressProviderPayload(id, capability.providerPayload, evidence));
  return errors;
}

function validateEvidenceContract(
  id: string,
  declaration: ProviderCapabilityDeclaration,
  refs: string[],
): string[] {
  if (!Array.isArray(declaration.auditEvidence)) {
    return [`${id}: missing provider-capability audit evidence contract`];
  }
  if (refs.length === 0) return [`${id}: missing provider-capability audit evidence contract`];
  return declaration.auditEvidence.flatMap((required) =>
    refs.includes(required) ? [] : [`${id}: missing evidence "${required}"`],
  );
}

function providerDeclaration(value: unknown): ProviderCapabilityDeclaration | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as ProviderCapabilityDeclaration;
}

const INGRESS_PAYLOAD_CAPABILITIES = new Set([
  "aws-network-foundation",
  "cloudflare-edge",
  "vercel-operator-ui",
]);

function validateIngressProviderPayload(
  id: string,
  value: unknown,
  evidence: CutoverEvidence,
): string[] {
  if (!INGRESS_PAYLOAD_CAPABILITIES.has(id)) return [];
  const payload = evidenceObject(value);
  if (Object.keys(payload).length === 0)
    return [`${id}: missing reviewed ingress provider payload`];
  if (id === "aws-network-foundation") return validateAwsNetworkPayload(id, payload);
  return validateEdgePayload(id, payload, evidence);
}

function validateAwsNetworkPayload(id: string, payload: Record<string, unknown>): string[] {
  const lifecycle = evidenceObject(payload.ingressLifecycle);
  const operation = evidenceObject(lifecycle.operation);
  const inspected = evidenceObject(operation.evidencePayload);
  const errors: string[] = [];
  if (evidenceText(lifecycle, "schemaVersion") !== "aws-ingress-lifecycle-evidence@1") {
    errors.push(`${id}: missing AWS ingress lifecycle provider payload`);
  }
  if (evidenceText(inspected, "schemaVersion") !== "aws-ingress-hook-inspection@1") {
    errors.push(`${id}: missing structured AWS ingress inspection payload`);
  }
  return errors;
}

function validateEdgePayload(
  id: string,
  payload: Record<string, unknown>,
  evidence: CutoverEvidence,
): string[] {
  const errors: string[] = [];
  const ingress = evidenceObject(evidence.awsTopology?.ingress);
  const expectedHost = hostFromUrl(String(evidence.runtimeConfig?.publicUrl || ""));
  const callback = (evidence.runtimeConfig?.authProvider as any)?.callback || {};
  if (evidenceText(payload, "schemaVersion") !== "edge-ingress-provider-payload@1") {
    errors.push(`${id}: missing structured edge ingress provider payload`);
  }
  if (evidenceText(payload, "hostname") !== expectedHost) {
    errors.push(`${id}: edge provider payload hostname does not match runtime publicUrl`);
  }
  if (evidenceText(payload, "callbackHost") !== String(callback.externalHost || "")) {
    errors.push(`${id}: edge provider payload callback host does not match runtime config`);
  }
  if (evidenceText(payload, "callbackPath") !== String(callback.externalPath || "")) {
    errors.push(`${id}: edge provider payload callback path does not match runtime config`);
  }
  if (
    evidenceText(payload, "originLoadBalancerArn") !==
    evidenceText(evidenceObject(ingress.loadBalancer), "arn")
  ) {
    errors.push(`${id}: edge provider payload origin does not match selected AWS ingress`);
  }
  return errors;
}

function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}
