#!/usr/bin/env zx-wrapper

type AsyncVoid = () => Promise<void>;

export async function runSession(
  onApply: AsyncVoid,
  onReset: AsyncVoid,
  onInterrupt: AsyncVoid = onReset,
): Promise<void> {
  // Non-interactive mode for tests: honor PATCH_SESSION_AUTO=apply|reset
  const mode = String(process.env.PATCH_SESSION_AUTO || "")
    .trim()
    .toLowerCase();
  if (mode === "apply") {
    await onApply();
    return;
  }
  if (mode === "reset") {
    await onReset();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.off("SIGINT", handleInterrupt);
      process.off("SIGTERM", handleInterrupt);
      try {
        process.stdin.setRawMode?.(false);
      } catch {}
      process.stdin.pause();
    };
    const finish = async (action: AsyncVoid, rejectOnSuccess = false) => {
      if (settled) return;
      settled = true;
      try {
        await action();
        cleanup();
        if (rejectOnSuccess) reject(new Error("patch session interrupted"));
        else resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onData = (buf: Buffer) => {
      const s = buf.toString("utf8");
      if (s === "\u0004") void finish(onApply);
      else if (s === "\u0003") void finish(onReset);
    };
    const handleInterrupt = () => void finish(onInterrupt, true);
    try {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
    } catch {}
    process.stdin.on("data", onData);
    process.once("SIGINT", handleInterrupt);
    process.once("SIGTERM", handleInterrupt);
    console.log("Attached. Ctrl-D to apply, Ctrl-C to reset.");
  });
}
