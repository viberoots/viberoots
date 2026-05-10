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

function defaultConfigPath() {
  for (const name of ["wrangler.json", "wrangler.jsonc"]) {
    const candidate = path.resolve(process.cwd(), name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

const args = process.argv.slice(2);
if (args[0] !== "pages" || args[1] !== "deploy") {
  console.error("unsupported fake wrangler command");
  process.exit(2);
}
const artifactDir = path.resolve(args[2] || "");
const projectName = flagValue("--project-name");
const branch = flagValue("--branch");
const explicitConfigPath = flagValue("--config");
const configPath = explicitConfigPath ? path.resolve(explicitConfigPath) : defaultConfigPath();
const publishRoot = process.env.VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT || "";
const logPath = process.env.VBR_CLOUDFLARE_FAKE_WRANGLER_LOG || "";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const delayMs = Number(process.env.VBR_CLOUDFLARE_FAKE_WRANGLER_DELAY_MS || "0");
if (!configPath) {
  console.error("missing wrangler config");
  process.exit(5);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (String(config.name || "") !== projectName) {
  console.error("wrangler config name mismatch");
  process.exit(3);
}
if (!publishRoot) {
  console.error("missing VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT");
  process.exit(4);
}
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
const destination = branch
  ? path.join(path.resolve(publishRoot), projectName + "--preview--" + branch)
  : path.join(path.resolve(publishRoot), projectName);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(artifactDir, destination, { recursive: true, force: true });
const url = branch
  ? "https://" + branch + "." + projectName + ".pages.dev/"
  : "https://" + projectName + ".pages.dev/";
if (logPath) {
  fs.mkdirSync(path.dirname(path.resolve(logPath)), { recursive: true });
  fs.appendFileSync(
    path.resolve(logPath),
    JSON.stringify({
      args,
      artifactDir,
      projectName,
      branch,
      cwd: process.cwd(),
      configPath,
      accountId,
      config,
      url,
    }) + "\\n",
  );
}
console.log(
  JSON.stringify({
    deploymentId: branch
      ? "cloudflare-pages-preview-" + branch
      : "cloudflare-pages-deployment-01TEST",
    projectName,
    branch,
    url,
  }),
);
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
