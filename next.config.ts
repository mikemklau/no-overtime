import type { NextConfig } from "next";
import path from "path";

const isCapacitorBuild = process.env.BUILD_TARGET === "capacitor";

const nextConfig: NextConfig = {
  // Static HTML export only for Capacitor builds (mobile shell).
  // Web deployments (Vercel/Node) need server features for API routes.
  ...(isCapacitorBuild && { output: "export" }),

  transpilePackages: ["receipt-to-json"],
  allowedDevOrigins: ["192.168.1.201", "192.168.1.201:3000", "localhost:3000"],

  turbopack: {
    root: path.resolve(__dirname, "../.."),
    resolveAlias: {
      "fs/promises": "./src/lib/empty.ts",
      "node:fs/promises": "./src/lib/empty.ts",
    },
  },

  // Disable Next.js image optimization (not available in static export,
  // and not needed when Capacitor serves images locally)
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
