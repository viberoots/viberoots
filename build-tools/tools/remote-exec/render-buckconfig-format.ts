import crypto from "node:crypto";
import path from "node:path";
import type { RemoteBuckConfigInput, RemoteBuckConfigResult } from "./render-buckconfig-model";
import {
  validateRemoteBuckConfigInput,
  validateRenderedBuckConfigKeys,
} from "./render-buckconfig-validate";

const generatedFileName = ".buckconfig.remote.generated";

export function renderRemoteBuckconfigText(input: RemoteBuckConfigInput): string {
  validateRemoteBuckConfigInput(input);
  const lines = [
    "[buck2_re_client]",
    `engine_address = ${input.engineAddress}`,
    `cas_address = ${input.casAddress}`,
    `action_cache_address = ${input.actionCacheAddress}`,
    `instance_name = ${input.instanceName}`,
    ...authLines(input),
    "",
    "[build]",
    "execution_platforms = toolchains//:remote_execution_platforms",
    "",
  ];
  const text = lines.join("\n");
  validateRenderedBuckConfigKeys(text);
  return text;
}

export function summarizeRemoteBuckconfig(
  input: RemoteBuckConfigInput,
  configText: string,
): RemoteBuckConfigResult {
  const fingerprint = fingerprintConfig(configText);
  return {
    configPath: path.join(input.artifactDir, generatedFileName),
    configText,
    fingerprint,
    summary: `fingerprint=${fingerprint}`,
  };
}

export function fingerprintConfig(configText: string): string {
  return `sha256:${crypto.createHash("sha256").update(configText).digest("hex")}`;
}

export function redactSecretLike(text: string): string {
  return text
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/((?:token|secret|api[_-]?key|password)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/g, "[REDACTED_PEM]");
}

function authLines(input: RemoteBuckConfigInput): string[] {
  if (input.auth.mode === "headers") {
    return [`http_headers = ${JSON.stringify(input.auth.httpHeaders)}`];
  }
  return [
    "[buck2_re_client.tls]",
    `tls_ca_certs = ${input.auth.caCerts}`,
    `tls_client_cert = ${input.auth.clientCert}`,
    `tls_client_key = ${input.auth.clientKey}`,
  ];
}
