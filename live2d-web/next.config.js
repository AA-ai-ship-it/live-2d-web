/** @type {import('next').NextConfig} */
const nextConfig = {
  // 图片允许外部域名（AutoDL / Cloudflare R2 等）
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
}

module.exports = nextConfig
