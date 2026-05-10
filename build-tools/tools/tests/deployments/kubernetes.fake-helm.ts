#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

const SCRIPT = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args[0] !== "upgrade" || args[1] !== "--install") {
  console.error("unsupported fake helm command");
  process.exit(2);
}
const release = String(args[2] || "");
const chart = String(args[3] || "");
const namespace = String(args[args.indexOf("--namespace") + 1] || "");
const cluster = String(args[args.indexOf("--kube-context") + 1] || "");
const renderedConfigPath = String(args[args.indexOf("--values") + 1] || process.env.VBR_KUBERNETES_RENDERED_CONFIG || "");
const componentId = String(process.env.VBR_KUBERNETES_COMPONENT_ID || "");
const artifactPath = String(process.env.VBR_KUBERNETES_COMPONENT_ARTIFACT || "");
const publishRoot = String(process.env.VBR_KUBERNETES_FAKE_PUBLISH_ROOT || "");
const logPath = String(process.env.VBR_KUBERNETES_FAKE_HELM_LOG || "");
if (!publishRoot || !renderedConfigPath || !componentId || !artifactPath) {
  console.error("missing fake helm inputs");
  process.exit(3);
}
const rendered = JSON.parse(fs.readFileSync(renderedConfigPath, "utf8"));
const targetDir = path.join(path.resolve(publishRoot), namespace, release);
fs.mkdirSync(path.join(targetDir, "components"), { recursive: true });
const componentTarget = path.join(targetDir, "components", componentId);
fs.rmSync(componentTarget, { recursive: true, force: true });
fs.cpSync(path.resolve(artifactPath), componentTarget, { recursive: true, force: true });
const releaseStatePath = path.join(targetDir, "release-state.json");
const prior = fs.existsSync(releaseStatePath)
  ? JSON.parse(fs.readFileSync(releaseStatePath, "utf8"))
  : { release, namespace, cluster, chart, components: {} };
prior.cluster = cluster;
prior.namespace = namespace;
prior.release = release;
prior.chart = chart;
prior.components[componentId] = {
  artifactPath: path.resolve(artifactPath),
  artifactIdentity: rendered.component_artifacts?.[componentId]?.identity || "",
};
fs.writeFileSync(releaseStatePath, JSON.stringify(prior, null, 2) + "\\n");
if (logPath) {
  fs.mkdirSync(path.dirname(path.resolve(logPath)), { recursive: true });
  fs.appendFileSync(
    path.resolve(logPath),
    JSON.stringify({ args, componentId, artifactPath, renderedConfigPath }) + "\\n",
  );
}
if (process.env.VBR_KUBERNETES_FAKE_HELM_FAIL_COMPONENT === componentId) {
  console.error("fake helm publish failure");
  process.exit(4);
}
console.log(
  JSON.stringify({
    providerReleaseId: \`helm-release:\${cluster}/\${namespace}/\${release}#component:\${componentId}\`,
  }),
);
`;

export async function installFakeKubernetesHelm(tmp: string): Promise<{
  binDir: string;
  publishRoot: string;
  logPath: string;
}> {
  const binDir = path.join(tmp, "bin");
  const publishRoot = path.join(tmp, "published");
  const logPath = path.join(tmp, "helm.log");
  const scriptPath = path.join(binDir, "helm");
  await fsp.mkdir(binDir, { recursive: true });
  await fsp.writeFile(scriptPath, SCRIPT, { encoding: "utf8", mode: 0o755 });
  return { binDir, publishRoot, logPath };
}
