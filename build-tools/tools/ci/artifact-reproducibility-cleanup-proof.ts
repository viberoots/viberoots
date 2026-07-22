import fs from "node:fs/promises";
import path from "node:path";

type CleanupProof = {
  schema: "viberoots.artifact-owned-root-cleanup.v1";
  ownedRoot: string;
  removed: true;
};

export async function writeVerifiedOwnedRootCleanupProof(
  proofFile: string,
  ownedRoot: string,
): Promise<void> {
  await assertRootRemoved(ownedRoot);
  const proof: CleanupProof = {
    schema: "viberoots.artifact-owned-root-cleanup.v1",
    ownedRoot,
    removed: true,
  };
  await fs.writeFile(proofFile, `${JSON.stringify(proof)}\n`, { flag: "wx", mode: 0o444 });
}

export async function verifyOwnedRootCleanupProof(proofFile: string): Promise<"verified"> {
  await readVerifiedOwnedRootCleanupProof(proofFile);
  return "verified";
}

export async function readVerifiedOwnedRootCleanupProof(
  proofFile: string,
): Promise<{ status: "verified"; ownedRoot: string }> {
  const proof = JSON.parse(await fs.readFile(path.resolve(proofFile), "utf8")) as CleanupProof;
  if (
    Object.keys(proof).sort().join("\0") !== ["ownedRoot", "removed", "schema"].join("\0") ||
    proof.schema !== "viberoots.artifact-owned-root-cleanup.v1" ||
    proof.removed !== true ||
    !path.isAbsolute(proof.ownedRoot)
  ) {
    throw new Error("owned-root cleanup proof is invalid");
  }
  await assertRootRemoved(proof.ownedRoot);
  return { status: "verified", ownedRoot: proof.ownedRoot };
}

async function assertRootRemoved(ownedRoot: string): Promise<void> {
  const remaining = await fs.lstat(ownedRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (remaining) throw new Error(`owned-root cleanup proof does not match disk: ${ownedRoot}`);
}
