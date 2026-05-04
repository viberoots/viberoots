#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "./fs-helpers";

export type EnsureAutoSectionOptions = {
  file: string;
  begin: string;
  end: string;
  header?: string; // optional lines to place immediately after begin
  body: string; // main body content for the managed section
};

function composeAutoSection(
  begin: string,
  end: string,
  header: string | undefined,
  body: string,
): string {
  const lines: string[] = [];
  lines.push(begin);
  if (header && header.trim().length > 0) {
    lines.push(header);
    lines.push(""); // blank line between header and body
  }
  lines.push(body.trim());
  lines.push(end);
  lines.push(""); // ensure trailing newline after the section
  return lines.join("\n");
}

/**
 * Ensure a deterministically-managed section exists between begin/end markers
 * in `file`, replacing an existing section or appending a new one at the end.
 * The rest of the file is preserved verbatim.
 */
export async function ensureAutoSection(opts: EnsureAutoSectionOptions): Promise<void> {
  const targetFile = opts.file;
  // Ensure parent directory exists before we attempt to write
  await fsp.mkdir(path.dirname(targetFile), { recursive: true }).catch(() => {});

  let current = "";
  try {
    current = await fsp.readFile(targetFile, "utf8");
  } catch {
    current = "";
  }

  const section = composeAutoSection(opts.begin, opts.end, opts.header, opts.body);
  let next = current;

  if (current.includes(opts.begin) && current.includes(opts.end)) {
    // Replace existing managed block
    const pre = current.split(opts.begin)[0].replace(/\n?$/, "\n");
    const post = current.split(opts.end).slice(1).join(opts.end);
    const postClean = post.replace(/^\n*/, ""); // strip leading newlines after END
    next = pre + section + postClean;
  } else {
    // Append a new managed block at the end of the file
    const prefix = current.endsWith("\n") || current === "" ? current : current + "\n";
    next = prefix + section;
  }

  if (next !== current) {
    await writeIfChanged(targetFile, next);
  }
}
