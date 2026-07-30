import * as fsp from "node:fs/promises";
import path from "node:path";
import { runManagedCommand } from "../../lib/managed-command";
import { languageUpdateTimeoutMs } from "../update-command/languages";

export async function assertCargoConfigIsolation(
  cargoRoot: string,
  cargoHome: string,
): Promise<void> {
  const candidates = [path.join(cargoHome, "config"), path.join(cargoHome, "config.toml")];
  for (let current = path.resolve(cargoRoot); ; current = path.dirname(current)) {
    candidates.push(path.join(current, ".cargo/config"), path.join(current, ".cargo/config.toml"));
    if (path.dirname(current) === current) break;
  }
  for (const candidate of candidates) {
    const exists = await fsp.access(candidate).then(
      () => true,
      () => false,
    );
    if (exists) {
      throw new Error(
        `Rust Cargo configuration is unsupported because it can replace dependency sources: ${candidate}`,
      );
    }
  }
}

function redactedCargoStderr(stderr: string): string {
  return stderr
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+(?::[^/@\s]*)?@)/giu, "$1[redacted]@")
    .replace(
      /(access[_-]?token|api[_-]?key|authorization|credential|password|secret|token)(["'\s:=]+)[^"'\s,}]+/giu,
      "$1$2[redacted]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/giu, "Bearer [redacted]");
}

export async function runCargo(
  cargoBin: string,
  args: string[],
  cwd: string,
  workspaceRoot: string,
  offline = true,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const commandEnv = { ...env };
  for (const key of Object.keys(commandEnv)) {
    if (key.startsWith("CARGO_") || ["RUSTC", "RUSTFLAGS", "RUSTUP_HOME"].includes(key)) {
      delete commandEnv[key];
    }
  }
  const cargoHome = path.join(workspaceRoot, ".viberoots", "workspace", "cargo-home");
  await assertCargoConfigIsolation(cwd, cargoHome);
  await fsp.mkdir(cargoHome, { recursive: true });
  const result = await runManagedCommand({
    command: cargoBin,
    args,
    cwd,
    env: {
      ...commandEnv,
      PATH: path.dirname(cargoBin),
      CARGO_HOME: cargoHome,
      ...(offline ? { CARGO_NET_OFFLINE: "true" } : {}),
    },
    timeoutMs: languageUpdateTimeoutMs(env),
  });
  if (result.ok && !result.interrupted) return result.stdout;
  const reason = result.timedOut
    ? `timed out after ${languageUpdateTimeoutMs(env) / 1000}s`
    : result.interrupted
      ? "was interrupted"
      : `exited ${String(result.code)}`;
  throw new Error(
    `cargo ${args.join(" ")} ${reason} in ${cwd}\n${redactedCargoStderr(result.stderr)}`.trim(),
  );
}
