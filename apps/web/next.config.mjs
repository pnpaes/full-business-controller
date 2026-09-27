/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep `next dev` and `next build` out of each other's way: verification runs
  // `npm run build` constantly, and a build writes to the same `.next` a running
  // dev server serves from, which corrupts its manifests and 500s every route.
  // Run dev with NEXT_DIST_DIR=.next-dev so a concurrent build cannot clobber it.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Workspace packages are TypeScript source, so Next must compile them.
  transpilePackages: [
    "@aquarela/application",
    "@aquarela/config",
    "@aquarela/domain",
    "@aquarela/jobs-runtime",
    "@aquarela/logger",
    "@aquarela/persistence",
    "@aquarela/ui",
  ],
  // Native/Node-only server dependencies must stay unbundled in route handlers.
  serverExternalPackages: ["@node-rs/argon2", "pg", "pg-boss"],
};

export default nextConfig;
