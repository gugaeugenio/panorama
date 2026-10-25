// Indicadores econômicos da API oficial do Banco Central (SGS).
// https://dadosabertos.bcb.gov.br — séries públicas, sem chave.

import { fetchText } from './fetcher.js';

const SERIES = [
  { id: 'dolar', name: 'Dólar', code: 1, unit: 'R$', decimals: 4, note: 'PTAX venda' },
  { id: 'euro', name: 'Euro', code: 21619, unit: 'R$', decimals: 4, note: 'PTAX venda' },
  { id: 'selic', name: 'Selic', code: 432, unit: '%', decimals: 2, note: 'meta ao ano' },
  { id: 'ipca', name: 'IPCA', code: 13522, unit: '%', decimals: 2, note: 'acumulado em 12 meses' },
];

const TTL_MS = 60 * 60e3;
let cache = null;

function parseBcbDate(s) {
  const [d, m, y] = s.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

const bcbDate = (d) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

async function loadSeries(series, today) {
  // Consulta por intervalo, e não "últimos N": a Selic meta é publicada com datas futuras.
  const start = new Date(today.getTime() - 120 * 86400e3);
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series.code}/dados?formato=json&dataInicial=${bcbDate(start)}&dataFinal=${bcbDate(today)}`;
  const { text } = await fetchText(url, { timeoutMs: 12000, accept: 'application/json' });
  const rows = JSON.parse(text)
    .map((r) => ({ date: parseBcbDate(r.data), value: Number(r.valor) }))
    // A Selic meta vem com datas futuras (vigência até a próxima reunião do Copom).
    .filter((r) => Number.isFinite(r.value) && r.date <= today);
  if (!rows.length) throw new Error('série sem dados');
  const last = rows[rows.length - 1];
  const prev = [...rows].reverse().find((r) => r.value !== last.value);
  return {
    id: series.id,
    name: series.name,
    unit: series.unit,
    decimals: series.decimals,
    note: series.note,
    value: last.value,
    date: last.date.toISOString().slice(0, 10),
    previous: prev ? { value: prev.value, date: prev.date.toISOString().slice(0, 10) } : null,
    sourceUrl: `https://www3.bcb.gov.br/sgspub/consultarvalores/telaCvsSelecionarSeries.paint?codigoSerie=${series.code}`,
  };
}

export async function getIndicators({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const today = new Date();
  const results = await Promise.allSettled(SERIES.map((s) => loadSeries(s, today)));
  const data = {
    source: 'Banco Central do Brasil (SGS)',
    fetchedAt: new Date().toISOString(),
    items: results.map((r, i) => (r.status === 'fulfilled' ? r.value : { id: SERIES[i].id, name: SERIES[i].name, error: r.reason?.message || 'indisponível' })),
  };
  // Só guarda no cache se ao menos um indicador veio; senão tenta de novo na próxima chamada.
  if (data.items.some((i) => !i.error)) cache = { at: Date.now(), data };
  return data;
}
