import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.noovertime.app",
  appName: "No Overtime",
  webDir: "out",
  server: {
    // In production, serve from the static export
    // In development, point to the Next.js dev server
    ...(process.env.NODE_ENV === "development" && {
      url: "http://localhost:3000",
      cleartext: true,
    }),
  },
};

export default config;
