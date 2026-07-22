import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type RemoteBuilderEndpoint = {
  schema: "viberoots.remote-builder-endpoint.v2";
  host: string;
  port: number;
  protocol: "ssh-ng";
  user: string;
  hostKey: {
    algorithm: "ssh-ed25519";
    publicKey: string;
    fingerprint: `SHA256:${string}`;
  };
};

export type RemoteBuilderTransport = {
  schema: "viberoots.remote-builder-ssh-transport.v2";
  builderUri: string;
  credentialFreeBuilderUri: string;
  sshKeyFile: string;
};

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i]))
    throw new Error(`${name} has invalid fields: ${actual.join(", ")}`);
}

export function parseRemoteBuilderEndpoint(value: unknown): RemoteBuilderEndpoint {
  const endpoint = record(value, "remote builder endpoint");
  exact(endpoint, ["host", "hostKey", "port", "protocol", "schema", "user"], "endpoint");
  if (endpoint.schema !== "viberoots.remote-builder-endpoint.v2" || endpoint.protocol !== "ssh-ng")
    throw new Error("remote builder endpoint requires the v2 ssh-ng schema");
  const host = String(endpoint.host || "");
  if (!/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])$/u.test(host))
    throw new Error("remote builder endpoint requires a credential-free immutable host");
  const port = Number(endpoint.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("remote builder endpoint requires a valid port");
  const user = String(endpoint.user || "");
  if (!/^[a-z_][a-z0-9_-]*$/u.test(user))
    throw new Error("remote builder endpoint requires a reviewed SSH user");
  const hostKey = record(endpoint.hostKey, "remote builder SSH host key");
  exact(hostKey, ["algorithm", "fingerprint", "publicKey"], "SSH host key");
  const publicKey = String(hostKey.publicKey || "");
  const decoded = Buffer.from(publicKey, "base64");
  const fingerprint = `SHA256:${crypto
    .createHash("sha256")
    .update(decoded)
    .digest("base64")
    .replace(/=+$/u, "")}`;
  if (
    hostKey.algorithm !== "ssh-ed25519" ||
    decoded.length !== 51 ||
    decoded.toString("base64").replace(/=+$/u, "") !== publicKey.replace(/=+$/u, "") ||
    !publicKey.startsWith("AAAAC3NzaC1lZDI1NTE5AAAAI") ||
    hostKey.fingerprint !== fingerprint
  )
    throw new Error("remote builder SSH host-key fingerprint is invalid");
  return {
    schema: endpoint.schema,
    protocol: endpoint.protocol,
    host,
    port,
    user,
    hostKey: {
      algorithm: hostKey.algorithm,
      publicKey,
      fingerprint: fingerprint as `SHA256:${string}`,
    },
  };
}

export function parseRemoteBuilderTransportFile(
  file: string,
  endpoint: RemoteBuilderEndpoint,
): RemoteBuilderTransport {
  if (!path.isAbsolute(file) || file.startsWith("/nix/store/"))
    throw new Error("remote builder SSH transport requires an external absolute path");
  const text = readOwnerMode0600(file, "remote builder SSH transport", true);
  const transport = record(JSON.parse(text), "remote builder SSH transport");
  exact(transport, ["builderUri", "schema"], "remote builder SSH transport");
  if (transport.schema !== "viberoots.remote-builder-ssh-transport.v2")
    throw new Error("remote builder SSH transport requires v2");
  const builderUri = String(transport.builderUri || "");
  let uri: URL;
  try {
    uri = new URL(builderUri);
  } catch {
    throw new Error("remote builder SSH transport has an invalid builder URI");
  }
  if (
    uri.protocol !== "ssh-ng:" ||
    decodeURIComponent(uri.username) !== endpoint.user ||
    Boolean(uri.password) ||
    uri.hostname !== endpoint.host.replace(/^\[|\]$/gu, "") ||
    Number(uri.port || 22) !== endpoint.port ||
    !["", "/"].includes(uri.pathname) ||
    Boolean(uri.hash)
  )
    throw new Error("runtime SSH transport does not match the exact reviewed endpoint");
  const queryKeys = [...uri.searchParams.keys()].sort();
  if (queryKeys.length !== 1 || queryKeys[0] !== "ssh-key")
    throw new Error("runtime SSH transport requires only one external SSH key authority");
  const sshKey = uri.searchParams.get("ssh-key") || "";
  if (!path.isAbsolute(sshKey) || sshKey.startsWith("/nix/store/"))
    throw new Error("runtime SSH transport requires an external absolute SSH key path");
  if (!/^\/[A-Za-z0-9/._-]+$/u.test(sshKey))
    throw new Error("runtime SSH transport requires a shell-safe SSH key path");
  readOwnerMode0600(sshKey, "remote builder SSH key", false);
  const authorityHost = endpoint.host.startsWith("[") ? endpoint.host : endpoint.host;
  const port = endpoint.port === 22 ? "" : `:${endpoint.port}`;
  return {
    schema: transport.schema,
    builderUri,
    credentialFreeBuilderUri: `${endpoint.protocol}://${endpoint.user}@${authorityHost}${port}`,
    sshKeyFile: sshKey,
  };
}

export function installReviewedSshHostAuthority(
  env: NodeJS.ProcessEnv,
  endpoint: RemoteBuilderEndpoint,
): NodeJS.ProcessEnv {
  const home = String(env.HOME || "");
  if (!path.isAbsolute(home))
    throw new Error("reviewed SSH host authority requires canonical HOME");
  const sshRoot = path.join(home, ".ssh");
  fs.mkdirSync(sshRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(sshRoot, 0o700);
  const host = endpoint.port === 22 ? endpoint.host : `[${endpoint.host}]:${endpoint.port}`;
  const keyId = endpoint.hostKey.fingerprint.slice(7).replace(/[^A-Za-z0-9._-]/gu, "_");
  const knownHosts = path.join(sshRoot, `known-hosts-${keyId}`);
  fs.writeFileSync(
    knownHosts,
    `${host} ${endpoint.hostKey.algorithm} ${endpoint.hostKey.publicKey}\n`,
    { mode: 0o600 },
  );
  return {
    ...env,
    NIX_SSHOPTS: `-oStrictHostKeyChecking=yes -oUserKnownHostsFile=${knownHosts} -oGlobalKnownHostsFile=/dev/null -oIdentitiesOnly=yes`,
  };
}

export function installReviewedSshTransportAuthority(
  env: NodeJS.ProcessEnv,
  endpoint: RemoteBuilderEndpoint,
  sshKeyFile: string,
): NodeJS.ProcessEnv {
  if (!/^\/[A-Za-z0-9/._-]+$/u.test(sshKeyFile))
    throw new Error("reviewed SSH transport requires a shell-safe absolute key path");
  readOwnerMode0600(sshKeyFile, "remote builder SSH key", false);
  const withHostAuthority = installReviewedSshHostAuthority(env, endpoint);
  return {
    ...withHostAuthority,
    NIX_SSHOPTS: `${withHostAuthority.NIX_SSHOPTS} -oIdentityFile=${sshKeyFile}`,
  };
}

function readOwnerMode0600(file: string, name: string, read: true): string;
function readOwnerMode0600(file: string, name: string, read: false): undefined;
function readOwnerMode0600(file: string, name: string, read: boolean): string | undefined {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    throw new Error(`${name} must be a regular nofollow mode-0600 file`);
  }
  try {
    const stat = fs.fstatSync(fd);
    const uid = process.getuid?.();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || (uid !== undefined && stat.uid !== uid))
      throw new Error(`${name} must be an owner-controlled mode-0600 file`);
    return read ? fs.readFileSync(fd, "utf8") : undefined;
  } finally {
    fs.closeSync(fd);
  }
}
