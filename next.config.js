/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_GAME_API: process.env.NEXT_PUBLIC_GAME_API || 'http://localhost:3003',
  },
};

module.exports = nextConfig;

