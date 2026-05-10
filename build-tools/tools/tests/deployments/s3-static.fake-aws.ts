#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

const SCRIPT = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args[0] !== "s3" || args[1] !== "sync") {
  console.error("unsupported fake aws command");
  process.exit(2);
}
const artifactDir = path.resolve(args[2] || "");
const destinationArg = String(args[3] || "");
const bucket = destinationArg.replace(/^s3:\\/\\//, "");
const publishRoot = process.env.VBR_S3_STATIC_FAKE_PUBLISH_ROOT || "";
const logPath = process.env.VBR_S3_STATIC_FAKE_AWS_LOG || "";
const configPath = process.env.VBR_S3_STATIC_RENDERED_CONFIG || "";
if (!publishRoot) {
  console.error("missing VBR_S3_STATIC_FAKE_PUBLISH_ROOT");
  process.exit(3);
}
const config = configPath ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
if (String(config.bucket || "") !== bucket) {
  console.error("s3 config bucket mismatch");
  process.exit(4);
}
const destination = path.join(path.resolve(publishRoot), bucket);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(artifactDir, destination, { recursive: true, force: true });
if (logPath) {
  fs.mkdirSync(path.dirname(path.resolve(logPath)), { recursive: true });
  fs.appendFileSync(
    path.resolve(logPath),
    JSON.stringify({ args, artifactDir, bucket, configPath, config }) + "\\n",
  );
}
if (process.env.VBR_S3_STATIC_FAKE_AMBIGUOUS_RESULT === "1") {
  console.error("ambiguous publish result after sync");
  process.exit(5);
}
console.log(JSON.stringify({ syncId: "s3-sync-01TEST", bucket }));
`;

export async function installFakeS3StaticAwsCli(tmp: string): Promise<{
  binDir: string;
  publishRoot: string;
  logPath: string;
}> {
  const binDir = path.join(tmp, "bin");
  const publishRoot = path.join(tmp, "published");
  const logPath = path.join(tmp, "aws.log");
  const scriptPath = path.join(binDir, "aws");
  await fsp.mkdir(binDir, { recursive: true });
  await fsp.writeFile(scriptPath, SCRIPT, { encoding: "utf8", mode: 0o755 });
  return { binDir, publishRoot, logPath };
}
