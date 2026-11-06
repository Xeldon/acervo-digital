// Service worker: guarda o app e o catálogo para abrir mesmo sem internet.
// Arquivos do próprio app usam "rede primeiro" (sempre a versão mais nova quando há conexão).
// Capas e PDFs vêm de outros domínios e seguem direto para a rede.

const VERSAO = 'acervo-v1';
const ESSENCIAIS = [
  './',
  'index.html',
  'css/estilo.css',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icone.svg',
  'icons/icone-192.png',
  'data/catalogo.json',
];

self.addEventListener('install', evento => {
  evento.waitUntil(caches.open(VERSAO).then(cache => cache.addAll(ESSENCIAIS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(c => c !== VERSAO).map(c => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', evento => {
  const pedido = evento.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;

  evento.respondWith((async () => {
    const cache = await caches.open(VERSAO);
    try {
      const resposta = await fetch(pedido);
      if (resposta.ok) cache.put(pedido, resposta.clone());
      return resposta;
    } catch (erro) {
      const guardada = await cache.match(pedido, { ignoreSearch: true })
        || (pedido.mode === 'navigate' ? await cache.match('./') : undefined);
      if (guardada) return guardada;
      throw erro;
    }
  })());
});
