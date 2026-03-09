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

// HMR configuration for reverse proxy scenarios
function getHmrConfig() {
  const isProxyAccess = process.env.HOST && !process.env.HOST.startsWith("0.");
  return {
    protocol: (isProxyAccess || process.env.VITE_HMR_URL) ? "wss" : undefined,
    host: process.env.HMR_HOST || (isProxyAccess ? "local-5174.home.kilty.io" : undefined),
    port: Number(process.env.HMR_PORT) || 443,
    clientPort: Number(process.env.HMR_CLIENT_PORT) || (Number(process.env.HMR_PORT) || 443),
    clientUrl: process.env.VITE_HMR_URL || (isProxyAccess ? "wss://local-5174.home.kilty.io:443" : undefined),
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
  server: {
    strictPort: true,
    host: process.env.HOST || "0.0.0.0",
    port: 5173,
    preTransformRequests: false,
    allowedHosts: ["local-5173.home.kilty.io"],
    hmr: getHmrConfig(),
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
