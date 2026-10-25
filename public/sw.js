// Panorama — funcionamento sem internet.
// O app (HTML, CSS, JS, ícones) fica guardado no aparelho; as notícias vêm sempre da rede
// primeiro e, sem conexão, da última edição que foi aberta.

const SHELL = 'panorama-app-v1';
const DATA = 'panorama-edicao';
const SHELL_FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icones/apple-touch-icon.png', 'icones/icone-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // O acervo bruto só interessa ao robô de atualização; não vale ocupar espaço no celular.
  if (url.pathname.endsWith('/data/acervo.json')) return;
  const cacheName = url.pathname.includes('/data/') ? DATA : SHELL;
  event.respondWith(networkFirst(event.request, cacheName));
});
