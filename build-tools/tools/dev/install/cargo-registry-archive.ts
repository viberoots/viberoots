import crypto from "node:crypto";
import { constants } from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cargoRegistrySourceFiles, maxCargoArchiveMembers } from "./cargo-registry-source-files";

export type CargoArchiveRun = (command: string, args: string[], cwd: string) => Promise<string>;

const maxArchiveBytes = 512 * 1024 * 1024;

function checkedArchiveMember(member: string, expectedDirectory: string, key: string): void {
  const withoutTrailingSlash = member.replace(/\/$/, "");
  const canonical = path.posix.normalize(withoutTrailingSlash);
  const rootDirectory = member === `${expectedDirectory}/`;
  if (
    !member.startsWith(`${expectedDirectory}/`) ||
    member.includes("\\") ||
    path.posix.isAbsolute(member) ||
    canonical !== withoutTrailingSlash ||
    (canonical === expectedDirectory && !rootDirectory) ||
    canonical.startsWith("../")
  ) {
    throw new Error(`Cargo registry archive contains an unsafe member path for ${key}: ${member}`);
  }
}

function lockedDirectory(key: string, source: string): string {
  const identity = key.slice(0, -source.length - 1);
  const split = identity.lastIndexOf("@");
  return split > 0 ? `${identity.slice(0, split)}-${identity.slice(split + 1)}` : "";
}

async function verifiedArchivePath(
  originPath: string,
  cargoHome: string,
  expectedDirectory: string,
  key: string,
  lockedChecksum: string,
): Promise<string> {
  const canonicalOrigin = await fsp.realpath(originPath);
  if (!expectedDirectory || path.basename(canonicalOrigin) !== expectedDirectory) {
    throw new Error(`Cargo registry cache directory does not match locked identity: ${key}`);
  }
  const registryIndex = path.dirname(canonicalOrigin);
  const registryRoot = path.dirname(path.dirname(registryIndex));
  const canonicalCargoHome = await fsp.realpath(cargoHome);
  const expectedSourceRoot = path.join(canonicalCargoHome, "registry", "src");
  if (
    path.basename(path.dirname(registryIndex)) !== "src" ||
    registryRoot !== path.join(canonicalCargoHome, "registry") ||
    !registryIndex.startsWith(`${expectedSourceRoot}${path.sep}`)
  ) {
    throw new Error(`Cargo registry cache has an unsupported source layout for ${key}`);
  }
  const archive = path.join(
    registryRoot,
    "cache",
    path.basename(registryIndex),
    `${expectedDirectory}.crate`,
  );
  const handle = await fsp.open(archive, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Cargo registry cache archive is not a file for ${key}`);
    if (stat.size > maxArchiveBytes) {
      throw new Error(`Cargo registry cache archive exceeds ${maxArchiveBytes} bytes for ${key}`);
    }
    const checksum = crypto
      .createHash("sha256")
      .update(await handle.readFile())
      .digest("hex");
    if (checksum !== lockedChecksum.toLowerCase()) {
      throw new Error(`Cargo registry cache archive checksum does not match Cargo.lock: ${key}`);
    }
  } finally {
    await handle.close();
  }
  return archive;
}

export async function verifiedRegistryArchiveCopy(
  originPath: string,
  key: string,
  source: string,
  lockedChecksum: string,
  run: CargoArchiveRun,
  cargoHome: string,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const expectedDirectory = lockedDirectory(key, source);
  const archive = await verifiedArchivePath(
    originPath,
    cargoHome,
    expectedDirectory,
    key,
    lockedChecksum,
  );
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-cargo-archive-verified-"));
  const root = path.join(temporary, "source");
  try {
    await fsp.mkdir(root);
    const gzipArgs = ["-z"];
    const members = (await run("tar", ["-t", ...gzipArgs, "-f", archive], temporary))
      .split(/\r?\n/)
      .filter(Boolean);
    if (members.length === 0 || members.length > maxCargoArchiveMembers) {
      throw new Error(`Cargo registry archive has an invalid member count for ${key}`);
    }
    for (const member of members) checkedArchiveMember(member, expectedDirectory, key);
    const verbose = (await run("tar", ["-t", "-v", ...gzipArgs, "-f", archive], temporary))
      .split(/\r?\n/)
      .filter(Boolean);
    if (
      verbose.length !== members.length ||
      verbose.some((line) => line[0] !== "-" && line[0] !== "d")
    ) {
      throw new Error(`Cargo registry archive contains links or special members for ${key}`);
    }
    await run(
      "tar",
      ["-x", ...gzipArgs, "-f", archive, "-C", root, "--strip-components=1"],
      temporary,
    );
    await cargoRegistrySourceFiles(root);
    return {
      root,
      cleanup: () => fsp.rm(temporary, { recursive: true, force: true }),
    };
  } catch (error) {
    await fsp.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
