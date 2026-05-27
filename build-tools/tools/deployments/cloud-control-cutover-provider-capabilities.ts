import type { CutoverEvidence } from "./cloud-control-cutover-types";
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
): string[] {
  const capabilities = evidence.providerCapabilities || {};
  return selected.flatMap((id) => {
    const capability = capabilities[id];
    if (!capability) return [`${id}: missing provider-capability`];
    return validateCapability(id, capability);
  });
}

function validateCapability(id: string, capability: Record<string, unknown>): string[] {
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
      allowedPhases: ["smoke"],
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
  if (!capability.smokeEvidence) errors.push(`${id}: missing smoke evidence`);
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
