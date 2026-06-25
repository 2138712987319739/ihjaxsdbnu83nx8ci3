// Website or admin panel made by Clovic.
const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const basePath = configuredBasePath && configuredBasePath !== '/'
  ? configuredBasePath.replace(/\/$/, '')
  : '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath,
  assetPrefix: basePath,
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
