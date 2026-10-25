// Gera uma edição completa do Panorama numa pasta pronta para hospedagem estática.
// É o que o robô do GitHub (.github/workflows/edicao.yml) roda a cada execução.
//
//   PANORAMA_SENHA="frase secreta" node scripts/edicao.js --saida site --base https://usuario.github.io/panorama --arquivo arquivo-repo
//
// Com PANORAMA_SENHA, tudo em data/ sai criptografado e a edição inclui o texto completo das
// reportagens abertas. Sem ela, a edição é pública e traz só títulos e resumos.
//
// O estado (acervo das últimas 72 h, textos já extraídos e dias abertos do arquivo) viaja
// dentro da própria edição publicada: cada execução baixa o da anterior, atualiza e publica
// de novo. Os dias fechados do arquivo ficam na pasta --arquivo, que o robô guarda na branch
// `arquivo` do repositório. Sem banco de dados.

import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { NewsStore } from '../src/store.js';
import { Newsroom } from '../src/newsroom.js';
import { TextStore } from '../src/texts.js';
import { Archive, jsonFiles } from '../src/archive.js';
import { getIndicators } from '../src/indicators.js';
import { writeEdition } from '../src/edition.js';
import { deriveKey, newSalt, descriptor, keyMatches, sealJson, openJson } from '../src/crypto.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { values: args } = parseArgs({
  options: {
    saida: { type: 'string', default: 'site' },
    base: { type: 'string' },
    arquivo: { type: 'string', default: 'arquivo-repo' },
  },
});

const out = resolve(args.saida);
const closedDir = resolve(args.arquivo);
const workDir = resolve(`${args.saida}.estado`);
const stateFile = join(workDir, 'acervo.json');
const base = args.base?.replace(/\/$/, '');
const password = process.env.PANORAMA_SENHA || '';
const log = { info: (m) => console.log(m), warn: (m) => console.warn(`aviso: ${m}`) };

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Prepara a chave: reaproveita o sal da edição anterior se a senha for a mesma. */
async function prepareCrypto() {
  if (!password) return null;
  if (base) {
    try {
      const previous = JSON.parse((await download(`${base}/data/cripto.json`)).toString());
      const key = deriveKey(password, previous.salt, previous.iterations);
      if (keyMatches(previous, key)) return { key, salt: previous.salt, descriptor: previous, reused: true };
      log.warn('A senha mudou: a edição anterior não será aproveitada.');
    } catch {
      /* primeira edição privada */
    }
  }
  const salt = newSalt();
  const key = deriveKey(password, salt);
  return { key, salt, descriptor: descriptor(salt, key), reused: false };
}

/** Recupera acervo, textos e dias abertos do arquivo da edição anterior. */
async function restoreState(crypto, texts, archive) {
  await mkdir(workDir, { recursive: true });
  if (!base) return;
  try {
    if (crypto?.reused) {
      await writeFile(stateFile, JSON.stringify(openJson(await download(`${base}/data/acervo.json.bin`), crypto.key)));
      texts.fromJSON(openJson(await download(`${base}/data/textos.json.bin`), crypto.key));
      try {
        archive.fromJSON(openJson(await download(`${base}/data/arquivo-aberto.json.bin`), crypto.key));
      } catch {
        log.info('Arquivo começando agora (sem dias abertos anteriores).');
      }
    } else {
      // Edição anterior pública (ou primeira execução): o acervo aberto ainda serve.
      const plain = await download(`${base}/data/acervo.json`);
      JSON.parse(plain.toString()); // garante que não é uma página de erro
      await writeFile(stateFile, plain);
    }
    log.info(`Acervo da edição anterior recuperado (${texts.size} textos completos).`);
  } catch (error) {
    log.warn(`Começando com acervo vazio (${error.message}).`);
  }
}

await rm(out, { recursive: true, force: true });
await rm(workDir, { recursive: true, force: true });
await cp(join(ROOT, 'public'), out, { recursive: true, filter: (src) => !src.includes(join('public', 'data')) });

const crypto = await prepareCrypto();
const texts = new TextStore({ log });
const archive = new Archive({ log });
await restoreState(crypto, texts, archive);
await mkdir(closedDir, { recursive: true });

const store = new NewsStore({ cachePath: stateFile, log });
const newsroom = new Newsroom({ model: process.env.PANORAMA_MODELO || 'claude-opus-5-5', log });
await store.load();
await store.refresh();
if (crypto) await texts.fill(store);
const files = jsonFiles(crypto?.key);
archive.update(store, newsroom, crypto ? texts : null, new Set(Object.keys(await archive.closedDays(closedDir, files))));
await archive.close(closedDir, files);
const indicators = await getIndicators().catch((error) => {
  log.warn(`Indicadores indisponíveis (${error.message}).`);
  return null;
});
const { stories } = await writeEdition(out, { store, newsroom, indicators, texts: crypto ? texts : null, crypto, archive, closedDir });

// O estado vai junto na edição, para a próxima execução continuar de onde esta parou.
const acervo = JSON.parse(await readFile(stateFile, 'utf8'));
if (crypto) {
  await writeFile(join(out, 'data', 'acervo.json.bin'), sealJson(acervo, crypto.key));
  await writeFile(join(out, 'data', 'textos.json.bin'), sealJson(texts.toJSON(), crypto.key));
  await writeFile(join(out, 'data', 'arquivo-aberto.json.bin'), sealJson(archive.toJSON(), crypto.key));
} else {
  await writeFile(join(out, 'data', 'acervo.json'), JSON.stringify(acervo));
}
await rm(workDir, { recursive: true, force: true });
// GitHub Pages: sem processamento Jekyll (pastas e arquivos servidos como estão).
await writeFile(join(out, '.nojekyll'), '');

const failed = store.status().filter((o) => !o.ok).map((o) => o.name);
const closedCount = Object.keys(await archive.closedDays(closedDir, files)).length;
log.info(`Edição ${crypto ? 'PRIVADA (criptografada)' : 'pública'} pronta em ${out}: ${store.items.size} reportagens, ${stories} páginas de matéria, ${texts.size} textos completos, arquivo com ${closedCount} dia(s) fechado(s) e ${archive.entries.size} notícia(s) em dias abertos.${failed.length ? ` Fora do ar: ${failed.join(', ')}.` : ''}`);
