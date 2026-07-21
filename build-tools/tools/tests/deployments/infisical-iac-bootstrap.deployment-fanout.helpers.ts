import { fakeRepoBootstrapFetch } from "./sprinkleref-test-helpers";

export async function withCwd<T>(dir: string, run: () => Promise<T>) {
  const cwd = process.cwd();
  const oldEnv = { ...process.env };
  const oldFetch = globalThis.fetch;
  process.chdir(dir);
  process.env.WORKSPACE_ROOT = dir;
  process.env._VIBEROOTS_DEVSHELL_ROOT = dir;
  process.env.LIVE_ROOT = dir;
  process.env.INFISICAL_ACCESS_TOKEN = "admin-token";
  globalThis.fetch = fakeRepoBootstrapFetch as typeof fetch;
  try {
    return await run();
  } finally {
    process.chdir(cwd);
    process.env = oldEnv;
    globalThis.fetch = oldFetch;
  }
}

export async function captureConsoleEvents(run: (event: (text: string) => void) => Promise<void>) {
  const originalLog = console.log;
  const originalError = console.error;
  const events: string[] = [];
  const event = (value?: unknown) => events.push(String(value));
  console.log = event;
  console.error = event;
  try {
    await run(event);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return events;
}

export async function captureConsole(
  run: () => Promise<void>,
  hooks: { stdout?: (value: unknown) => void; stderr?: (value: unknown) => void } = {},
) {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (value?: unknown) => {
    hooks.stdout?.(value);
    stdout.push(String(value));
  };
  console.error = (value?: unknown) => {
    hooks.stderr?.(value);
    stderr.push(String(value));
  };
  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}
