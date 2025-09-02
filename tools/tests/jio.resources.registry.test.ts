#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { ResourceRegistry, computeResourceMeta } from "../jio/core/resources.ts";
import { runInTemp } from "./lib/test-helpers";

describe("ResourceRegistry + meta", () => {
  test("refresh/list/get and compute etag auto", async () => {
    await runInTemp("resources-registry", async (tmp, $) => {
      const dataDir = path.join(tmp, "docs");
      const specDir = path.join(tmp, "meta");
      await fsp.mkdir(dataDir, { recursive: true });
      await fsp.mkdir(specDir, { recursive: true });
      const f = path.join(dataDir, "file.txt");
      await fsp.writeFile(f, "hello", "utf8");
      const s = path.join(specDir, "f.resource.json");
      await fsp.writeFile(
        s,
        JSON.stringify(
          {
            id: "docs.f",
            name: "F",
            file: "../docs/file.txt",
            etag: "auto",
          },
          null,
          2,
        ),
        "utf8",
      );

      const reg = new ResourceRegistry(tmp);
      await reg.refresh();
      const all = reg.list();
      if (all.length !== 1 || !reg.get("docs.f")) {
        console.error("registry did not load resource");
        process.exit(2);
      }
      const meta = await computeResourceMeta(all[0].absFilePath, { etagMode: "auto" });
      if (!meta.etag || !/^W\/"\d+-\d+"$/.test(meta.etag)) {
        console.error("unexpected etag format", meta);
        process.exit(2);
      }
    });
  });
});
