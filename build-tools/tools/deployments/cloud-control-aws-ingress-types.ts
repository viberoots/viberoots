export const AWS_REVIEWED_TLS_POLICIES = [
  "ELBSecurityPolicy-TLS13-1-2-2021-06",
  "ELBSecurityPolicy-TLS13-1-2-Res-2021-06",
] as const;

export type AwsIngressEvidence = {
  checkedAt: string;
  type: "alb" | "nlb";
  publicUrl?: string;
  authCallbackHost?: string;
  authCallbackPath?: string;
  listenerArn: string;
  targetGroupArn: string;
  targetHealth: "healthy";
  certificateArn: string;
  tlsPolicy: string;
  dnsRecord: string;
  callbackHost: string;
  loadBalancer?: {
    checkedAt: string;
    arn: string;
    dnsName: string;
    scheme: "internet-facing" | "internal";
    vpcId: string;
    subnetIds: string[];
    securityGroupIds: string[];
    publicReachability: AwsPublicReachabilityEvidence;
  };
  listener?: {
    checkedAt: string;
    arn: string;
    loadBalancerArn: string;
    vpcId: string;
    protocol: "HTTPS" | "TLS" | "HTTP" | "TCP";
    port: number;
    tlsPolicy?: string;
    certificateArn?: string;
    httpRedirect?: AwsHttpRedirectEvidence;
  };
  targetGroup?: {
    checkedAt: string;
    arn: string;
    listenerArn: string;
    loadBalancerArn: string;
    vpcId: string;
    protocol: string;
    port: number;
    healthCheck: AwsTargetHealthCheckEvidence;
  };
  targetRegistration?: {
    checkedAt: string;
    targetId: string;
    instanceId: string;
    port: number;
    serviceProcess: string;
    serviceUnit?: string;
    imageDigest?: string;
    configDigest?: string;
  };
  targetHealthEvidence?: {
    checkedAt: string;
    status: "healthy" | "unhealthy" | "draining" | "unused" | "initial";
    targetId: string;
    port: number;
    serviceProcess: string;
  };
  certificate?: AwsCertificateEvidence;
  dns?: AwsDnsEvidence;
  accessControl?: AwsIngressAccessEvidence;
  callbackRoute?: AwsCallbackRouteEvidence;
  externalEvidence?: AwsImportedIngressEvidence;
};

export type AwsPublicReachabilityEvidence = {
  checkedAt: string;
  path: "aws-public-lb" | "reviewed-edge";
  publicSubnets?: string[];
  routeTableIds?: string[];
  internetGatewayId?: string;
  publicVantagePoint: string;
  resolvedTarget: string;
  edgeHostname?: string;
  originLoadBalancerArn?: string;
};

export type AwsHttpRedirectEvidence = {
  checkedAt: string;
  fromPort: number;
  toPort: 443;
  statusCode: "HTTP_301" | "HTTP_302";
  servicePlaintextCompletes: false;
  callbackPlaintextCompletes: false;
};

export type AwsTargetHealthCheckEvidence = {
  checkedAt: string;
  protocol: "HTTP" | "HTTPS" | "TCP";
  port: number | "traffic-port";
  path?: string;
  matcher?: string;
  readinessPath: string;
  proofDigest: string;
};

export type AwsCertificateEvidence = {
  checkedAt: string;
  arn: string;
  accountId: string;
  region: string;
  status: "ISSUED" | "PENDING_VALIDATION" | "EXPIRED" | "FAILED" | "INACTIVE";
  listenerArn: string;
  notBefore: string;
  notAfter: string;
  subjectAlternativeNames: string[];
  validationOwnership: AwsReviewedIngressEvidence;
  renewal: AwsReviewedIngressEvidence;
  dnsValidation?: AwsReviewedIngressEvidence;
};

export type AwsDnsEvidence = {
  checkedAt: string;
  hostname: string;
  recordType: "A" | "AAAA" | "CNAME" | "ALIAS";
  targetDnsName: string;
  targetLoadBalancerArn?: string;
  edgeHostname?: string;
  publicResolution: string[];
  publicVantagePoint: string;
  external?: AwsImportedIngressEvidence;
};

export type AwsIngressAccessEvidence = {
  checkedAt: string;
  serviceSecurityGroupId: string;
  loadBalancerSecurityGroupId: string;
  sourceSecurityGroupIds: string[];
  targetPort: number;
  directPublicServiceIngress: false;
  approvedClientCidrs?: string[];
  reviewedEdgeNetworkCidrs?: string[];
  waf?: AwsReviewedIngressEvidence;
  rateLimit?: AwsReviewedIngressEvidence;
  exception?: AwsReviewedIngressEvidence;
};

export type AwsCallbackRouteEvidence = {
  checkedAt: string;
  host: string;
  path: string;
  listenerArn: string;
  ruleArn: string;
  targetGroupArn: string;
};

export type AwsImportedIngressEvidence = AwsReviewedIngressEvidence & {
  owner: string;
  capabilityId: string;
  accountId?: string;
  region?: string;
  vpcId?: string;
  loadBalancerArn?: string;
  hostname?: string;
  drift: { checkedAt: string; status: "in-sync"; diffDigest: string };
};

export type AwsReviewedIngressEvidence = {
  checkedAt: string;
  reviewedReference: string;
  digest: string;
};
