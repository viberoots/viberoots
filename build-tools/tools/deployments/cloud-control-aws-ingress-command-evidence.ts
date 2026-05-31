import * as crypto from "node:crypto";
import {
  evidenceList,
  evidenceObject,
  evidenceText,
  freshEvidenceAt,
  isEvidenceObject,
} from "./cloud-control-evidence-helpers";
import type { AwsTopologyValidationOptions } from "./cloud-control-aws-topology-runtime";

const COLLECTORS = ["dns", "tls", "health", "callback"] as const;

export type IngressCommandEvidenceOptions = AwsTopologyValidationOptions & {
  required?: boolean;
};

export function validateIngressCommandEvidenceBundle(
  topology: unknown,
  value: unknown,
  options: IngressCommandEvidenceOptions,
): string[] {
  if (!options.required && value == null) return [];
  if (!isEvidenceObject(value)) return ["AWS ingress generated command evidence is missing"];
  return COLLECTORS.flatMap((collector) =>
    validateRecord(collector, commandRecord(value, collector), topology, options),
  );
}

function commandRecord(value: unknown, collector: string): Record<string, unknown> {
  const bundle = evidenceObject(value);
  return evidenceObject(
    bundle[collector] ||
      bundle[`ingress-${collector}`] ||
      bundle[`ingress-${collector}-evidence.json`],
  );
}

function validateRecord(
  collector: (typeof COLLECTORS)[number],
  record: Record<string, unknown>,
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const errors: string[] = [];
  if (!isEvidenceObject(record)) return [`AWS ingress ${collector} command evidence is missing`];
  if (evidenceText(record, "schemaVersion") !== "cloud-control-ingress-command-evidence@1") {
    errors.push(`AWS ingress ${collector} command evidence has unsupported schemaVersion`);
  }
  if (evidenceText(record, "source") !== "generated-runbook-command") {
    errors.push(`AWS ingress ${collector} command evidence must come from generated runbook`);
  }
  if (evidenceText(record, "collector") !== collector) {
    errors.push(`AWS ingress ${collector} command evidence collector does not match output`);
  }
  if (!freshEvidenceAt(record, options)) {
    errors.push(`AWS ingress ${collector} command evidence is missing or stale`);
  }
  for (const input of ["aws-topology-evidence.json", "config.yaml"]) {
    if (!evidenceList(record, "inputs").includes(input)) {
      errors.push(`AWS ingress ${collector} command evidence missing declared input ${input}`);
    }
  }
  const evidence = evidenceObject(record.evidence);
  if (!evidenceText(evidence, "proofDigest").startsWith("sha256:")) {
    errors.push(`AWS ingress ${collector} command evidence missing proof digest`);
  }
  errors.push(...collectorChecks(collector, evidence, topology));
  return errors;
}

function collectorChecks(
  collector: (typeof COLLECTORS)[number],
  evidence: Record<string, unknown>,
  topology: unknown,
): string[] {
  if (collector === "dns") return dnsChecks(evidence, topology);
  if (collector === "tls") return tlsChecks(evidence);
  if (collector === "health") return healthChecks(evidence, topology);
  return callbackChecks(evidence, topology);
}

function dnsChecks(evidence: Record<string, unknown>, topology: unknown): string[] {
  const ingress = evidenceObject(evidenceObject(topology).ingress);
  const errors: string[] = [];
  if (evidence.resolved !== true || evidence.resolvedTargetMatchesSelectedIngress !== true) {
    errors.push("AWS ingress DNS command evidence does not prove selected ingress resolution");
  }
  if (
    evidenceText(evidence, "selectedLoadBalancerDnsNameDigest") !==
    digestRef(ingress.loadBalancer, "dnsName")
  ) {
    errors.push("AWS ingress DNS command evidence is not tied to selected load balancer DNS name");
  }
  if (evidenceList(evidence, "publicResolution").length === 0) {
    errors.push("AWS ingress DNS command evidence missing public resolution");
  }
  if (evidenceList(evidence, "selectedIngressResolution").length === 0) {
    errors.push("AWS ingress DNS command evidence missing selected ingress resolution");
  }
  return errors;
}

function tlsChecks(evidence: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (evidence.handshake !== true || evidence.authorized !== true) {
    errors.push("AWS ingress TLS command evidence missing verified handshake");
  }
  if (!evidenceText(evidence, "notBefore") || !evidenceText(evidence, "notAfter")) {
    errors.push("AWS ingress TLS command evidence missing certificate validity window");
  }
  if (evidence.coverageMatchedPublicUrl !== true || evidence.coverageMatchedCallbackHost !== true) {
    errors.push("AWS ingress TLS command evidence does not cover public URL and callback host");
  }
  return errors;
}

function healthChecks(evidence: Record<string, unknown>, topology: unknown): string[] {
  const readiness = evidenceObject(evidence.readiness);
  const ingress = evidenceObject(evidenceObject(topology).ingress);
  const errors: string[] = [];
  if (readiness.ok !== true || evidence.targetHealthy !== true) {
    errors.push("AWS ingress health command evidence does not prove healthy target readiness");
  }
  if (evidence.targetRegistrationBound !== true) {
    errors.push("AWS ingress health command evidence is not bound to selected target registration");
  }
  if (evidenceText(evidence, "targetGroupArnDigest") !== digestRef(ingress, "targetGroupArn")) {
    errors.push("AWS ingress health command evidence target group does not match selected ingress");
  }
  return errors;
}

function callbackChecks(evidence: Record<string, unknown>, topology: unknown): string[] {
  const ingress = evidenceObject(evidenceObject(topology).ingress);
  const errors: string[] = [];
  if (evidence.routeMatchesSelectedTargetGroup !== true) {
    errors.push("AWS ingress callback command evidence does not prove selected target-group route");
  }
  if (Number(evidence.status) < 200 || Number(evidence.status) >= 400) {
    errors.push(
      "AWS ingress callback command evidence did not observe successful callback response",
    );
  }
  if (
    evidenceText(evidence, "observedTargetGroupArnDigest") !== digestRef(ingress, "targetGroupArn")
  ) {
    errors.push(
      "AWS ingress callback command evidence target group does not match selected ingress",
    );
  }
  if (evidenceText(evidence, "callbackHostDigest") !== digestRef(ingress.callbackRoute, "host")) {
    errors.push(
      "AWS ingress callback command evidence host does not match selected callback route",
    );
  }
  if (evidenceText(evidence, "callbackPath") !== evidenceText(ingress.callbackRoute, "path")) {
    errors.push(
      "AWS ingress callback command evidence path does not match selected callback route",
    );
  }
  return errors;
}

function digestRef(value: unknown, field: string): string {
  const text = evidenceText(value, field);
  return text
    ? `sha256:${crypto.createHash("sha256").update(JSON.stringify(text)).digest("hex")}`
    : "";
}
