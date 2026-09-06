import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  devIndicators: false,
  outputFileTracingIncludes: {
    '/api/bills/generate': ['./bill_generator/template/**/*'],
    '/api/bills/time-invoice': ['./bill_generator/template/**/*'],
    '/api/bills/tenancy-agreement': [
      './bill_generator/template/**/*',
      './assets/**/*',
      './src/lib/bill-generator/templates/**/*',
    ],
  },
  experimental: {
    // Document uploads go through the `uploadOrderDocument` Server Action, and
    // Server Action bodies default to 1MB. MAX_DOC_BYTES allows 5MB and the
    // order form promises "max 5MB each", so every upload between 1MB and 5MB
    // failed with "Body exceeded 1 MB limit" — a photographed MyKad as easily as
    // a combined PDF. 8mb leaves room for multipart overhead above the 5MB file
    // itself; the real cap stays MAX_DOC_BYTES, which reports a readable error.
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
