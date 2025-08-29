#!/usr/bin/env zx-wrapper
import Ajv from "ajv";
import fg from "fast-glob";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { toJsonSchema } from "../jio/schema/index.ts";

async function main() {
  const root = process.cwd();
  const patterns = ["**/*.tool.json"];
  const ignore = ["node_modules/**", ".git/**", "buck-out/**", "coverage/**", "dist/**"];
  const files = await fg(patterns, { cwd: root, ignore, onlyFiles: true, dot: false });
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(toJsonSchema());
  let bad = 0;
  for (const rel of files) {
    const p = path.join(root, rel);
    try {
      const txt = await fsp.readFile(p, "utf8");
      const obj = JSON.parse(txt);
      const ok = validate(obj);
      if (!ok) {
        bad++;
        console.error(`invalid spec: ${p}`);
        console.error(JSON.stringify(validate.errors?.[0] || {}, null, 2));
      }
    } catch (e: any) {
      bad++;
      console.error(`unreadable spec: ${p}: ${String(e?.message || e)}`);
    }
  }
  if (bad > 0) {
    console.error(`jio: spec lint failed: ${bad} invalid/unreadable spec(s)`);
    process.exit(78);
  } else {
    console.log("jio: all specs valid");
  }
}

await main();
