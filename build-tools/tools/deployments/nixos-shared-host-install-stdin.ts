#!/usr/bin/env zx-wrapper

export async function readStructuredInstallInputFromStdin<T>(
  sourceLabel: string,
): Promise<Partial<T>> {
  if (process.stdin.isTTY) return {};
  const raw = await new Promise<string>((resolve) => {
    let done = false;
    let data = "";
    let sawData = false;
    let idleTimer: NodeJS.Timeout | undefined;
    const onData = (chunk: string | Buffer) => {
      sawData = true;
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      data += String(chunk);
    };
    const onFinish = () => finish();
    const finish = () => {
      if (done) return;
      done = true;
      if (idleTimer) clearTimeout(idleTimer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onFinish);
      process.stdin.off("error", onFinish);
      process.stdin.pause();
      resolve(data);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.once("end", onFinish);
    process.stdin.once("error", onFinish);
    process.stdin.resume();
    idleTimer = setTimeout(() => {
      if (!sawData) finish();
    }, 250);
    idleTimer.unref?.();
  });
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Partial<T>;
  } catch (error) {
    throw new Error(`failed to parse ${sourceLabel} stdin JSON (${String(error)})`);
  }
}
