import { versionInfo } from './scripts/version-info.mjs';

const v = versionInfo();

// Static export: the same build is hosted on Vercel and bundled inside Tauri (works offline).
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  env: { NEXT_PUBLIC_APP_VERSION: v.version, NEXT_PUBLIC_BUILD_SHA: v.sha },
};
export default nextConfig;
