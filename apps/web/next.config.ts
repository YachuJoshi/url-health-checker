import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle with only traced dependencies
  // Avoids shipping the entire pnpm store into the runtime image.
  output: "standalone",
};

export default nextConfig;
