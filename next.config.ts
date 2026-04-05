import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  devIndicators: false,
  outputFileTracingIncludes: {
    '/api/bills/generate': ['./bill_generator/template/**/*'],
  },
};

export default nextConfig;
