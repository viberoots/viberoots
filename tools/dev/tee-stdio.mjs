// Simple stdio tee: mirrors process.stdout/stderr writes to files for test debugging
import fs from "node:fs";
import path from "node:path";
import * as childProc from "node:child_process";

function safeMkdirp(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

const root = process.env.WORKSPACE_ROOT || process.cwd();
const baseDir = process.env.TEST_LOG_DIR || path.join(root, "buck-out", "test-logs");
const testName = process.env.BUCK_TEST_TARGET || process.env.TEST_TARGET || "unknown-test";

const safeName = testName
  .replace(/^.*?\//, "")
  .replace(/[^a-zA-Z0-9._-]+/g, "_")
  .slice(0, 200);

const dir = path.join(baseDir, safeName);
safeMkdirp(dir);

const outPath = path.join(dir, "node.stdout.log");
const errPath = path.join(dir, "node.stderr.log");

let out;
let err;
try {
  out = fs.createWriteStream(outPath, { flags: "a" });
} catch {}
try {
  err = fs.createWriteStream(errPath, { flags: "a" });
} catch {}

function writeWithTimestamp(stream, buf) {
  try {
    const ts = new Date().toISOString();
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
    stream.write(`[${ts}] `);
    stream.write(b);
    if (!b.toString("utf8").endsWith("\n")) stream.write("\n");
  } catch {}
}

if (out) {
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, enc, cb) => {
    try {
      writeWithTimestamp(out, chunk);
    } catch {}
    return origWrite(chunk, enc, cb);
  };
}

if (err) {
  const origWriteErr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, enc, cb) => {
    try {
      writeWithTimestamp(err, chunk);
    } catch {}
    return origWriteErr(chunk, enc, cb);
  };
}

process.on("exit", () => {
  try {
    out?.end?.();
  } catch {}
  try {
    err?.end?.();
  } catch {}
});

// Hook child process spawning to mirror piped stdout/stderr into files per child
const childrenDir = path.join(dir, "children");
safeMkdirp(childrenDir);

function teeChild(child) {
  try {
    const pid = child?.pid || `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cOutPath = path.join(childrenDir, `${pid}.stdout.log`);
    const cErrPath = path.join(childrenDir, `${pid}.stderr.log`);
    const cOut = fs.createWriteStream(cOutPath, { flags: "a" });
    const cErr = fs.createWriteStream(cErrPath, { flags: "a" });
    const w = (s, b) => {
      try {
        const ts = new Date().toISOString();
        const buf = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
        s.write(`[${ts}] `);
        s.write(buf);
        if (!buf.toString("utf8").endsWith("\n")) s.write("\n");
      } catch {}
    };
    if (child?.stdout) child.stdout.on("data", (d) => w(cOut, d));
    if (child?.stderr) child.stderr.on("data", (d) => w(cErr, d));
    child?.on?.("exit", () => {
      try {
        cOut.end();
      } catch {}
      try {
        cErr.end();
      } catch {}
    });
  } catch {}
}

const _spawn = childProc.spawn.bind(childProc);
childProc.spawn = function patchedSpawn(cmd, args, options) {
  const ch = _spawn(cmd, args, options);
  teeChild(ch);
  return ch;
};

const _exec = childProc.exec.bind(childProc);
childProc.exec = function patchedExec(command, options, callback) {
  const ch = _exec(command, options, callback);
  teeChild(ch);
  return ch;
};

const _execFile = childProc.execFile.bind(childProc);
childProc.execFile = function patchedExecFile(file, args, options, callback) {
  const ch = _execFile(file, args, options, callback);
  teeChild(ch);
  return ch;
};

const _fork = childProc.fork.bind(childProc);
childProc.fork = function patchedFork(modulePath, args, options) {
  const ch = _fork(modulePath, args, options);
  teeChild(ch);
  return ch;
};

export {}; // keep as ESM
