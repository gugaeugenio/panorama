import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClusters, dedupe, features, similar } from '../src/cluster.js';

let seq = 0;
const item = (outletId, title, hoursAgo = 1, extra = {}) => ({
  id: `id${seq++}`,
  title,
  summary: '',
  link: `https://example.com/${seq}`,
  image: null,
  published: new Date(Date.now() - hoursAgo * 3600e3).toISOString(),
  outletId,
  outletName: outletId,
  lang: 'pt',
  readable: true,
  section: 'politica',
  ...extra,
});

test('agrupa a mesma notícia publicada por veículos diferentes', () => {
  const clusters = buildClusters([
    item('g1', 'Palmeiras vence Bragantino e reassume a liderança do Brasileirão'),
    item('estadao', 'Palmeiras supera pênalti perdido, vence Bragantino e assume liderança do Brasileirão'),
    item('metropoles', 'Palmeiras vence Bragantino em Barueri e retoma liderança do Brasileirão'),
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].outletCount, 3);
});

test('números conflitantes separam fatos parecidos', () => {
  const a = features('Datafolha: Flávio Bolsonaro tem 51% dos votos válidos e Lula, 49%');
  const b = features('Datafolha para presidente no DF, votos válidos: Flávio Bolsonaro, 56%; Lula, 44%');
  assert.equal(similar(a, b), false);
});

test('institutos de pesquisa diferentes não se misturam', () => {
  const a = features('Quaest: Flávio Bolsonaro tem 51% dos votos válidos e Lula, 49%');
  const b = features('Datafolha: Flávio Bolsonaro tem 51% dos votos válidos e Lula, 49%');
  assert.equal(similar(a, b), false);
});

test('estados diferentes não se misturam', () => {
  const a = features('Quaest no Acre, votos válidos: Mailza Assis lidera a disputa ao governo');
  const b = features('Quaest no Amazonas, votos válidos: Omar Aziz lidera a disputa ao governo');
  assert.equal(similar(a, b), false);
});

test('decimais viram tokens próprios', () => {
  const { nums } = features('AtlasIntel: Flávio 50,8%, Lula 49,2%');
  assert.ok(nums.has('50d8'));
  assert.ok(nums.has('49d2'));
});

test('um veículo conta uma vez por história', () => {
  const clusters = buildClusters([
    item('g1', 'Palmeiras vence Bragantino e reassume a liderança do Brasileirão'),
    item('g1', 'Palmeiras vence Bragantino e retoma liderança do Brasileirão em Barueri'),
  ]);
  assert.ok(clusters.every((c) => c.outletCount === 1));
});

test('não agrupa fora da janela de 36 h', () => {
  const clusters = buildClusters([
    item('g1', 'Palmeiras vence Bragantino e reassume a liderança do Brasileirão', 1),
    item('ge', 'Palmeiras vence Bragantino e reassume a liderança do Brasileirão', 50),
  ]);
  assert.equal(clusters.length, 2);
});

test('não agrupa idiomas diferentes', () => {
  const clusters = buildClusters([
    item('g1', 'Brazil election runoff Lula Flavio Bolsonaro polls tight'),
    item('bbc', 'Brazil election runoff Lula Flavio Bolsonaro polls tight', 1, { lang: 'en' }),
  ]);
  assert.equal(clusters.length, 2);
});

test('dedupe junta o mesmo link vindo de dois feeds do mesmo veículo', () => {
  const a = item('g1', 'Título qualquer de teste');
  const b = { ...a, image: 'https://img/x.jpg' };
  const out = dedupe([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].image, 'https://img/x.jpg');
});
