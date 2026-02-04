#!/usr/bin/env zx-wrapper

type AsyncVoid = () => Promise<void>;

export async function runSession(onApply: AsyncVoid, onReset: AsyncVoid): Promise<void> {
  // Non-interactive mode for tests: honor PATCH_SESSION_AUTO=apply|reset
  try {
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
  } catch {}

  console.log("Attached. Ctrl-D to apply, Ctrl-C to reset.");
  await new Promise<void>((resolve, reject) => {
    try {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
    } catch {}
    process.stdin.on("data", async (buf: Buffer) => {
      const s = buf.toString("utf8");
      if (s === "\u0004") {
        try {
          await onApply();
          resolve();
        } catch (e) {
          reject(e);
        }
      } else if (s === "\u0003") {
        try {
          await onReset();
          resolve();
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}
