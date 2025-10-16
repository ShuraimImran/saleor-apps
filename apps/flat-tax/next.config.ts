import { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@saleor/apps-shared",
    "@saleor/react-hook-form-macaw",
    "@saleor/apps-ui",
  ],
  eslint: {
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/configuration",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;