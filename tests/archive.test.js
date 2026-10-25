import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Archive, jsonFiles } from '../src/archive.js';
import { Newsroom } from '../src/newsroom.js';
import { buildClusters } from '../src/cluster.js';
import { deriveKey, newSalt } from '../src/crypto.js';

let seq = 0;
const item = (outletId, title, published) => ({
  id: `a${seq++}`, title, summary: 'Resumo.', link: `https://example.com/${seq}`, image: null, published,
  outletId, outletName: outletId, lang: 'pt', readable: true, section: 'esporte',
});
const storeOf = (items) => ({ clusters: buildClusters(items) });
const newsroom = new Newsroom({ model: 'x', client: null, log: {} });
const texts = { bestFor: () => ({ html: '<p>Texto completo.</p>', length: 900 }) };
const quiet = { info() {}, warn() {} };

const oldDay = '2026-10-10T15:00:00Z';
const items = () => [
  item('g1', 'Palmeiras vence Bragantino e reassume a liderança do Brasileirão', oldDay),
  item('ge', 'Palmeiras vence Bragantino e retoma liderança do Brasileirão em Barueri', oldDay),
  item('folha', 'Prefeitura anuncia obra em avenida da zona sul', oldDay),
];

test('guarda matérias com texto e notas só com título, fecha o dia e não reabre', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'arquivo-'));
  try {
    const files = jsonFiles(null);
    const archive = new Archive({ log: quiet });
    archive.update(storeOf(items()), newsroom, texts);
    const entries = archive.toJSON();
    const story = entries.find((e) => e.k === 's');
    const note = entries.find((e) => e.k === 'n');
    assert.equal(story.corpo, '<p>Texto completo.</p>');
    assert.equal(story.confirmations, 2);
    assert.equal(note.corpo, undefined);
    assert.ok(note.link);

    const closed = await archive.close(dir, files);
    assert.deepEqual(closed, ['2026-10-10']);
    assert.equal(archive.entries.size, 0);
    const day = await files.read(join(dir, 'dias', '2026-10-10.json'));
    assert.equal(day.entries.length, 2);
    const index = await files.read(join(dir, 'indice', '2026-10.json'));
    assert.deepEqual(index.map((r) => r.k).sort(), ['n', 's']);

    // Na rodada seguinte, as mesmas reportagens não recriam o dia já gravado.
    archive.update(storeOf(items()), newsroom, texts, new Set(Object.keys(await archive.closedDays(dir, files))));
    assert.equal(archive.entries.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('publica o arquivo cifrado, com lista de dias e meses para a busca', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'arquivo-'));
  try {
    const key = deriveKey('senha de teste', newSalt(), 1000);
    const files = jsonFiles(key);
    const archive = new Archive({ log: quiet });
    archive.update(storeOf(items()), newsroom, texts);
    await archive.close(join(dir, 'fechados'), files);
    const today = new Date().toISOString();
    archive.update(storeOf([item('g1', 'Copom mantém a taxa Selic em reunião desta quarta', today), item('cnn', 'Copom mantém a taxa Selic em reunião nesta quarta-feira', today)]), newsroom, texts);
    await archive.publish(join(dir, 'site'), join(dir, 'fechados'), files);

    const raw = await readFile(join(dir, 'site', 'dias', '2026-10-10.json.bin'));
    assert.ok(!raw.toString('latin1').includes('Palmeiras'), 'o dia publicado não pode estar legível');
    const index = await files.read(join(dir, 'site', 'index.json'));
    assert.equal(index.days.length, 2);
    assert.equal(index.days[0].open, true);
    assert.deepEqual(index.months, ['2026-10']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
