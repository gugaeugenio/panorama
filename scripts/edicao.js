// Gera uma edição completa do Panorama numa pasta pronta para hospedagem estática.
// É o que o robô do GitHub (.github/workflows/edicao.yml) roda a cada execução.
//
//   node scripts/edicao.js --saida site --estado https://usuario.github.io/panorama/data/acervo.json
//
// O acervo das últimas 72 h viaja junto com a própria edição publicada (data/acervo.json):
// cada execução baixa o da edição anterior, atualiza e publica de novo. Sem banco de dados.

import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { NewsStore } from '../src/store.js';
import { Newsroom } from '../src/newsroom.js';
import { getIndicators } from '../src/indicators.js';
import { writeEdition } from '../src/edition.js';
import { fetchText } from '../src/fetcher.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { values: args } = parseArgs({
  options: {
    saida: { type: 'string', default: 'site' },
    estado: { type: 'string' },
  },
});

const out = resolve(args.saida);
const stateFile = join(out, '.estado', 'acervo.json');
const log = { info: (m) => console.log(m), warn: (m) => console.warn(`aviso: ${m}`) };

async function restoreState() {
  await mkdir(join(out, '.estado'), { recursive: true });
  if (!args.estado) return;
  try {
    const { text } = await fetchText(args.estado, { timeoutMs: 30000, accept: 'application/json' });
    JSON.parse(text); // garante que não é uma página de erro
    await writeFile(stateFile, text);
    log.info('Acervo da edição anterior recuperado.');
  } catch (error) {
    log.warn(`Começando com acervo vazio (${error.message}).`);
  }
}

await rm(out, { recursive: true, force: true });
await cp(join(ROOT, 'public'), out, { recursive: true, filter: (src) => !src.includes(`${join('public', 'data')}`) });
await restoreState();

const store = new NewsStore({ cachePath: stateFile, log });
const newsroom = new Newsroom({ model: process.env.PANORAMA_MODELO || 'claude-opus-5-5', log });
await store.load();
await store.refresh();
const indicators = await getIndicators().catch((error) => {
  log.warn(`Indicadores indisponíveis (${error.message}).`);
  return null;
});
const { stories } = await writeEdition(out, { store, newsroom, indicators });

// O acervo vai junto na edição, para a próxima execução continuar de onde esta parou.
await writeFile(join(out, 'data', 'acervo.json'), await readFile(stateFile));
await rm(join(out, '.estado'), { recursive: true, force: true });
// GitHub Pages: sem processamento Jekyll (pastas e arquivos servidos como estão).
await writeFile(join(out, '.nojekyll'), '');

const failed = store.status().filter((o) => !o.ok).map((o) => o.name);
log.info(`Edição pronta em ${out}: ${store.items.size} reportagens, ${stories} páginas de matéria.${failed.length ? ` Fora do ar: ${failed.join(', ')}.` : ''}`);
