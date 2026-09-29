import type { NextConfig } from "next";

const isCapacitorBuild = process.env.BUILD_TARGET === "capacitor";

const nextConfig: NextConfig = {
  // Static HTML export only for Capacitor builds (mobile shell).
  // Web deployments (Vercel/Node) need server features for API routes.
  ...(isCapacitorBuild && { output: "export" }),

  // Disable Next.js image optimization (not available in static export,
  // and not needed when Capacitor serves images locally)
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
