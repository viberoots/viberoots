{ lib }:
{
  pyodideRunner = { msg, runtimeDir }:
    let msgJson = builtins.toJSON msg;
    in ''
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const msg = ${msgJson};
console.log(msg);

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "site");
const appDir = path.resolve(here, "..", "app");
const mainPath = path.join(appDir, "bin", "__main__.py");
await fs.access(mainPath);

const runtimeDirRaw = "${runtimeDir}";
const runtimeDir = (() => {
  const marker = runtimeDirRaw.indexOf("file:");
  if (marker !== -1) {
    return fileURLToPath(runtimeDirRaw.slice(marker));
  }
  return runtimeDirRaw;
})();
const pyodideUrl = pathToFileURL(path.join(runtimeDir, "pyodide.mjs")).href;
let indexURL = path.resolve(runtimeDir) + path.sep;
if (indexURL.includes("file:")) {
  indexURL = fileURLToPath(indexURL.slice(indexURL.indexOf("file:"))) + path.sep;
}

const { loadPyodide } = await import(pyodideUrl);
const baseFetch = globalThis.fetch.bind(globalThis);
const fileFetch = async (url, init) => {
  const target = typeof url === "string" ? url : url?.url || String(url);
  let filePath = null;
  if (target.startsWith("file:/")) {
    filePath = target.slice("file:".length);
  } else if (target.startsWith("file:")) {
    filePath = fileURLToPath(target);
  } else if (target.includes("file:")) {
    filePath = fileURLToPath(target.slice(target.indexOf("file:")));
  } else if (path.isAbsolute(target)) {
    filePath = target;
  }
  if (filePath) {
    const buf = await fs.readFile(filePath);
    return new Response(buf);
  }
  return baseFetch(target, init);
};

const pyodide = await loadPyodide({ indexURL, fetch: fileFetch });
pyodide.FS.mkdir("/site");
pyodide.FS.mount(pyodide.FS.filesystems.NODEFS, { root: siteDir }, "/site");
pyodide.FS.mkdir("/app");
pyodide.FS.mount(pyodide.FS.filesystems.NODEFS, { root: appDir }, "/app");

await pyodide.runPythonAsync(
  'import sys, runpy; sys.path.insert(0, "/site"); runpy.run_path("/app/bin/__main__.py", run_name="__main__")',
);
'';

  wasiRunner = { msg, runtimeDir }:
    let msgJson = builtins.toJSON msg;
    in ''
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WASI } from "node:wasi";

const msg = ${msgJson};
console.log(msg);

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..", "site");
const appDir = path.resolve(here, "..", "app");
const mainPath = path.join(appDir, "bin", "__main__.py");
await fs.access(mainPath);

const runtimeDir = "${runtimeDir}";
const wasmPath = path.join(runtimeDir, "bin", "python.wasm");
const args = ["python", "/app/bin/__main__.py"];
const env = {
  PYTHONHOME: "/usr/local",
  PYTHONPATH: "/site",
};

const wasi = new WASI({
  version: "preview1",
  args,
  env,
  preopens: {
    "/site": siteDir,
    "/app": appDir,
    "/usr": path.join(runtimeDir, "usr"),
  },
});

const bytes = await fs.readFile(wasmPath);
const module = await WebAssembly.compile(bytes);
const instance = await WebAssembly.instantiate(module, {
  wasi_snapshot_preview1: wasi.wasiImport,
});
const status = wasi.start(instance);
if (typeof status === "number" && status !== 0) {
  process.exit(status);
}
'';
}
