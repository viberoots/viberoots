import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const officialBootstrapUrl =
  "https://raw.githubusercontent.com/viberoots/viberoots/main/bootstrap";

export type LiveBootstrapCommand = "bootstrap" | "update";

export type LiveBootstrapOptions = {
  command: LiveBootstrapCommand;
  bootstrapUrl?: string;
  trustBootstrapUrl?: boolean;
  envOverrides?: Record<string, string>;
  deps?: LiveBootstrapDeps;
};

export type LiveBootstrapDeps = {
  fetchText?: (url: string) => Promise<string>;
  runCommand?: (command: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => Promise<void>;
  mkdtemp?: typeof fsp.mkdtemp;
  writeFile?: typeof fsp.writeFile;
  rm?: typeof fsp.rm;
  tmpdir?: () => string;
};

function isOfficialUrl(url: string): boolean {
  return url === officialBootstrapUrl;
}

async function defaultFetchText(url: string): Promise<string> {
  if (url.startsWith("file://")) {
    return await fsp.readFile(new URL(url), "utf8");
  }
  if (/^https?:\/\//.test(url)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`fetch failed with HTTP ${response.status}`);
    }
    return await response.text();
  }
  return await fsp.readFile(url, "utf8");
}

function validateBootstrapScript(script: string): void {
  if (!script.trim()) {
    throw new Error("error: fetched bootstrap script was empty");
  }
  if (!script.startsWith("#!") && !script.includes("viberoots bootstrap")) {
    throw new Error("error: fetched bootstrap script did not look like a shell bootstrap script");
  }
}

async function defaultRunCommand(
  command: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: opts.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `${command} exited after signal ${signal}`
            : `${command} exited with status ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

export async function runLiveBootstrap(opts: LiveBootstrapOptions): Promise<void> {
  const url = opts.bootstrapUrl || officialBootstrapUrl;
  if (!isOfficialUrl(url) && !opts.trustBootstrapUrl) {
    throw new Error(
      "error: refusing custom bootstrap URL without --trust-bootstrap-url; custom bootstrap URLs can run non-viberoots code during setup",
    );
  }

  const deps = opts.deps || {};
  const fetchText = deps.fetchText || defaultFetchText;
  const runCommand = deps.runCommand || defaultRunCommand;
  const mkdtemp = deps.mkdtemp || fsp.mkdtemp;
  const writeFile = deps.writeFile || fsp.writeFile;
  const rm = deps.rm || fsp.rm;
  const tmpdir = deps.tmpdir || os.tmpdir;

  const source =
    url === officialBootstrapUrl
      ? "latest bootstrap script from GitHub main"
      : `bootstrap script from ${url}`;
  console.error(`viberoots ${opts.command}: running ${source}`);

  let script = "";
  try {
    script = await fetchText(url);
  } catch (error) {
    if (url === officialBootstrapUrl) {
      throw new Error(
        `error: could not fetch viberoots bootstrap from GitHub main: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  }
  validateBootstrapScript(script);

  const dir = await mkdtemp(path.join(tmpdir(), "viberoots-bootstrap-"));
  const scriptPath = path.join(dir, "bootstrap");
  try {
    await writeFile(scriptPath, script, { mode: 0o700 });
    await runCommand("bash", [scriptPath], {
      env: {
        ...process.env,
        ...(opts.envOverrides || {}),
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
