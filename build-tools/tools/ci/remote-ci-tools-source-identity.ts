import fs from "node:fs/promises";
import path from "node:path";

export type RemoteCiToolsSourceIdentity = {
  schema: "viberoots.remote-ci-tools-source-identity.v2";
  toolSourceRevision: string;
  sourceTreeDigest: string;
  sourceStorePath: string;
};

export function assertRemoteCiToolsSourceIdentity(
  identity: RemoteCiToolsSourceIdentity,
  expectedToolSourceRevision: string,
): void {
  if (
    Object.keys(identity).sort().join("\0") !==
      ["schema", "sourceStorePath", "sourceTreeDigest", "toolSourceRevision"].sort().join("\0") ||
    identity.schema !== "viberoots.remote-ci-tools-source-identity.v2" ||
    !/^[a-f0-9]{40,64}$/u.test(identity.toolSourceRevision) ||
    identity.toolSourceRevision !== expectedToolSourceRevision ||
    !/^sha256-[A-Za-z0-9+/]{43}=$/u.test(identity.sourceTreeDigest) ||
    !/^\/nix\/store\/[a-z0-9]{32}-source$/u.test(identity.sourceStorePath)
  ) {
    throw new Error("remote CI tools closure source identity does not match the frozen checkout");
  }
}

export async function verifyRemoteCiToolsSourceIdentity(opts: {
  remoteCiTools: string;
  expectedToolSourceRevision: string;
  runNix(args: string[]): Promise<{ stdout: string }>;
}): Promise<RemoteCiToolsSourceIdentity> {
  if (!/^\/nix\/store\/[a-z0-9]{32}-remote-ci-tools$/u.test(opts.remoteCiTools)) {
    throw new Error("remote CI tools source identity requires the canonical closure");
  }
  const file = path.join(opts.remoteCiTools, "share/viberoots/source-identity.json");
  const identity = JSON.parse(await fs.readFile(file, "utf8")) as RemoteCiToolsSourceIdentity;
  assertRemoteCiToolsSourceIdentity(identity, opts.expectedToolSourceRevision);
  const linkedSource = await fs.realpath(path.join(opts.remoteCiTools, "share/viberoots-source"));
  if (linkedSource !== identity.sourceStorePath) {
    throw new Error("remote CI tools closure source link does not match its authenticated source");
  }
  const observedDigest = (
    await opts.runNix(["hash", "path", identity.sourceStorePath])
  ).stdout.trim();
  if (observedDigest !== identity.sourceTreeDigest) {
    throw new Error("remote CI tools closure source tree digest is stale");
  }
  return Object.freeze(identity);
}
