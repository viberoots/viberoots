import crypto from "node:crypto";

export const tauriSemanticManifestBytes = Buffer.from(
  JSON.stringify({
    schema: "viberoots.tauri-artifact.v1",
    signature: { releaseSigned: false, releaseAdmitted: false },
  }),
);
export const tauriSemanticManifestDigest = `sha256:${crypto
  .createHash("sha256")
  .update(tauriSemanticManifestBytes)
  .digest("hex")}`;
