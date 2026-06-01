/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" }, // bid uploads kick off via storage, but room for forms
  },
};

export default nextConfig;
