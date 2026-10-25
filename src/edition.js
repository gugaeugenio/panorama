// Gera a "edição" do Panorama: um conjunto de arquivos JSON prontos que o app só lê.
// Assim o app funciona em hospedagem estática gratuita (GitHub Pages), sem servidor.
//
//   data/versao.json            versão e horário da edição (o app consulta para saber se há novidade)
//   data/capa.json              manchete, assuntos/destaques, editorias e notas rápidas
//   data/editoria/<id>.json     matérias por assunto e notas rápidas da editoria
//   data/m/<id>.json            detalhe de cada matéria ou nota
//   data/busca.json             índice compacto para a busca, feita no próprio celular
//   data/indicadores.json       dólar, euro, Selic e IPCA (Banco Central)
//   data/bastidores.json        estado de cada veículo e da redação
//   data/arquivo/...            dias anteriores (quando houver matérias redigidas)
//
// Com uma chave (app privado), cada arquivo sai cifrado como <nome>.json.bin e um
// data/cripto.json público diz ao app como derivar a chave da frase-senha. Só nesse caso o
// texto integral das reportagens entra na edição: ele nunca é publicado em aberto.

import { mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { sealJson } from './crypto.js';
import { SECTIONS } from './sources.js';
import { buildFront, buildSection, buildStory, toStory, buildArchiveDays, buildArchiveDay } from './present.js';

const SECTION_NOTES = 300;

/** Índice de busca: uma linha curta por matéria ou nota. */
function searchIndex(store, newsroom) {
  const rows = [];
  for (const c of store.clusters) {
    const s = toStory(c, newsroom);
    const isStory = s.written || (c.lead.lang === 'pt' && c.outletCount >= 2);
    if (!isStory && c.lead.lang !== 'pt') continue;
    rows.push({ id: s.id, k: isStory ? 's' : 'n', t: s.title, d: s.dek, s: s.section, a: s.assunto, u: s.updated, c: s.confirmations, i: isStory ? s.image : null });
  }
  for (const a of newsroom.articles.values()) {
    if (!a.apto || a.itemIds.some((id) => store.getItem(id))) continue;
    rows.push({ id: a.key, k: 's', t: a.titulo, d: a.linhaFina, s: a.editoria, a: a.assunto, u: a.updated || a.published, c: a.outletCount, i: a.image || null, x: a.texto.join(' ') });
  }
  return rows.sort((a, b) => Date.parse(b.u) - Date.parse(a.u));
}

/**
 * Escreve a edição completa em `outDir/data`. Escreve numa pasta temporária e troca no fim,
 * para o app nunca ler uma edição pela metade.
 */
export async function writeEdition(outDir, { store, newsroom, indicators, texts = null, crypto = null, plainTextOk = false }) {
  const writeJson = (path, data) => (crypto ? writeFile(`${path}.bin`, sealJson(data, crypto.key)) : writeFile(path, JSON.stringify(data)));
  const withText = !!texts && (!!crypto || plainTextOk);
  const dataDir = join(outDir, 'data');
  const tmp = join(outDir, `data.tmp-${process.pid}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(join(tmp, 'editoria'), { recursive: true });
  await mkdir(join(tmp, 'm'), { recursive: true });
  await mkdir(join(tmp, 'arquivo'), { recursive: true });

  const version = `${store.updatedAt}|${newsroom.version}`;
  const head = { updatedAt: store.updatedAt, version, total: store.items.size };

  await writeJson(join(tmp, 'versao.json'), head);
  await writeJson(join(tmp, 'capa.json'), { ...head, sections: SECTIONS, ...buildFront(store, newsroom) });
  for (const sec of SECTIONS) {
    await writeJson(join(tmp, 'editoria', `${sec.id}.json`), { ...head, ...buildSection(store, newsroom, sec.id, { notesLimit: SECTION_NOTES }) });
  }

  const ids = new Set(store.clusters.map((c) => c.id));
  for (const a of newsroom.articles.values()) if (a.apto) ids.add(a.key);
  for (const id of ids) {
    const story = buildStory(store, newsroom, id);
    if (!story) continue;
    delete story.readableItemId;
    if (withText && !story.written) {
      const cluster = store.getCluster(id);
      const best = cluster && texts.bestFor(cluster);
      if (best) story.corpo = best.html;
    }
    await writeJson(join(tmp, 'm', `${id}.json`), story);
  }

  await writeJson(join(tmp, 'busca.json'), searchIndex(store, newsroom));
  if (indicators) await writeJson(join(tmp, 'indicadores.json'), indicators);
  await writeJson(join(tmp, 'bastidores.json'), { ...head, newsroom: newsroom.status(), clusters: store.clusters.length, outlets: store.status() });

  const days = buildArchiveDays(newsroom);
  await writeJson(join(tmp, 'arquivo', 'index.json'), { ...head, days });
  for (const { day } of days) await writeJson(join(tmp, 'arquivo', `${day}.json`), { ...head, ...buildArchiveDay(newsroom, day) });

  if (crypto) await writeFile(join(tmp, 'cripto.json'), JSON.stringify(crypto.descriptor));

  await rm(dataDir, { recursive: true, force: true });
  await rename(tmp, dataDir);
  return { version, stories: ids.size };
}
