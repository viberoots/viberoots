#!/usr/bin/env zx-wrapper

export async function readStructuredInstallInputFromStdin<T>(
  sourceLabel: string,
): Promise<Partial<T>> {
  if (process.stdin.isTTY) return {};
  const raw = await new Promise<string>((resolve) => {
    let done = false;
    let data = "";
    let timer: NodeJS.Timeout | undefined;
    const onData = (chunk: string | Buffer) => {
      data += String(chunk);
    };
    const onFinish = () => finish();
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
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
    timer = setTimeout(finish, 25);
    timer.unref?.();
  });
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Partial<T>;
  } catch (error) {
    throw new Error(`failed to parse ${sourceLabel} stdin JSON (${String(error)})`);
  }
}
