/* SF Stock – Service Worker: ให้เปิดแอปได้แม้เน็ตหลุด (ไม่เก็บข้อมูล API ไว้ใน cache) */
const VERSION = 'sf-stock-next-v1';
const SHELL = ['/mobile', '/mobile/index.html', '/mobile/mobile.js', '/mobile/manifest.webmanifest', '/mobile/icon-192.png', '/mobile/icon-512.png', '/icon.jpg',
               'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
    const req = e.request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.pathname === '/api') return;   // ข้อมูลสต็อกไม่ผ่าน cache
    if (url.origin === self.location.origin) {
        // ไฟล์ของแอป: เอาของใหม่จากเซิร์ฟเวอร์ก่อน ถ้าเน็ตหลุดใช้ของใน cache
        e.respondWith(fetch(req).then(res => {
            if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
            return res;
        }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('/mobile/index.html'))));
    } else {
        // ไลบรารี/ฟอนต์จาก CDN: ใช้ของใน cache ก่อน
        e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
            const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res;
        })));
    }
});
