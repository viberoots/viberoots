import crypto from "node:crypto";

const ED25519_PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SSH_ED25519_PREFIX = Buffer.from("0000000b7373682d6564323535313900000020", "hex");

export function deterministicRemoteBuilderHostKey(identity: string) {
  const seed = crypto.createHash("sha256").update(`viberoots-test-host-key:${identity}`).digest();
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const spki = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const sshBlob = Buffer.concat([SSH_ED25519_PREFIX, spki.subarray(-32)]);
  return {
    algorithm: "ssh-ed25519" as const,
    publicKey: sshBlob.toString("base64"),
    fingerprint: `SHA256:${crypto
      .createHash("sha256")
      .update(sshBlob)
      .digest("base64")
      .replace(/=+$/u, "")}` as const,
  };
}
