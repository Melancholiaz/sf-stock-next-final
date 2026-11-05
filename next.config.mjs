/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/desktop.html' },
        { source: '/mobile', destination: '/mobile/index.html' },
      ],
    };
  },
  async headers() {
    return [
      // ให้เบราว์เซอร์เช็ก service worker และหน้าแอปใหม่ทุกครั้ง
      { source: '/mobile/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/desktop.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/script.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/mobile/mobile.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};

export default nextConfig;
