import { execFileSync } from "node:child_process";
import type { AwsFoundationProfile } from "./cloud-control-aws-foundation-types";

export function inspectLiveIngress(
  profile: AwsFoundationProfile,
  env: NodeJS.ProcessEnv,
  regionArgs: string[],
): void {
  const ingress = profile.network.ingress;
  if (!ingress) return;
  const loadBalancers = awsJson<{ LoadBalancers?: { LoadBalancerArn?: string; VpcId?: string }[] }>(
    [
      "elbv2",
      "describe-load-balancers",
      "--load-balancer-arns",
      ingress.loadBalancerArn,
      ...regionArgs,
    ],
    env,
  );
  const lb = loadBalancers.LoadBalancers?.[0];
  if (
    !lb ||
    lb.LoadBalancerArn !== ingress.loadBalancerArn ||
    lb.VpcId !== profile.network.vpc.vpcId
  ) {
    throw new Error("live AWS ingress load balancer inspection did not confirm selected VPC");
  }
  const listeners = awsJson<{ Listeners?: { ListenerArn?: string; LoadBalancerArn?: string }[] }>(
    ["elbv2", "describe-listeners", "--listener-arns", ingress.listenerArn, ...regionArgs],
    env,
  );
  const listener = listeners.Listeners?.[0];
  if (!listener || listener.LoadBalancerArn !== ingress.loadBalancerArn) {
    throw new Error("live AWS ingress listener is not linked to selected load balancer");
  }
  const targetHealth = awsJson<{
    TargetHealthDescriptions?: {
      Target?: { Id?: string; Port?: number };
      TargetHealth?: { State?: string };
    }[];
  }>(
    [
      "elbv2",
      "describe-target-health",
      "--target-group-arn",
      ingress.targetGroupArn,
      ...regionArgs,
    ],
    env,
  );
  const target = targetHealth.TargetHealthDescriptions?.find(
    (item) =>
      item.Target?.Id === ingress.targetInstanceId && item.Target?.Port === ingress.targetPort,
  );
  if (!target || target.TargetHealth?.State !== "healthy") {
    throw new Error("live AWS ingress target health did not confirm selected healthy target");
  }
  const certificate = awsJson<{ Certificate?: { CertificateArn?: string; Status?: string } }>(
    ["acm", "describe-certificate", "--certificate-arn", ingress.certificateArn, ...regionArgs],
    env,
  ).Certificate;
  if (
    !certificate ||
    certificate.CertificateArn !== ingress.certificateArn ||
    certificate.Status !== "ISSUED"
  ) {
    throw new Error("live AWS ingress certificate inspection did not confirm issued certificate");
  }
}

function awsJson<T>(args: string[], env: NodeJS.ProcessEnv): T {
  const raw = execFileSync("aws", args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(raw) as T;
}
