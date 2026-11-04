import type { NextConfig } from "next";

// cacheComponents/partialPrefetching are intentionally disabled: every page in
// FailSafe reads live SQLite state through Prisma and must render dynamically.
const nextConfig: NextConfig = {
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
