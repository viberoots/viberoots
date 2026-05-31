import { evidenceList, evidenceObject, evidenceText } from "./cloud-control-evidence-helpers";
import {
  AWS_REVIEWED_TLS_POLICIES,
  type AwsCertificateEvidence,
} from "./cloud-control-aws-ingress-types";
import {
  hasReviewedEvidence,
  hostFromUrl,
  matchesCertificateName,
  requireDigest,
  requireFresh,
} from "./cloud-control-aws-ingress-helpers";
import { validateImportedIngressEvidence } from "./cloud-control-aws-ingress-imported";
import type { AwsTopologyValidationOptions } from "./cloud-control-aws-topology-runtime";

export function validateTlsPolicy(ingress: unknown): string[] {
  const policy = evidenceText(ingress, "tlsPolicy") || evidenceText(ingress, "tlsPolicyName");
  return (AWS_REVIEWED_TLS_POLICIES as readonly string[]).includes(policy)
    ? []
    : ["AWS ingress TLS policy does not meet reviewed minimum"];
}

export function validateCertificate(
  ingress: unknown,
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const certificate = evidenceObject(evidenceObject(ingress).certificate);
  const publicHost = expectedPublicHost(ingress, options);
  const callbackHost = options.expectedAuthCallbackHost || evidenceText(ingress, "callbackHost");
  const errors = [
    ...requireFresh(certificate, "AWS ACM certificate", options),
    ...requireDigest(certificate.validationOwnership, "ACM validation ownership evidence"),
    ...requireDigest(certificate.renewal, "ACM renewal evidence"),
    ...requireDigest(certificate.dnsValidation, "ACM DNS validation evidence"),
  ];
  if (!evidenceText(ingress, "certificateArn"))
    errors.push("AWS ingress evidence missing certificateArn");
  if (evidenceText(certificate, "arn") !== evidenceText(ingress, "certificateArn")) {
    errors.push("ACM certificate evidence does not match selected ingress certificate");
  }
  if (certificate.status !== "ISSUED") errors.push("ACM certificate is not issued");
  if (evidenceText(certificate, "accountId") !== evidenceText(topology, "accountId")) {
    errors.push("ACM certificate account does not match selected topology");
  }
  if (evidenceText(certificate, "region") !== evidenceText(topology, "region")) {
    errors.push("ACM certificate region does not match selected topology");
  }
  if (evidenceText(certificate, "listenerArn") !== evidenceText(ingress, "listenerArn")) {
    errors.push("ACM certificate is not attached to selected listener");
  }
  errors.push(...validateCertificateValidity(certificate));
  errors.push(...validateNameCoverage(certificate, publicHost, "publicUrl"));
  errors.push(...validateNameCoverage(certificate, callbackHost, "authCallbackHost"));
  if (!hasReviewedEvidence(certificate.validationOwnership)) {
    errors.push("ACM certificate missing validation ownership proof");
  }
  if (!hasReviewedEvidence(certificate.renewal)) {
    errors.push("ACM certificate missing renewal posture");
  }
  if (!hasReviewedEvidence(certificate.dnsValidation)) {
    errors.push("ACM certificate missing DNS validation proof");
  }
  return errors;
}

export function validateDns(
  ingress: unknown,
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const dns = evidenceObject(evidenceObject(ingress).dns);
  const lb = evidenceObject(evidenceObject(ingress).loadBalancer);
  const expectedHost = expectedPublicHost(ingress, options);
  const errors = requireFresh(dns, "AWS ingress DNS", options);
  if (evidenceText(dns, "hostname") !== expectedHost) {
    errors.push("AWS ingress DNS hostname does not match publicUrl");
  }
  if (
    !evidenceText(dns, "publicVantagePoint") ||
    evidenceList(dns, "publicResolution").length === 0
  ) {
    errors.push("AWS ingress DNS missing public-vantage resolution evidence");
  }
  const lbArn = evidenceText(lb, "arn");
  if (evidenceText(dns, "targetLoadBalancerArn") !== lbArn && !evidenceText(dns, "edgeHostname")) {
    errors.push("AWS ingress DNS does not resolve to selected load balancer");
  }
  if (evidenceText(dns, "edgeHostname") && evidenceText(dns, "targetLoadBalancerArn") !== lbArn) {
    errors.push("edge-front-door DNS is not linked back to AWS ingress identity");
  }
  errors.push(
    ...validateImportedIngressEvidence(dns.external, "DNS", {
      ...options,
      capabilityId: "aws-network-foundation",
      accountId: evidenceText(topology, "accountId"),
      region: evidenceText(topology, "region"),
      vpcId: evidenceText(evidenceObject(topology).vpc, "id"),
      loadBalancerArn: lbArn,
      hostname: expectedHost,
    }),
  );
  return errors;
}

function expectedPublicHost(ingress: unknown, options: AwsTopologyValidationOptions): string {
  return options.expectedPublicUrl
    ? hostFromUrl(options.expectedPublicUrl)
    : hostFromUrl(evidenceText(ingress, "publicUrl"));
}

function validateCertificateValidity(certificate: Record<string, unknown>): string[] {
  const now = Date.now();
  const notBefore = Date.parse(evidenceText(certificate, "notBefore"));
  const notAfter = Date.parse(evidenceText(certificate, "notAfter"));
  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter)) {
    return ["ACM certificate validity window is missing"];
  }
  return notBefore <= now && now < notAfter ? [] : ["ACM certificate is expired or not yet valid"];
}

function validateNameCoverage(
  certificate: AwsCertificateEvidence | Record<string, unknown>,
  host: string,
  label: string,
): string[] {
  const names = evidenceList(certificate, "subjectAlternativeNames");
  if (!host || names.length === 0) return [`ACM certificate missing ${label} SAN coverage`];
  return names.some((name) => matchesCertificateName(name, host))
    ? []
    : [`ACM certificate does not cover ${label}`];
}
