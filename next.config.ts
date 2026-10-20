import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.ANIME_RAILWAY_BUILD === "1" ? { output: "standalone" } : {}),
};

export default nextConfig;

