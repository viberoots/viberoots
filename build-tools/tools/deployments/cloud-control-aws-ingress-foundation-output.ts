import { evidenceObject, evidenceText } from "./cloud-control-evidence-helpers";
import type { AwsIngressEvidence } from "./cloud-control-aws-ingress-types";

export function ingressEvidenceFromFoundationOutput(
  value: unknown,
): AwsIngressEvidence | undefined {
  const ingress = evidenceObject(value);
  const topology = evidenceObject(ingress.topologyEvidence || ingress.topology_evidence);
  if (Object.keys(topology).length === 0) return undefined;
  if (!evidenceText(topology.targetHealthEvidence, "status")) return undefined;
  if (!evidenceText(topology.targetRegistration, "instanceId")) return undefined;
  return topology as AwsIngressEvidence;
}
