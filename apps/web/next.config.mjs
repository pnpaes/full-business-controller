/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are TypeScript source, so Next must compile them.
  transpilePackages: [
    "@aquarela/application",
    "@aquarela/config",
    "@aquarela/domain",
    "@aquarela/logger",
    "@aquarela/persistence",
    "@aquarela/ui",
  ],
  // Native/Node-only server dependencies must stay unbundled in route handlers.
  serverExternalPackages: ["@node-rs/argon2", "pg"],
};

export default nextConfig;
