import { evidenceList, evidenceObject, evidenceText } from "./cloud-control-evidence-helpers";
import { requireFresh, targetPort } from "./cloud-control-aws-ingress-helpers";
import { validateImportedIngressEvidence } from "./cloud-control-aws-ingress-imported";
import type { AwsTopologyValidationOptions } from "./cloud-control-aws-topology-runtime";

export function validatePublicReachability(
  ingress: Record<string, unknown>,
  topology: Record<string, unknown>,
  options: AwsTopologyValidationOptions,
): string[] {
  const lb = evidenceObject(ingress.loadBalancer);
  const reachability = evidenceObject(lb.publicReachability);
  const errors = requireFresh(reachability, "AWS ingress public reachability", options);
  if (lb.scheme !== "internet-facing") errors.push("AWS ingress load balancer is not public");
  if (
    !evidenceText(reachability, "publicVantagePoint") ||
    !evidenceText(reachability, "resolvedTarget")
  ) {
    errors.push("AWS ingress missing public-vantage reachability proof");
  }
  if (evidenceText(reachability, "path") === "aws-public-lb") {
    if (
      evidenceList(reachability, "publicSubnets").length === 0 ||
      evidenceList(reachability, "routeTableIds").length === 0 ||
      !evidenceText(reachability, "internetGatewayId")
    ) {
      errors.push("AWS public ingress missing public subnet route or IGW evidence");
    }
  }
  if (
    evidenceText(reachability, "path") === "reviewed-edge" &&
    evidenceText(reachability, "originLoadBalancerArn") !== evidenceText(lb, "arn")
  ) {
    errors.push("AWS ingress reviewed edge reachability is not linked to selected origin");
  }
  const lbSubnets = evidenceList(lb, "subnetIds");
  const publicSubnets = evidenceList(reachability, "publicSubnets");
  for (const subnetId of lbSubnets) {
    if (!publicSubnets.includes(subnetId)) {
      errors.push("AWS ingress public reachability does not cover selected load balancer subnet");
    }
  }
  const reviewedPublicSubnets = topologyPublicSubnets(topology);
  if (
    reviewedPublicSubnets.length > 0 &&
    publicSubnets.some((id) => !reviewedPublicSubnets.includes(id))
  ) {
    errors.push("AWS ingress public reachability uses an unreviewed public subnet");
  }
  return errors;
}

export function validateSecurityPath(
  ingress: Record<string, unknown>,
  topology: Record<string, unknown>,
): string[] {
  const access = evidenceObject(ingress.accessControl);
  const groups = evidenceObject(topology.securityGroups);
  const errors: string[] = [];
  if (evidenceText(access, "serviceSecurityGroupId") !== evidenceText(groups.service, "id")) {
    errors.push("AWS ingress service security group does not match selected topology");
  }
  if (targetPort(access) !== targetPort(ingress.targetGroup)) {
    errors.push("AWS ingress access control target port does not match service port");
  }
  if (access.directPublicServiceIngress !== false)
    errors.push("AWS service host has direct public ingress");
  if (!hasIngressAccess(access)) {
    errors.push("AWS public ingress is not limited to approved clients or reviewed edge networks");
  }
  return errors;
}

export function validatePlainHttp(
  ingress: Record<string, unknown>,
  options: AwsTopologyValidationOptions,
): string[] {
  const listener = evidenceObject(ingress.listener);
  if (evidenceText(listener, "protocol") !== "HTTP") return [];
  const redirect = evidenceObject(listener.httpRedirect);
  const errors = requireFresh(redirect, "AWS HTTP redirect", options);
  if (
    redirect.toPort !== 443 ||
    !["HTTP_301", "HTTP_302"].includes(evidenceText(redirect, "statusCode"))
  ) {
    errors.push("AWS non-TLS listener is not a reviewed HTTP-to-HTTPS redirect");
  }
  if (
    redirect.servicePlaintextCompletes !== false ||
    redirect.callbackPlaintextCompletes !== false
  ) {
    errors.push("AWS plaintext service or callback traffic can complete");
  }
  return errors;
}

export function validateCallbackRoute(
  ingress: Record<string, unknown>,
  options: AwsTopologyValidationOptions,
): string[] {
  const route = evidenceObject(ingress.callbackRoute);
  const errors = requireFresh(route, "AWS callback route", options);
  if (
    evidenceText(route, "host") !==
    (options.expectedAuthCallbackHost || evidenceText(ingress, "callbackHost"))
  ) {
    errors.push("AWS callback route host does not match runtime auth-provider config");
  }
  const path =
    options.expectedAuthCallbackPath ||
    evidenceText(ingress, "authCallbackPath") ||
    "/oidc/callback";
  if (evidenceText(route, "path") !== path) {
    errors.push("AWS callback route path does not match runtime auth-provider config");
  }
  if (
    evidenceText(route, "listenerArn") !== evidenceText(ingress, "listenerArn") ||
    evidenceText(route, "targetGroupArn") !== evidenceText(ingress, "targetGroupArn")
  ) {
    errors.push(
      "AWS callback route does not send callback host/path to selected service target group",
    );
  }
  return errors;
}

export function validateExternalEvidence(
  ingress: Record<string, unknown>,
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  return validateImportedIngressEvidence(ingress.externalEvidence, "AWS ingress", {
    ...options,
    capabilityId: "aws-network-foundation",
    accountId: evidenceText(topology, "accountId"),
    region: evidenceText(topology, "region"),
    vpcId: evidenceText(evidenceObject(topology).vpc, "id"),
    loadBalancerArn: evidenceText(ingress.loadBalancer, "arn"),
  });
}

function hasIngressAccess(access: Record<string, unknown>): boolean {
  return (
    evidenceList(access, "approvedClientCidrs").length > 0 ||
    evidenceList(access, "reviewedEdgeNetworkCidrs").length > 0 ||
    Boolean(access.waf || access.rateLimit || access.exception)
  );
}

function topologyPublicSubnets(topology: Record<string, unknown>): string[] {
  return (Array.isArray(topology.publicSubnets) ? topology.publicSubnets : [])
    .map((item) => evidenceText(item, "id"))
    .filter(Boolean);
}
