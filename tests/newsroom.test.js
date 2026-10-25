import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Newsroom } from '../src/newsroom.js';
import { buildFront, buildStory } from '../src/present.js';
import { buildClusters } from '../src/cluster.js';

let seq = 0;
const item = (outletId, title, extra = {}) => ({
  id: `n${seq++}`, title, summary: 'Resumo da reportagem.', link: `https://example.com/${seq}`, image: null,
  published: new Date(Date.now() - 3600e3).toISOString(), outletId, outletName: outletId.toUpperCase(),
  lang: 'pt', readable: false, section: 'esporte', ...extra,
});

/** Store mínimo com a mesma interface usada pela redação e pela capa. */
function fakeStore(items) {
  const clusters = buildClusters(items);
  const byItem = new Map();
  for (const c of clusters) for (const i of c.items) byItem.set(i.id, c);
  return {
    clusters,
    getItem: (id) => items.find((i) => i.id === id),
    getCluster: (id) => byItem.get(id) || null,
    query: () => [...clusters].sort((a, b) => b.outletCount - a.outletCount),
  };
}

function fakeClient(output, calls = []) {
  return {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return { stop_reason: 'end_turn', model: params.model, content: [{ type: 'text', text: JSON.stringify(output) }] };
        },
      },
    },
  };
}

const ARTICLE = {
  apto: true, titulo: 'Palmeiras vence o Bragantino e volta à liderança', linha_fina: 'Time fez 2 a 0 em Barueri.',
  em_resumo: ['Placar de 2 a 0.'], texto: ['O Palmeiras venceu o Bragantino por 2 a 0.'], assunto: 'Brasileirão', editoria: 'esporte',
};

const items = () => [
  item('g1', 'Palmeiras vence Bragantino e reassume a liderança do Brasileirão'),
  item('ge', 'Palmeiras vence Bragantino e retoma liderança do Brasileirão em Barueri'),
  item('cnn', 'Giay decide, Palmeiras vence Bragantino e dorme na liderança do Brasileirão'),
  item('folha', 'Prefeitura anuncia obra em avenida da zona sul', { section: 'brasil' }),
];

test('escreve matéria só para fatos confirmados, sem nome de veículo no pedido', async () => {
  const calls = [];
  const store = fakeStore(items());
  const nr = new Newsroom({ model: 'claude-opus-5-5', client: fakeClient(ARTICLE, calls), log: {} });
  await nr.run(store);
  assert.equal(calls.length, 1, 'só o fato com 3 veículos deve ser redigido');
  const prompt = calls[0].messages[0].content;
  for (const name of ['G1', 'GE', 'CNN']) assert.ok(!prompt.includes(name), `o pedido não pode citar ${name}`);
  assert.equal(calls[0].fallbacks, 'default');
  assert.equal(calls[0].output_config.format.type, 'json_schema');
});

test('Haiku não recebe o parâmetro de fallback', async () => {
  const calls = [];
  const nr = new Newsroom({ model: 'claude-haiku-5-5', client: fakeClient(ARTICLE, calls), log: {} });
  await nr.run(fakeStore(items()));
  assert.equal(calls[0].fallbacks, undefined);
});

test('capa usa o texto da redação e separa as notas rápidas', async () => {
  const store = fakeStore(items());
  const nr = new Newsroom({ model: 'claude-opus-5-5', client: fakeClient(ARTICLE), log: {} });
  await nr.run(store);
  const front = buildFront(store, nr);
  assert.equal(front.manchete.title, ARTICLE.titulo);
  assert.equal(front.manchete.assunto, 'Brasileirão');
  assert.equal(front.manchete.confirmations, 3);
  assert.deepEqual(front.notas.map((n) => n.title), ['Prefeitura anuncia obra em avenida da zona sul']);
  assert.ok(!JSON.stringify(front).includes('outletName'), 'a capa não expõe nomes de veículos');

  const story = buildStory(store, nr, front.manchete.id);
  assert.deepEqual(story.texto, ARTICLE.texto);
  assert.equal(story.originals.length, 3);
});

test('não reescreve matéria já escrita e respeita o limite diário', async () => {
  const calls = [];
  const store = fakeStore(items());
  const nr = new Newsroom({ model: 'claude-opus-5-5', client: fakeClient(ARTICLE, calls), log: {}, dailyLimit: 1 });
  await nr.run(store);
  await nr.run(store);
  assert.equal(calls.length, 1);
});

test('sem chave, a capa mostra o título original', () => {
  const store = fakeStore(items());
  const nr = new Newsroom({ model: 'claude-opus-5-5', client: null, log: {} });
  const front = buildFront(store, nr);
  assert.equal(nr.enabled, false);
  assert.match(front.manchete.title, /Palmeiras/);
  assert.equal(front.manchete.written, false);
});

test('novo veículo num fato já escrito só atualiza a contagem, sem chamar a API', async () => {
  const calls = [];
  const base = items();
  const nr = new Newsroom({ model: 'claude-sonnet-5-5', client: fakeClient(ARTICLE, calls), log: {} });
  await nr.run(fakeStore(base));
  const later = fakeStore([...base, item('estadao', 'Palmeiras vence Bragantino e assume a liderança do Brasileirão em Barueri')]);
  await nr.run(later);
  assert.equal(calls.length, 1, 'a matéria não pode ser reescrita');
  const [article] = [...nr.articles.values()];
  assert.equal(article.outletCount, 4);
  assert.equal(article.originals.length, 4);
});

test('matéria continua no arquivo depois que as reportagens saem do acervo', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { buildArchiveDays, buildArchiveDay, buildStory: story } = await import('../src/present.js');
  const dir = await mkdtemp(join(tmpdir(), 'panorama-'));
  try {
    const nr = new Newsroom({ dir, model: 'claude-sonnet-5-5', client: fakeClient(ARTICLE), log: {} });
    await nr.run(fakeStore(items()));

    // Reabre do disco, com o acervo vazio (reportagens com mais de 72 h já descartadas).
    const reopened = new Newsroom({ dir, model: 'claude-sonnet-5-5', client: null, log: {} });
    await reopened.load();
    const empty = fakeStore([]);
    const [day] = buildArchiveDays(reopened);
    assert.equal(day.count, 1);
    const edition = buildArchiveDay(reopened, day.day);
    assert.equal(edition.sections[0].assuntos[0].name, 'Brasileirão');
    const s = story(empty, reopened, edition.sections[0].assuntos[0].stories[0].id);
    assert.deepEqual(s.texto, ARTICLE.texto);
    assert.equal(s.originals.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
