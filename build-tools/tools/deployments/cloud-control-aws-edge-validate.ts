import {
  evidenceObject,
  evidenceText,
  freshEvidenceAt,
  isEvidenceObject,
} from "./cloud-control-evidence-helpers";
import { hostFromUrl } from "./cloud-control-aws-ingress-helpers";
import type { AwsTopologyValidationOptions } from "./cloud-control-aws-topology-runtime";

export function validateSelectedEdges(
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const edges = evidenceObject(evidenceObject(topology).selectedEdges);
  return [
    ...requireEdgeFields(
      edges.cloudflare,
      "Cloudflare",
      "cloudflare-edge",
      cloudflareFields,
      topology,
      options,
    ),
    ...requireEdgeFields(
      edges.vercel,
      "Vercel",
      "vercel-operator-ui",
      vercelFields,
      topology,
      options,
    ),
  ];
}

const cloudflareFields = [
  "dnsProxy",
  "tlsMode",
  "wafRules",
  "bypass",
  "publicReachability",
  "callbackRoute",
];
const vercelFields = ["project", "domain", "edgeSettings", "callbackRoute"];

function requireEdgeFields(
  value: unknown,
  label: string,
  capabilityId: string,
  fields: string[],
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  if (!value) return [];
  const edge = evidenceObject(value);
  const errors = requireFresh(edge, `${label} edge`, options);
  for (const name of fields) {
    const field = edge[name];
    if (!isEvidenceObject(field)) {
      errors.push(`${label} edge ${name} evidence must be structured reviewed evidence`);
      continue;
    }
    errors.push(...validateEdgeField(field, label, name, capabilityId, topology, options));
  }
  return errors;
}

function validateEdgeField(
  field: unknown,
  label: string,
  name: string,
  capabilityId: string,
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const errors = requireFresh(field, `${label} edge ${name}`, options);
  if (!evidenceText(field, "reviewedReference") || !evidenceText(field, "digest")) {
    errors.push(`${label} edge ${name} evidence missing reviewed reference or digest`);
  }
  if (!evidenceText(field, "owner") || !evidenceText(field, "capabilityId")) {
    errors.push(`${label} edge ${name} evidence missing provenance or capability id`);
  }
  if (evidenceText(field, "capabilityId") && evidenceText(field, "capabilityId") !== capabilityId) {
    errors.push(`${label} edge ${name} evidence attached to wrong capability`);
  }
  errors.push(...validateEdgeIdentity(field, label, name, topology, options));
  return errors;
}

function validateEdgeIdentity(
  field: unknown,
  label: string,
  name: string,
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const ingress = evidenceObject(evidenceObject(topology).ingress);
  const expectedHost = hostFromUrl(options.expectedPublicUrl || evidenceText(ingress, "publicUrl"));
  const expectedCallbackHost =
    options.expectedAuthCallbackHost || evidenceText(ingress, "callbackHost");
  const expectedCallbackPath =
    options.expectedAuthCallbackPath || evidenceText(ingress, "authCallbackPath");
  const expectedOrigin = evidenceText(evidenceObject(ingress.loadBalancer), "arn");
  const errors: string[] = [];
  if (evidenceText(field, "hostname") !== expectedHost)
    errors.push(`${label} edge ${name} hostname does not match selected public hostname`);
  if (evidenceText(field, "callbackHost") !== expectedCallbackHost)
    errors.push(`${label} edge ${name} callback host does not match selected auth callback host`);
  if (evidenceText(field, "callbackPath") !== expectedCallbackPath)
    errors.push(`${label} edge ${name} callback path does not match selected auth callback path`);
  if (evidenceText(field, "originLoadBalancerArn") !== expectedOrigin)
    errors.push(`${label} edge ${name} origin does not match selected AWS ingress`);
  return errors;
}

function requireFresh(
  value: unknown,
  label: string,
  options: AwsTopologyValidationOptions,
): string[] {
  return freshEvidenceAt(value, options) ? [] : [`${label} evidence is missing or stale`];
}
