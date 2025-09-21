/** @type {import('next').NextConfig} */
const nextConfig = {
  // For SSR/server-side fetches we can hit the FastAPI container directly.
  // Client-side calls should go through /api routes later when we add them.
  reactStrictMode: true
};
export default nextConfig;
