// Public alumni website. Pages render on the server from the API (settings, branding, content).
const api = process.env.API_INTERNAL_URL ?? 'http://localhost:8100';

/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // In development the website runs alone, so media and API calls are proxied. In production nginx routes them.
  async rewrites() {
    return process.env.NODE_ENV === 'production' ? [] : [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/media/:path*', destination: `${api}/media/:path*` },
    ];
  },
};
