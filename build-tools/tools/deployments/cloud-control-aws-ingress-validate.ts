import { evidenceList, evidenceObject, evidenceText } from "./cloud-control-evidence-helpers";
import {
  validateCertificate,
  validateDns,
  validateTlsPolicy,
} from "./cloud-control-aws-ingress-cert-dns";
import { requireFresh, targetPort } from "./cloud-control-aws-ingress-helpers";
import {
  validateCallbackRoute,
  validateExternalEvidence,
  validatePlainHttp,
  validatePublicReachability,
  validateSecurityPath,
} from "./cloud-control-aws-ingress-network";
import type { AwsTopologyValidationOptions } from "./cloud-control-aws-topology-runtime";

export function validateIngressEvidence(
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const object = evidenceObject(topology);
  const ingress = evidenceObject(object.ingress);
  const compute = evidenceObject(object.compute);
  const process = evidenceObject(compute.processEvidence);
  const vpcId = evidenceText(object.vpc, "id");
  return [
    ...requireFresh(ingress, "AWS ingress", options),
    ...validateShape(ingress),
    ...validateVpcAndLinks(ingress, object, vpcId),
    ...validateTargetBinding(ingress, compute, process, options),
    ...validateHealthCheck(ingress, options),
    ...validatePublicReachability(ingress, object, options),
    ...validateSecurityPath(ingress, object),
    ...validateCertificate(ingress, topology, options),
    ...validateDns(ingress, topology, options),
    ...validateTlsPolicy(ingress),
    ...validatePlainHttp(ingress, options),
    ...validateCallbackRoute(ingress, options),
    ...validateExternalEvidence(ingress, topology, options),
  ];
}

function validateShape(ingress: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const field of [
    "listenerArn",
    "targetGroupArn",
    "certificateArn",
    "tlsPolicy",
    "dnsRecord",
  ]) {
    if (!evidenceText(ingress, field)) errors.push(`AWS ingress evidence missing ${field}`);
  }
  if (!["alb", "nlb"].includes(evidenceText(ingress, "type"))) {
    errors.push("AWS ingress evidence has unsupported load balancer type");
  }
  return errors;
}

function validateVpcAndLinks(
  ingress: Record<string, unknown>,
  topology: Record<string, unknown>,
  vpcId: string,
): string[] {
  const lb = evidenceObject(ingress.loadBalancer);
  const listener = evidenceObject(ingress.listener);
  const targetGroup = evidenceObject(ingress.targetGroup);
  const errors: string[] = [];
  for (const [label, value] of [
    ["load balancer", lb],
    ["listener", listener],
    ["target group", targetGroup],
  ]) {
    if (evidenceText(value, "vpcId") !== vpcId)
      errors.push(`AWS ingress ${label} VPC does not match selected VPC`);
  }
  if (evidenceText(listener, "loadBalancerArn") !== evidenceText(lb, "arn")) {
    errors.push("AWS ingress listener is not linked to selected load balancer");
  }
  if (evidenceText(targetGroup, "listenerArn") !== evidenceText(ingress, "listenerArn")) {
    errors.push("AWS ingress target group is not linked to selected listener");
  }
  if (evidenceText(targetGroup, "loadBalancerArn") !== evidenceText(lb, "arn")) {
    errors.push("AWS ingress target group is not linked to selected load balancer");
  }
  return errors;
}

function validateTargetBinding(
  ingress: Record<string, unknown>,
  compute: Record<string, unknown>,
  process: Record<string, unknown>,
  options: AwsTopologyValidationOptions,
): string[] {
  const registration = evidenceObject(ingress.targetRegistration);
  const health = evidenceObject(ingress.targetHealthEvidence);
  const errors = [
    ...requireFresh(registration, "AWS ingress target registration", options),
    ...requireFresh(health, "AWS ingress target health", options),
  ];
  const instanceId = evidenceText(compute, "instanceId");
  if (instanceId && evidenceText(registration, "instanceId") !== instanceId) {
    errors.push("AWS ingress target registration does not match selected EC2 instance");
  }
  if (evidenceText(registration, "serviceProcess") !== evidenceText(process, "service")) {
    errors.push("AWS ingress target registration does not match selected service process");
  }
  for (const field of ["imageDigest", "configDigest"]) {
    const expected = evidenceText(process, field);
    if (expected && evidenceText(registration, field) !== expected) {
      errors.push(`AWS ingress target registration does not match selected ${field}`);
    }
  }
  if (targetPort(registration) !== targetPort(ingress.targetGroup)) {
    errors.push("AWS ingress target registration port does not match selected service port");
  }
  if (!["healthy"].includes(evidenceText(health, "status"))) {
    errors.push("AWS ingress target health is not healthy");
  }
  if (evidenceText(health, "serviceProcess") !== evidenceText(process, "service")) {
    errors.push("AWS ingress target health does not point at selected service process");
  }
  return errors;
}

function validateHealthCheck(
  ingress: Record<string, unknown>,
  options: AwsTopologyValidationOptions,
): string[] {
  const check = evidenceObject(evidenceObject(ingress.targetGroup).healthCheck);
  const errors = requireFresh(check, "AWS target-group health check", options);
  if (!evidenceText(check, "proofDigest").startsWith("sha256:")) {
    errors.push("AWS target-group health check proof missing digest");
  }
  if (!["HTTP", "HTTPS", "TCP"].includes(evidenceText(check, "protocol"))) {
    errors.push("AWS target-group health check protocol is missing or unsupported");
  }
  if (!check.port) errors.push("AWS target-group health check port is missing");
  if (evidenceText(check, "readinessPath") !== "/readyz") {
    errors.push("AWS target-group health check does not hit selected service readiness path");
  }
  if (evidenceText(check, "protocol") !== "TCP" && evidenceText(check, "path") !== "/readyz") {
    errors.push("AWS target-group health check path does not match selected readiness path");
  }
  if (evidenceText(check, "protocol") !== "TCP" && !evidenceText(check, "matcher")) {
    errors.push("AWS target-group health check matcher is missing");
  }
  return errors;
}
