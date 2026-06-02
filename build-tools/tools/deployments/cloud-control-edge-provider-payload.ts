import { evidenceObject, evidenceText } from "./cloud-control-evidence-helpers";

export type EdgeProviderExpectedRuntime = {
  awsTopology?: unknown;
  runtimeConfig?: unknown;
};

export function validateEdgeIngressProviderPayload(
  id: string,
  value: unknown,
  expected: EdgeProviderExpectedRuntime,
): string[] {
  const payload = edgeIngressProviderPayload(value);
  const errors: string[] = [];
  const ingress = evidenceObject(evidenceObject(expected.awsTopology).ingress);
  const runtime = evidenceObject(expected.runtimeConfig);
  const callback = evidenceObject(runtime.authProvider).callback;
  const expectedHost = hostFromUrl(
    evidenceText(runtime, "publicUrl") || evidenceText(ingress, "publicUrl"),
  );
  const expectedCallbackHost =
    evidenceText(callback, "externalHost") || evidenceText(ingress, "authCallbackHost");
  const expectedCallbackPath =
    evidenceText(callback, "externalPath") || evidenceText(ingress, "authCallbackPath");
  const expectedOrigin = evidenceText(evidenceObject(ingress.loadBalancer), "arn");
  if (Object.keys(payload).length === 0)
    return [`${id}: missing reviewed ingress provider payload`];
  if (!expectedHost) errors.push(`${id}: missing selected runtime publicUrl evidence`);
  if (!expectedCallbackHost) errors.push(`${id}: missing selected callback host evidence`);
  if (!expectedCallbackPath) errors.push(`${id}: missing selected callback path evidence`);
  if (!expectedOrigin) errors.push(`${id}: missing selected AWS ingress origin evidence`);
  if (evidenceText(payload, "schemaVersion") !== "edge-ingress-provider-payload@1") {
    errors.push(`${id}: missing structured edge ingress provider payload`);
  }
  if (evidenceText(payload, "hostname") !== expectedHost) {
    errors.push(`${id}: edge provider payload hostname does not match runtime publicUrl`);
  }
  if (evidenceText(payload, "callbackHost") !== expectedCallbackHost) {
    errors.push(`${id}: edge provider payload callback host does not match runtime config`);
  }
  if (evidenceText(payload, "callbackPath") !== expectedCallbackPath) {
    errors.push(`${id}: edge provider payload callback path does not match runtime config`);
  }
  if (evidenceText(payload, "originLoadBalancerArn") !== expectedOrigin) {
    errors.push(`${id}: edge provider payload origin does not match selected AWS ingress`);
  }
  return errors;
}

export function edgeIngressProviderPayload(value: unknown): Record<string, unknown> {
  const payload = evidenceObject(value);
  if (evidenceText(payload, "schemaVersion") === "edge-ingress-provider-payload@1") return payload;
  return evidenceObject(payload.binding);
}

function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}
