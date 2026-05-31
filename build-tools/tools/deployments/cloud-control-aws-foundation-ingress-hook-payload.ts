export function ingressInspectionPayload(foundation: unknown, phase: "evidence" | "smoke") {
  const ingress = (foundation as any)?.network?.ingress || {};
  const topology = ingress.topologyEvidence || {};
  return {
    schemaVersion: "aws-ingress-hook-inspection@1",
    checkedAt: new Date().toISOString(),
    phase,
    source:
      process.env.VBR_AWS_FOUNDATION_LIVE === "1"
        ? "live-aws-inspection"
        : "fixture-live-compatible",
    loadBalancer: topology.loadBalancer,
    listener: topology.listener,
    targetGroup: topology.targetGroup,
    targetRegistration: topology.targetRegistration,
    targetHealth: topology.targetHealthEvidence,
    certificate: topology.certificate,
    dns: topology.dns,
    callbackRoute: topology.callbackRoute,
    publicUrl: topology.publicUrl,
  };
}
