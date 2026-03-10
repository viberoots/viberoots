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
}));
