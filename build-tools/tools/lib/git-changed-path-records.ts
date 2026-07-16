import { TextDecoder } from "node:util";

const utf8 = new TextDecoder("utf-8", { fatal: true });

function recordsFromNul(data: Uint8Array, source: string): Uint8Array[] {
  if (data.length === 0) return [];
  if (data[data.length - 1] !== 0) throw new Error(`${source}: truncated record`);
  const records: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < data.length; index++) {
    if (data[index] !== 0) continue;
    if (index === start) throw new Error(`${source}: empty record`);
    records.push(data.subarray(start, index));
    start = index + 1;
  }
  return records;
}

function decodePath(record: Uint8Array, source: string): string {
  try {
    const value = utf8.decode(record);
    if (!value) throw new Error("empty path");
    return value;
  } catch (error) {
    throw new Error(`${source}: invalid UTF-8 path: ${String(error)}`);
  }
}

function decodeAscii(record: Uint8Array, source: string): string {
  if (record.some((byte) => byte > 0x7f)) throw new Error(`${source}: non-ASCII status`);
  return Buffer.from(record).toString("ascii");
}

export function parseDiffNameStatusZ(data: Uint8Array): string[] {
  const records = recordsFromNul(data, "git diff --name-status -z");
  const paths: string[] = [];
  for (let index = 0; index < records.length; ) {
    const status = decodeAscii(records[index++]!, "git diff --name-status -z");
    if (!/^(?:[ACDMRTUXB]|[RC][0-9]{1,3})$/.test(status)) {
      throw new Error(`git diff --name-status -z: invalid status ${JSON.stringify(status)}`);
    }
    const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    if (index + pathCount > records.length) {
      throw new Error(`git diff --name-status -z: ${status} record is missing path data`);
    }
    for (let offset = 0; offset < pathCount; offset++) {
      paths.push(decodePath(records[index++]!, "git diff --name-status -z"));
    }
  }
  return paths;
}

export function parsePorcelainStatusZ(data: Uint8Array): string[] {
  const records = recordsFromNul(data, "git status --porcelain=v1 -z");
  const paths: string[] = [];
  for (let index = 0; index < records.length; index++) {
    const entry = records[index]!;
    if (entry.length < 4 || entry[2] !== 0x20) {
      throw new Error("git status --porcelain=v1 -z: malformed status record");
    }
    const status = decodeAscii(entry.subarray(0, 2), "git status --porcelain=v1 -z");
    if (!/^[ MADRCUT?!m]{2}$/.test(status) || status === "  ") {
      throw new Error(`git status --porcelain=v1 -z: invalid status ${JSON.stringify(status)}`);
    }
    paths.push(decodePath(entry.subarray(3), "git status --porcelain=v1 -z"));
    if (!/[RC]/.test(status)) continue;
    if (++index >= records.length) {
      throw new Error(`git status --porcelain=v1 -z: ${status} record is missing its source path`);
    }
    paths.push(decodePath(records[index]!, "git status --porcelain=v1 -z"));
  }
  return paths;
}
