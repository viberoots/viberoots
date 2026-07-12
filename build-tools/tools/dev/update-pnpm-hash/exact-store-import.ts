import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";
import { runExactStoreCommand } from "./exact-store-command";

const CANONICAL_TIMESTAMP = "197001010000";

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function normalizePnpmMetadataBlob(hex: string): string {
  const data = Buffer.from(hex, "hex");
  const minTimestampMs = Date.parse("2020-01-01T00:00:00.000Z");
  const maxTimestampMs = Date.parse("2100-01-01T00:00:00.000Z");
  const canonicalDouble = Buffer.alloc(8);
  canonicalDouble.writeDoubleBE(0, 0);
  for (let i = 0; i + 8 < data.length; i += 1) {
    if (data[i] !== 0xcb) continue;
    const value = data.readDoubleBE(i + 1);
    if (Number.isFinite(value) && value >= minTimestampMs && value <= maxTimestampMs) {
      canonicalDouble.copy(data, i + 1);
    }
  }
  return data.toString("hex");
}

async function normalizeSqliteIndex(opts: {
  repoRoot: string;
  importer: string;
  indexDb: string;
  timeoutMs: number;
}): Promise<void> {
  const tempDir = path.join(path.dirname(opts.indexDb), `.normalize-${process.pid}`);
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  await mkdirWithMacosMetadataExclusion(tempDir);
  const rowsPath = path.join(tempDir, "rows.tsv");
  const sqlPath = path.join(tempDir, "index.sql");
  const normalizedDb = path.join(tempDir, "index.db");
  try {
    const rows = await runExactStoreCommand({
      command: "sqlite3",
      echoStdout: false,
      label: `importer=${opts.importer} step=exact-store-normalize-index-export`,
      cwd: opts.repoRoot,
      timeoutMs: opts.timeoutMs,
      env: process.env,
      args: [
        `file:${opts.indexDb}?mode=ro&immutable=1`,
        "SELECT hex(CAST(key AS BLOB)) || char(9) || hex(data) FROM package_index ORDER BY key;",
      ],
    });
    await fsp.writeFile(rowsPath, rows.stdout, "utf8");
    const statements = [
      "PRAGMA page_size=4096;",
      'PRAGMA encoding="UTF-8";',
      "CREATE TABLE package_index (key TEXT PRIMARY KEY, data BLOB NOT NULL) WITHOUT ROWID;",
    ];
    for (const line of String(rows.stdout || "")
      .trimEnd()
      .split("\n")) {
      if (!line) continue;
      const [keyHex, dataHex] = line.split("\t");
      if (!keyHex || !dataHex) {
        throw new Error(`malformed pnpm package_index row while normalizing ${opts.indexDb}`);
      }
      statements.push(
        `INSERT INTO package_index(key,data) VALUES(CAST(X'${keyHex}' AS TEXT),X'${normalizePnpmMetadataBlob(dataHex)}');`,
      );
    }
    statements.push("ANALYZE;", "VACUUM;");
    await fsp.writeFile(sqlPath, statements.join("\n") + "\n", "utf8");
    await runExactStoreCommand({
      command: "bash",
      label: `importer=${opts.importer} step=exact-store-normalize-index-import`,
      cwd: opts.repoRoot,
      timeoutMs: opts.timeoutMs,
      env: process.env,
      args: ["--noprofile", "--norc", "-c", 'sqlite3 "$1" < "$2"', "bash", normalizedDb, sqlPath],
    });
    await fsp.copyFile(normalizedDb, opts.indexDb);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function normalizeExactStoreForImport(opts: {
  repoRoot: string;
  importer: string;
  storeDir: string;
  timeoutMs: number;
}): Promise<void> {
  const versions = await fsp.readdir(opts.storeDir, { withFileTypes: true }).catch(() => []);
  for (const version of versions) {
    if (!version.isDirectory() || !version.name.startsWith("v")) continue;
    const versionDir = path.join(opts.storeDir, version.name);
    await fsp
      .rm(path.join(versionDir, "projects"), { recursive: true, force: true })
      .catch(() => {});
    const indexDb = path.join(versionDir, "index.db");
    if (await pathExists(indexDb)) {
      await normalizeSqliteIndex({ ...opts, indexDb });
    }
  }
  await runExactStoreCommand({
    command: "bash",
    label: `importer=${opts.importer} step=exact-store-normalize-files`,
    cwd: opts.repoRoot,
    timeoutMs: opts.timeoutMs,
    env: process.env,
    args: [
      "--noprofile",
      "--norc",
      "-c",
      [
        "set -euo pipefail",
        'find "$1" -name .metadata_never_index -type f -delete',
        'find "$1" -type d -exec chmod 755 {} +',
        'find "$1" -type f -exec chmod 644 {} +',
        `find "$1" -exec touch -h -t ${CANONICAL_TIMESTAMP} {} +`,
      ].join("\n"),
      "bash",
      opts.storeDir,
    ],
  });
}

export async function importExactStoreIntoNixStore(opts: {
  repoRoot: string;
  importer: string;
  storeDir: string;
  timeoutMs: number;
}): Promise<string> {
  const safeName = opts.importer.replace(/[\\/]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-") || "root";
  try {
    await normalizeExactStoreForImport(opts);
    const added = await runExactStoreCommand({
      label: `importer=${opts.importer} step=exact-store-import`,
      cwd: opts.repoRoot,
      timeoutMs: opts.timeoutMs,
      env: {
        ...process.env,
      },
      args: ["store", "add-path", "--name", `pnpm-exact-store-${safeName}`, opts.storeDir],
    });
    const nixStorePath =
      String(added.stdout || "")
        .trim()
        .split(/\s+/)
        .pop() || "";
    if (!nixStorePath.startsWith("/nix/store/")) {
      const output = `${added.stdout}${added.stderr}`.trim();
      throw new Error(
        output
          ? `failed to import exact pnpm store into nix store for ${opts.importer}\n${output}`
          : `failed to import exact pnpm store into nix store for ${opts.importer}`,
      );
    }
    return nixStorePath;
  } finally {
    await mkdirWithMacosMetadataExclusion(path.dirname(opts.storeDir)).catch(() => {});
    await fsp.rm(opts.storeDir, { recursive: true, force: true }).catch(() => {});
  }
}
