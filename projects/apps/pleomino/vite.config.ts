import * as fsp from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
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
function staticPwaPrecachePlugin() {
  let outDir = "dist";
  return {
    name: "pleomino-static-pwa-precache",
    apply: "build" as const,
    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      execFileSync(
        "zx-wrapper",
        [
          "../../../build-tools/tools/dev/materialize-static-pwa-precache.ts",
          "--client-dir",
          path.resolve(appRoot, outDir),
          "--cache-version-prefix",
          "pleomino",
        ],
        {
          cwd: appRoot,
          stdio: "inherit",
        },
      );
    },
  };
}

export default defineConfig({
  appType: "spa",
  clearScreen: false,
  logLevel: "info",
  build: {
    target: "es2022",
    sourcemap: false,
    cssMinify: true,
    rollupOptions: {
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
  plugins: [staticPwaPrecachePlugin()],
});
