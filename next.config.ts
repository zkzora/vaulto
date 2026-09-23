import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@openserv-labs/sdk", "@prisma/client", "prisma"],
  webpack: (config) => {
    // wagmi / walletconnect pull in optional native deps that are not needed in the browser
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
  turbopack: {},
};

export default nextConfig;
