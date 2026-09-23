import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // Trace from the monorepo root so hoisted node_modules and packages/shared are included.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // packages/shared is consumed as TypeScript source, not built.
  transpilePackages: ["@spm-t5/shared"],
};

export default nextConfig;
