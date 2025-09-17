#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import crypto from "node:crypto";

export async function writeIfChanged(dst: string, data: string) {
  if (await fs.pathExists(dst)) {
    const cur = await fs.readFile(dst, "utf8");
    const a = crypto.createHash("sha256").update(cur).digest("hex");
    const b = crypto.createHash("sha256").update(data).digest("hex");
    if (a === b) {
      console.log(`no-op (already applied): ${dst}`);
      return;
    }
  }
  await fs.outputFile(dst, data, "utf8");
  console.log("wrote", dst);
}
