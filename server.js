// Panorama — servidor local. Escuta só em 127.0.0.1: o jornal é pessoal.
//
// Ele faz no Mac o mesmo que o robô do GitHub faz na nuvem: atualiza o acervo, gera a
// edição em public/data e entrega o app. O app em si só lê arquivos, então funciona igual
// aqui e no GitHub Pages.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NewsStore } from './src/store.js';
import { Newsroom } from './src/newsroom.js';
import { getIndicators } from './src/indicators.js';
import { writeEdition } from './src/edition.js';
import { TextStore } from './src/texts.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');

// Configuração local opcional (intervalo, chave da API se um dia for usada).
try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  /* sem .env: valores padrão */
}

const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';

const log = {
  info: (m) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${m}`),
  warn: (m) => console.warn(`[${new Date().toLocaleTimeString('pt-BR')}] aviso: ${m}`),
};

const newsroom = new Newsroom({
  dir: join(ROOT, 'data'),
  model: process.env.PANORAMA_MODELO || 'claude-opus-5-5',
  effort: process.env.PANORAMA_ESFORCO || 'medium',
  dailyLimit: Number(process.env.PANORAMA_LIMITE_DIARIO) || 120,
  log,
});

// No Mac o app só é acessível pelo próprio computador, então o texto completo pode ir em aberto.
const texts = new TextStore({ log });
const TEXTS_PATH = join(ROOT, 'data', 'textos.json');

async function publish(store) {
  try {
    await newsroom.run(store);
    await texts.fill(store);
    await texts.saveFile(TEXTS_PATH);
    const indicators = await getIndicators().catch(() => null);
    await writeEdition(PUBLIC, { store, newsroom, indicators, texts, plainTextOk: true });
  } catch (error) {
    log.warn(`Falha ao gerar a edição: ${error.message}`);
  }
}

// Uma rodada lê todos os feeds em poucos segundos e usa cache condicional (ETag), então
// atualizar a cada 2 minutos é leve para a máquina e para os sites.
const store = new NewsStore({
  cachePath: join(ROOT, 'data', 'cache.json'),
  refreshMinutes: Number(process.env.PANORAMA_ATUALIZACAO_MIN) || 2,
  log,
  onRefresh: publish,
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Método não permitido');
    return;
  }
  const { pathname } = new URL(req.url, 'http://localhost');
  const rel = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const file = normalize(join(PUBLIC, decodeURIComponent(rel)));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end('Proibido');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
  }
});

await Promise.all([store.load(), newsroom.load(), texts.loadFile(TEXTS_PATH)]);
// Gera a edição em segundo plano: o app já abre com a anterior enquanto isso.
if (store.items.size) publish(store);
server.listen(PORT, HOST, () => {
  log.info(`Panorama no ar: http://localhost:${PORT}`);
  store.start();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    store.stop();
    await store.save();
    process.exit(0);
  });
}
