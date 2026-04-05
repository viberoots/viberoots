#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

const SCRIPT = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function flagValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

const args = process.argv.slice(2);
if (args[0] !== "pages" || args[1] !== "deploy") {
  console.error("unsupported fake wrangler command");
  process.exit(2);
}
const artifactDir = path.resolve(args[2] || "");
const projectName = flagValue("--project-name");
const configPath = path.resolve(flagValue("--config"));
const publishRoot = process.env.BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT || "";
const logPath = process.env.BNX_CLOUDFLARE_FAKE_WRANGLER_LOG || "";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (String(config.name || "") !== projectName) {
  console.error("wrangler config name mismatch");
  process.exit(3);
}
if (!publishRoot) {
  console.error("missing BNX_CLOUDFLARE_FAKE_PUBLISH_ROOT");
  process.exit(4);
}
const destination = path.join(path.resolve(publishRoot), projectName);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(artifactDir, destination, { recursive: true, force: true });
if (logPath) {
  fs.mkdirSync(path.dirname(path.resolve(logPath)), { recursive: true });
  fs.appendFileSync(
    path.resolve(logPath),
    JSON.stringify({
      args,
      artifactDir,
      projectName,
      configPath,
      accountId,
      config,
    }) + "\\n",
  );
}
console.log(JSON.stringify({ deploymentId: "cloudflare-pages-deployment-01TEST", projectName }));
`;

export async function installFakeCloudflarePagesWrangler(tmp: string): Promise<{
  binDir: string;
  publishRoot: string;
  logPath: string;
}> {
  const binDir = path.join(tmp, "bin");
  const publishRoot = path.join(tmp, "published");
  const logPath = path.join(tmp, "wrangler.log");
  const scriptPath = path.join(binDir, "wrangler");
  await fsp.mkdir(binDir, { recursive: true });
  await fsp.writeFile(scriptPath, SCRIPT, { encoding: "utf8", mode: 0o755 });
  return { binDir, publishRoot, logPath };
}
