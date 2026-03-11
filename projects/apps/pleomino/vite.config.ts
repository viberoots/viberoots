import * as fsp from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

type WasmModuleManifest = {
  modules?: Array<{
    sourcePath?: string;
    runtimeDestinations?: { server?: string };
  }>;
};

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../../..");
const defaultHost = process.env.HOST || "0.0.0.0";
const defaultPort = Number(process.env.PORT || "5173");

function readPackageJson(pkgPath: string): PackageJson {
  try {
    return JSON.parse(fsp.readFileSync(pkgPath, "utf8")) as PackageJson;
  } catch {
    return {};
  }
}

function workspaceDependencyNames(pkg: PackageJson): string[] {
  const specs = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
  return Object.entries(specs)
    .filter(([, spec]) => {
      return spec.startsWith("workspace:") || spec.startsWith("link:") || spec.startsWith("file:");
    })
    .map(([name]) => name)
    .sort();
}

const optimizeDepsExclude = workspaceDependencyNames(
  readPackageJson(path.join(appRoot, "package.json")),
);
const optimizeDepsInclude = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-native-web",
];

function copyServerWasmContracts(outDir: string) {
  const manifestPath = path.join(appRoot, "src", "wasm-modules.manifest.json");
  if (!fsp.existsSync(manifestPath)) {
    return;
  }
  let manifest: WasmModuleManifest;
  try {
    manifest = JSON.parse(fsp.readFileSync(manifestPath, "utf8")) as WasmModuleManifest;
  } catch {
    return;
  }
  for (const entry of manifest.modules ?? []) {
    const sourcePath = String(entry.sourcePath ?? "").trim();
    const serverDest = String(entry.runtimeDestinations?.server ?? "").trim();
    if (!sourcePath || !serverDest) {
      continue;
    }
    const sourceAbs = path.resolve(appRoot, sourcePath);
    if (!fsp.existsSync(sourceAbs)) {
      continue;
    }
    const outAbs = path.resolve(appRoot, outDir, serverDest);
    fsp.mkdirSync(path.dirname(outAbs), { recursive: true });
    fsp.copyFileSync(sourceAbs, outAbs);
  }
}

function serverWasmContractPlugin(isSsrBuild: boolean) {
  let outDir = "dist/server";
  return {
    name: "pleomino-server-wasm-contract",
    apply: "build" as const,
    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      if (!isSsrBuild) {
        return;
      }
      copyServerWasmContracts(outDir);
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  appType: "custom",
  clearScreen: false,
  logLevel: "info",
  build: {
    target: "es2022",
    sourcemap: false,
    cssMinify: true,
    rollupOptions: isSsrBuild
      ? undefined
      : {
          input: "src/entry-client.ts",
          output: {
            entryFileNames: "entry-client.js",
            assetFileNames: "assets/[name][extname]",
          },
        },
  },
  worker: {
    format: "es",
  },
  server: {
    strictPort: true,
    host: defaultHost,
    port: defaultPort,
    preTransformRequests: false,
    fs: {
      allow: [workspaceRoot],
    },
  },
  cacheDir: ".vite-cache",
  optimizeDeps: {
    noDiscovery: true,
    include: optimizeDepsInclude,
    exclude: optimizeDepsExclude,
  },
  ssr: {
    noExternal: optimizeDepsExclude,
  },
  plugins: [serverWasmContractPlugin(Boolean(isSsrBuild))],
}));
