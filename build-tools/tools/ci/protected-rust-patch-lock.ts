import fs from "node:fs/promises";

export type ProtectedLockDependency = {
  name: string;
  version: string;
  source: string;
};

export async function addLockedDependency(
  lockfile: string,
  packageName: string,
  dependency: ProtectedLockDependency,
  checksum: string,
): Promise<void> {
  let text = await fs.readFile(lockfile, "utf8");
  const start = text.indexOf(`name = "${packageName}"`);
  if (start < 0)
    throw new Error(`protected dependency owner is absent from Cargo.lock: ${packageName}`);
  const stanzaEnd = text.indexOf("\n[[package]]", start);
  const end = stanzaEnd < 0 ? text.length : stanzaEnd;
  let stanza = text.slice(start, end);
  if (!stanza.includes(`"${dependency.name}"`)) {
    stanza = addDependencyReference(stanza, dependency.name);
    text = `${text.slice(0, start)}${stanza}${text.slice(end)}`;
  }
  const protectedStart = text.indexOf(`[[package]]\nname = "${dependency.name}"`);
  if (protectedStart < 0) text += protectedPackage(dependency, checksum);
  else assertProtectedPackage(text, protectedStart, dependency, checksum);
  await fs.writeFile(lockfile, text);
}

function addDependencyReference(stanza: string, dependencyName: string): string {
  const dependencyList = stanza.match(/dependencies = \[\n([\s\S]*?)\n\]/u);
  const inlineDependencyList = stanza.match(/dependencies = \[([^\]\n]*)\]/u);
  if (dependencyList) {
    return stanza.replace(
      dependencyList[0],
      `dependencies = [\n${dependencyList[1]}\n "${dependencyName}",\n]`,
    );
  }
  if (inlineDependencyList) {
    const entries = inlineDependencyList[1]!.trim();
    return stanza.replace(
      inlineDependencyList[0],
      `dependencies = [${entries}${entries ? ", " : ""}"${dependencyName}"]`,
    );
  }
  return `${stanza}\ndependencies = [\n "${dependencyName}",\n]\n`;
}

function protectedPackage(dependency: ProtectedLockDependency, checksum: string): string {
  return [
    "",
    "[[package]]",
    `name = "${dependency.name}"`,
    `version = "${dependency.version}"`,
    `source = "${dependency.source}"`,
    `checksum = "${checksum}"`,
    "",
  ].join("\n");
}

function assertProtectedPackage(
  text: string,
  start: number,
  dependency: ProtectedLockDependency,
  checksum: string,
): void {
  const protectedEnd = text.indexOf("\n[[package]]", start);
  const stanza = text.slice(start, protectedEnd < 0 ? text.length : protectedEnd);
  for (const expected of [
    `version = "${dependency.version}"`,
    `source = "${dependency.source}"`,
    `checksum = "${checksum}"`,
  ]) {
    if (!stanza.includes(expected)) {
      throw new Error(`protected dependency lock entry is inconsistent: ${expected}`);
    }
  }
}
