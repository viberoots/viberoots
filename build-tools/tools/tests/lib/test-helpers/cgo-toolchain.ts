import "./worker-init";
import path from "node:path";
import { timeAsync } from "./timing";

export type CgoToolchainPaths = {
  clang: string;
  clangxx: string;
  xcrun: string;
  ar: string;
};

const XCRUN_SHOW_SDK_PATH_LABEL = "xcrun --show-sdk-path";
const TOOLCHAIN_PROBE_LABEL =
  "toolchain probe (command -v cviberoots/build-tools/lang/clang++/xcrun/llvm-ar/ar)";

let cachedDarwinSdkPath: string | null = null;
let cachedDarwinSdkPathPromise: Promise<string | null> | null = null;

let cachedCgoToolchainPaths: CgoToolchainPaths | null = null;
let cachedCgoToolchainPathsPromise: Promise<CgoToolchainPaths | null> | null = null;

export async function getDarwinSdkPathOncePerWorker($: any): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  if (cachedDarwinSdkPath !== null) return cachedDarwinSdkPath;

  if (!cachedDarwinSdkPathPromise) {
    cachedDarwinSdkPathPromise = (async () => {
      try {
        const { stdout } = await timeAsync(XCRUN_SHOW_SDK_PATH_LABEL, async () => {
          return await $({ stdio: "pipe" })`xcrun --show-sdk-path`.nothrow();
        });
        cachedDarwinSdkPath = String(stdout || "").trim() || "";
      } catch {
        cachedDarwinSdkPath = "";
      }
      return cachedDarwinSdkPath || null;
    })();
  }

  return await cachedDarwinSdkPathPromise;
}

export async function getCgoToolchainPathsOncePerWorker($: any): Promise<CgoToolchainPaths | null> {
  if (cachedCgoToolchainPaths) return cachedCgoToolchainPaths;

  if (!cachedCgoToolchainPathsPromise) {
    cachedCgoToolchainPathsPromise = (async () => {
      try {
        return await timeAsync(TOOLCHAIN_PROBE_LABEL, async () => {
          const which = async (cmd: string): Promise<string> => {
            const out = await $({ stdio: "pipe" })`command -v ${cmd}`.nothrow();
            return String(out.stdout || "").trim();
          };
          const clang = await which("clang");
          if (!clang) return null;
          const clangxx = (await which("clang++")) || clang;
          const xcrun = (process.platform === "darwin" ? await which("xcrun") : "") || "";
          const llvmAr = await which("llvm-ar");
          const ar = llvmAr || (await which("ar")) || "";
          return { clang, clangxx, xcrun, ar };
        });
      } catch {
        return null;
      }
    })();
  }

  cachedCgoToolchainPaths = await cachedCgoToolchainPathsPromise;
  return cachedCgoToolchainPaths;
}

export function applyCgoEnvDefaults(opts: {
  tmp: string;
  exportEnv: Record<string, string>;
  sdkPath: string | null;
  toolchain: CgoToolchainPaths | null;
}) {
  if (opts.exportEnv.CGO_ENABLED !== "1") return;

  if (process.platform === "darwin" && opts.sdkPath) {
    const sdk = opts.sdkPath;
    opts.exportEnv.SDKROOT = opts.exportEnv.SDKROOT || sdk;
    const base = `-isysroot ${sdk}`;
    opts.exportEnv.CGO_CPPFLAGS = [base, opts.exportEnv.CGO_CPPFLAGS || ""]
      .filter(Boolean)
      .join(" ");
    opts.exportEnv.CGO_CFLAGS = [base, opts.exportEnv.CGO_CFLAGS || ""].filter(Boolean).join(" ");
    const inc = `${sdk}/usr/include`;
    const lib = `${sdk}/usr/lib`;
    opts.exportEnv.CPATH = [inc, opts.exportEnv.CPATH || ""].filter(Boolean).join(path.delimiter);
    opts.exportEnv.LIBRARY_PATH = [lib, opts.exportEnv.LIBRARY_PATH || ""]
      .filter(Boolean)
      .join(path.delimiter);
    opts.exportEnv.CC = opts.exportEnv.CC || "xcrun --sdk macosx clang";
  }

  if (opts.toolchain) {
    const tc = opts.toolchain;
    const isNix = (p: string) => !!p && p.startsWith("/nix/store/");
    if (isNix(tc.clang) && isNix(tc.clangxx)) {
      if (process.platform === "darwin") {
        if (isNix(tc.xcrun)) {
          opts.exportEnv.CC = `${tc.xcrun} --sdk macosx ${tc.clang}`;
          opts.exportEnv.CXX = `${tc.xcrun} --sdk macosx ${tc.clangxx}`;
        }
      } else {
        opts.exportEnv.CC = tc.clang;
        opts.exportEnv.CXX = tc.clangxx;
      }
    }
  }
}
