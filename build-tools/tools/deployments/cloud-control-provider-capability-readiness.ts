import { REQUIRED_CAPABILITY_FIELDS } from "./cloud-control-setup-contract";
import type {
  CloudControlSetupInput,
  ProviderCapabilityDeclaration,
} from "./cloud-control-setup-types";
import {
  hookEvidenceDeclaration,
  hookEvidenceRefs,
  providerCapabilityHookEvidenceRecord,
  validateProviderCapabilityHookEvidenceShape,
} from "./cloud-control-provider-capability-hook-contract";
import { validateProviderCapabilityDeclaration } from "./cloud-control-setup-validate";

const INVALID_EVIDENCE_SOURCE = /\b(dashboard-only|raw-iac-only|manual-notes?)\b/i;

type ProviderCapabilityEvidenceOptions = {
  awsTopology?: CloudControlSetupInput["awsTopology"];
  supabasePostgresProfile?: CloudControlSetupInput["supabasePostgres"];
};

export function validateProviderCapabilityEvidence(
  declarations: ProviderCapabilityDeclaration[],
  evidenceByCapability: Record<string, unknown>,
  opts: ProviderCapabilityEvidenceOptions = {},
): string[] {
  const errors: string[] = [];
  for (const declaration of declarations) {
    errors.push(...validateProviderCapabilityDeclaration(declaration));
    const evidence = providerCapabilityHookEvidenceRecord(evidenceByCapability[declaration.id]);
    if (!evidence) {
      errors.push(`${declaration.id}: protected/shared readiness requires hook evidence`);
      continue;
    }
    errors.push(...hookShapeErrors(declaration.id, evidence, opts));
    const evidenceDeclaration = hookEvidenceDeclaration(evidence);
    if (!evidenceDeclaration) {
      errors.push(`${declaration.id}: missing hook declaration evidence`);
    } else if (!matchesConcreteCapability(evidenceDeclaration, declaration)) {
      errors.push(`${declaration.id}: hook declaration does not match selected capability`);
    }
    errors.push(...auditRefErrors(declaration, hookEvidenceRefs(evidence)));
  }
  return errors;
}

function hookShapeErrors(
  id: string,
  evidence: Record<string, unknown>,
  opts: ProviderCapabilityEvidenceOptions,
) {
  return validateProviderCapabilityHookEvidenceShape(id, evidence, {
    allowedPhases: ["evidence"],
    expectedAwsTopology: opts.awsTopology,
    expectedSupabasePostgresProfile: opts.supabasePostgresProfile,
  });
}

function auditRefErrors(declaration: ProviderCapabilityDeclaration, refs: string[]): string[] {
  if (refs.length === 0) {
    return [`${declaration.id}: protected/shared readiness requires hook audit evidence`];
  }
  const invalid = refs.find((item) => INVALID_EVIDENCE_SOURCE.test(item));
  return [
    ...(invalid ? [`${declaration.id}: ${invalid} is not control-plane audit evidence`] : []),
    ...declaration.auditEvidence.flatMap((required) =>
      refs.includes(required) ? [] : [`${declaration.id}: missing evidence "${required}"`],
    ),
  ];
}

function matchesConcreteCapability(
  declaration: ProviderCapabilityDeclaration,
  concrete: ProviderCapabilityDeclaration,
): boolean {
  const fields = ["id", ...REQUIRED_CAPABILITY_FIELDS] as const;
  const iacFields = Object.keys(concrete.iac) as Array<keyof ProviderCapabilityDeclaration["iac"]>;
  return (
    fields.every(
      (field) => JSON.stringify(declaration[field]) === JSON.stringify(concrete[field]),
    ) &&
    iacFields.every(
      (field) =>
        normalizeProviderCommand(declaration.iac?.[field] || "") ===
        normalizeProviderCommand(concrete.iac[field]),
    )
  );
}

function normalizeProviderCommand(command: string): string {
  return command.replace(
    /^deployment-control-plane provider-capability --deployment-id (?:<label>|'[^']+'|[^\s]+)/,
    "deployment-control-plane provider-capability --deployment-id <label>",
  );
}
