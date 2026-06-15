/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Next 16 默认拦截「跨源」的 dev 资源请求（_next/static chunk、webpack-hmr 等）。
  // 本地用 localhost / 127.0.0.1 / 局域网 IP 访问时源不一致 → JS chunk 被拦 →
  // 页面只剩 SSR+CSS 部分（hero/画廊），需 JS 的区块不 hydrate → 黑屏。
  // 放行所有本地访问方式，彻底消除这个问题。
  allowedDevOrigins: ['localhost', '127.0.0.1', '0.0.0.0', '192.168.0.183', '*.local'],
  rewrites: async () => {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8000/api/:path*',
      },
    ]
  },
};

export default nextConfig;
