import { evidenceObject, evidenceText } from "./cloud-control-evidence-helpers";

export function cloudflareProviderIdentityErrors(
  id: string,
  payload: Record<string, unknown>,
  topology: unknown,
): string[] {
  const selected = selectedIdentity(topology, "cloudflare");
  const errors = requireSelectedIdentity(id, selected, ["accountId", "zoneId", "hostname"]);
  compareText(errors, id, payload.cloudflare, selected, "accountId", "Cloudflare account");
  compareText(errors, id, payload.cloudflare, selected, "zoneId", "Cloudflare zone");
  compareText(errors, id, payload.binding, selected, "hostname", "Cloudflare hostname");
  return errors;
}

export function vercelProviderIdentityErrors(
  id: string,
  payload: Record<string, unknown>,
  topology: unknown,
): string[] {
  const selected = selectedIdentity(topology, "vercel");
  const errors = requireSelectedIdentity(id, selected, [
    "teamId",
    "projectId",
    "domain",
    "environment",
  ]);
  compareText(errors, id, payload.vercel, selected, "teamId", "Vercel team");
  compareText(errors, id, payload.vercel, selected, "projectId", "Vercel project");
  compareText(errors, id, payload.domain, selected, "productionAlias", "Vercel domain", "domain");
  compareText(errors, id, payload.vercel, selected, "environment", "Vercel environment");
  return errors;
}

function selectedIdentity(topology: unknown, provider: "cloudflare" | "vercel") {
  return evidenceObject(evidenceObject(evidenceObject(topology).selectedEdges)[provider]).identity;
}

function requireSelectedIdentity(id: string, selected: unknown, fields: string[]): string[] {
  const identity = evidenceObject(selected);
  const errors: string[] = [];
  for (const field of fields) {
    if (!evidenceText(identity, field)) errors.push(`${id}: missing selected ${field} evidence`);
  }
  return errors;
}

function compareText(
  errors: string[],
  id: string,
  actualValue: unknown,
  selected: unknown,
  actualField: string,
  label: string,
  selectedField = actualField,
): void {
  const expected = evidenceText(selected, selectedField);
  if (expected && evidenceText(actualValue, actualField) !== expected) {
    errors.push(`${id}: ${label} does not match selected evidence`);
  }
}
