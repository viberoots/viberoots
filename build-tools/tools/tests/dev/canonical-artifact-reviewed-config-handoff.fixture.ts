import fs from "node:fs";
import { consumeArtifactIngressReviewedNixConfig } from "../../dev/canonical-artifact-entrypoint";

const proofFd = Number(process.env.VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD || "-1");
const outcome = consumeArtifactIngressReviewedNixConfig();
let fdClosed = false;
try {
  fs.fstatSync(proofFd);
} catch {
  fdClosed = true;
}
let fd8Sentinel = "";
try {
  fd8Sentinel = fs.readFileSync(8, "utf8").trim();
} catch {}
process.stdout.write(
  JSON.stringify({
    applied: process.env.VBR_NIX_CACHE_HEALTH_APPLIED || "",
    fdClosed,
    fd8Sentinel,
    proofFdMarker: process.env.VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD || "",
    appliedOutcome: outcome.applied,
    reviewed: outcome.config,
    reviewedMarker: process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG || "",
    token: process.env.VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN || "",
  }),
);
