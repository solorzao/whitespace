import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // collectArea reads the saved demo areas from disk, so ship them with the API routes.
  outputFileTracingIncludes: {
    "/api/*": ["./data/demo/**/*.json"],
    // The suggestion threads are prerendered, but a cache miss reads the same files.
    "/api/suggestions/*": [
      "./data/demo/*-analysis.json",
      "./data/suggestions/**/*.json",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
