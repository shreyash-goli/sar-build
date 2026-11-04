import type { NextConfig } from "next";

// cacheComponents/partialPrefetching are intentionally disabled: every page in
// FailSafe reads live SQLite state through Prisma and must render dynamically.
// Tailwind CSS v4 is wired through postcss.config.mjs (@tailwindcss/postcss),
// which Turbopack processes automatically.
const nextConfig: NextConfig = {};

export default nextConfig;
