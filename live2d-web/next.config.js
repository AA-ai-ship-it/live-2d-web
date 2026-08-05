/** @type {import('next').NextConfig} */
const nextConfig = {
  // PixiJS WebGL 上下文与 React StrictMode 双重挂载不兼容（dev only）
  reactStrictMode: false,
  // 图片允许外部域名（AutoDL / Cloudflare R2 等）
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
}

module.exports = nextConfig
