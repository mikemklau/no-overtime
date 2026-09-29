import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static HTML export for Capacitor compatibility
  output: "export",

  // Disable Next.js image optimization (not available in static export)
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
