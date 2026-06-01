import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { processWorkerOutputPaths } from "./cloud-control-runbook-evidence";
import type { RunbookCommand } from "./cloud-control-runbook";
import { RUNTIME_HTTP_SCHEMA, type RuntimeHttpCheck } from "./cloud-control-runtime-http-evidence";

const CREDENTIAL_DIR = "/run/deployment-control-plane/credentials";

export function httpCommands(input: CloudControlSetupInput, rootPrelude: string): RunbookCommand[] {
  return [
    command(
      "health",
      `${rootPrelude}; ${httpEvidenceCommand(input, "health", "/healthz")} | tee "$PROFILE_ROOT/http-health.json"`,
      ["$PROFILE_ROOT/process-service.json"],
      ["$PROFILE_ROOT/http-health.json"],
      "process liveness returns expected metadata",
    ),
    command(
      "readiness",
      `${rootPrelude}; ${httpEvidenceCommand(input, "readiness", "/readyz")} | tee "$PROFILE_ROOT/http-readiness.json"`,
      ["$PROFILE_ROOT/process-service.json", "$PROFILE_ROOT/managed-dependency-evidence.json"],
      ["$PROFILE_ROOT/http-readiness.json"],
      "database, artifact-store, and worker heartbeat readiness are ok",
    ),
    command(
      "worker-heartbeats",
      `${rootPrelude}; ${httpEvidenceCommand(input, "worker-heartbeats", "/api/v1/worker-heartbeats")} | tee "$PROFILE_ROOT/http-worker-heartbeats.json"`,
      ["$PROFILE_ROOT/process-service.json", ...processWorkerOutputPaths(input)],
      ["$PROFILE_ROOT/http-worker-heartbeats.json"],
      `at least ${input.workerReplicas} running workers report fresh heartbeats`,
    ),
  ];
}

function command(
  id: string,
  body: string,
  inputs: string[],
  outputs: string[],
  mustPass: string,
): RunbookCommand {
  return { id, command: body, cwd: "profile-root", inputs, outputs, mustPass };
}

function httpEvidenceCommand(
  input: CloudControlSetupInput,
  check: RuntimeHttpCheck,
  pathname: string,
): string {
  const expected = {
    publicUrl: input.publicUrl,
    host: new URL(input.publicUrl).host,
    hostProfile: input.mode,
    profileIdentity: profileIdentity(input),
    deploymentIds: input.deploymentIds,
    workerCount: input.workerReplicas,
  };
  return [
    `CREDENTIAL_ROOT="\${CREDENTIAL_DIR:-${CREDENTIAL_DIR}}"`,
    `VBR_HTTP_CHECK=${shellQuote(check)}`,
    `VBR_HTTP_URL=${shellQuote(url(input.publicUrl, pathname))}`,
    `VBR_HTTP_EXPECTED=${shellQuote(JSON.stringify(expected))}`,
    `node --input-type=module -e ${shellQuote(envelopeScript(check === "worker-heartbeats"))}`,
  ].join(" ");
}

function envelopeScript(authenticated: boolean): string {
  return [
    "import fs from 'node:fs';",
    "const check=process.env.VBR_HTTP_CHECK;",
    "const target=process.env.VBR_HTTP_URL;",
    "const expected=JSON.parse(process.env.VBR_HTTP_EXPECTED||'{}');",
    "const headers={'user-agent':'cloud-control-runbook-http'};",
    authenticated
      ? "const tokenFile=`${process.env.CREDENTIAL_ROOT}/control-plane-token`;headers.authorization=`Bearer ${fs.readFileSync(tokenFile,'utf8').trim()}`;"
      : "",
    "const res=await fetch(target,{headers});",
    "const text=await res.text();",
    "let body;try{body=JSON.parse(text)}catch{body={raw:text}}",
    "const deps=check==='readiness'?readinessDeps(body,expected):undefined;",
    "const out={schemaVersion:",
    JSON.stringify(RUNTIME_HTTP_SCHEMA),
    ",check,checkedAt:new Date().toISOString(),url:target,host:new URL(target).host,expected,credentialSource:",
    authenticated
      ? "{kind:'token_file',tokenFile:'control-plane-token',credentialRootEnv:'CREDENTIAL_DIR'}"
      : "{kind:'none'}",
    ",status:{ok:res.ok,httpStatus:res.status},...(deps?{dependencies:deps}:{}),body};",
    "process.stdout.write(JSON.stringify(out,null,2)+'\\n');if(!res.ok)process.exit(1);",
    "function ok(v){return v&&typeof v==='object'?{...v,ok:v.ok===true}:{ok:false}}",
    "function readinessDeps(b){return {database:ok(b.database),artifactStore:ok(b.artifactStore),workerQueueLocks:ok(b.workerQueueLocks),runtimeConfig:ok(b.runtimeConfig)}}",
  ].join("");
}

function profileIdentity(input: CloudControlSetupInput): string {
  return String(input.awsTopology?.compute?.instanceId || input.instanceId);
}

function url(publicUrl: string, pathname: string): string {
  return new URL(pathname, publicUrl.endsWith("/") ? publicUrl : `${publicUrl}/`).toString();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
