import type { CloudControlSetupInput } from "./cloud-control-setup-types";

export const PRIVATELINK_PSQL_PROOF_HELPER = "scripts/supabase-privatelink-psql-proof.mjs";

export function renderPrivateLinkPsqlHelper(input: CloudControlSetupInput): Record<string, string> {
  if (input.awsTopology?.database?.mode !== "privatelink") return {};
  return { [PRIVATELINK_PSQL_PROOF_HELPER]: renderPrivateLinkPsqlProofHelper() };
}

function renderPrivateLinkPsqlProofHelper(): string {
  return `#!/usr/bin/env node
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const args = process.argv;
const [urlFile, outFile] = args.slice(2);
if (!urlFile || !outFile) {
  console.error("usage: supabase-privatelink-psql-proof <database-url-file> <out-file>");
  process.exit(2);
}

const raw = (await readFile(urlFile, "utf8")).trim();
const parsed = new URL(raw);
const tempParent = path.join(tmpdir(), "privatelink-psql.noindex");
mkdirSync(tempParent, { recursive: true });
try {
  writeFileSync(path.join(tempParent, ".metadata_never_index"), "", { flag: "wx" });
} catch {}
const temp = mkdtempSync(path.join(tempParent, "run-"));
try {
  writeFileSync(path.join(temp, ".metadata_never_index"), "", { flag: "wx" });
} catch {}
try {
  const pgpass = path.join(temp, "pgpass");
  writeFileSync(
    pgpass,
    [parsed.hostname, parsed.port || "5432", parsed.pathname.slice(1), decodeURIComponent(parsed.username), decodeURIComponent(parsed.password)].join(":") + "\\n",
    { mode: 0o600 },
  );
  const result = spawnSync(
    "psql",
    [
      "-h",
      parsed.hostname,
      "-p",
      parsed.port || "5432",
      "-U",
      decodeURIComponent(parsed.username),
      "-d",
      parsed.pathname.slice(1),
      "-c",
      "select 1",
    ],
    {
      encoding: "utf8",
      env: {
        HOME: process.env.HOME || "",
        LANG: process.env.LANG || "C.UTF-8",
        PATH: process.env.PATH || "/usr/bin:/bin",
        PGPASSFILE: pgpass,
        PGSSLMODE: process.env.PGSSLMODE || "require",
      },
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  const proof = {
    ok: true,
    checkedAt: new Date().toISOString(),
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname.slice(1),
    query: "select 1",
    outputDigest: "sha256:" + createHash("sha256").update(result.stdout).digest("hex"),
  };
  writeFileSync(outFile, JSON.stringify(proof, null, 2) + "\\n", { mode: 0o600 });
} finally {
  rmSync(temp, { recursive: true, force: true });
}
`;
}
