import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, cleanLink } from '../src/feeds.js';
import { classify, override } from '../src/classify.js';
import { stripHtml, tokens } from '../src/text.js';

const now = new Date('2026-10-24T22:00:00Z');
const outlet = { id: 'folha', name: 'Folha', lang: 'pt', readable: false };

const rss = (items, open = '<rss version="2.0">') => `<?xml version="1.0"?>${open}<channel><title>Teste</title>${items}</channel></rss>`;

test('normaliza item RSS, limpa o redirecionador da Folha e os parâmetros de rastreio', async () => {
  const xml = rss(`<item>
    <title>Governo anuncia &amp; detalha medida</title>
    <link>https://redir.folha.com.br/redir/online/poder/rss091/*https://www1.folha.uol.com.br/poder/2026/10/x.shtml?utm_source=rss</link>
    <description><![CDATA[<img src="https://img.x/a.jpg"/><p>Resumo com <b>negrito</b>.</p>]]></description>
    <pubDate>Sat, 24 Oct 2026 21:04:00 -0300</pubDate>
  </item>`);
  const { items } = await parseFeed(xml, { outlet, feed: { section: 'politica' }, now: new Date('2026-10-25T01:00:00Z') });
  assert.equal(items.length, 1);
  const [i] = items;
  assert.equal(i.title, 'Governo anuncia & detalha medida');
  assert.equal(i.link, 'https://www1.folha.uol.com.br/poder/2026/10/x.shtml');
  assert.equal(i.summary, 'Resumo com negrito.');
  assert.equal(i.section, 'politica');
  assert.equal(i.readable, false);
});

test('descarta itens com mais de 72 h e itens sem data', async () => {
  const xml = rss(`
    <item><title>Velha</title><link>https://a.com/1</link><pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title>Sem data</title><link>https://a.com/2</link></item>
    <item><title>Nova</title><link>https://a.com/3</link><pubDate>Sat, 24 Oct 2026 20:00:00 GMT</pubDate></item>`);
  const { items } = await parseFeed(xml, { outlet, feed: { section: 'brasil' }, now });
  assert.deepEqual(items.map((i) => i.title), ['Nova']);
});

test('aceita <rss> sem atributo version (feed do UOL)', async () => {
  const xml = rss('<item><title>Item UOL</title><link>https://uol.com.br/a</link><pubDate>Sat, 24 Oct 2026 20:00:00 GMT</pubDate></item>', '<rss>');
  const { items } = await parseFeed(xml, { outlet, feed: { section: 'brasil' }, now });
  assert.equal(items.length, 1);
});

test('classifica pela URL antes das categorias e do título', () => {
  assert.equal(classify({ link: 'https://oglobo.globo.com/economia/noticia/2026/x.ghtml' }), 'economia');
  assert.equal(classify({ link: 'https://g1.globo.com/rn/rio-grande-do-norte/eleicoes/2026/noticia/x' }), 'politica');
  assert.equal(classify({ link: 'https://www.cnnbrasil.com.br/esportes/brasileirao/x/' }), 'esporte');
  assert.equal(classify({ link: 'https://www.rfi.fr/br/fran%C3%A7a/x' }), 'mundo');
  assert.equal(classify({ link: 'https://www.bbc.com/portuguese/articles/abc', title: 'Datafolha: Flávio e Lula empatam no 2º turno', fallback: 'mundo' }), 'politica');
  assert.equal(classify({ link: 'https://www.bbc.com/portuguese/articles/abc', title: 'Terremoto atinge o Japão', fallback: 'mundo' }), 'mundo');
});

test('cleanLink rejeita URLs inválidas', () => {
  assert.equal(cleanLink('não é url'), '');
});

test('stripHtml e tokens', () => {
  assert.equal(stripHtml('<p>Olá&nbsp;<em>mundo</em></p>'), 'Olá mundo');
  const t = tokens('Deputados do PT aprovam projeto no DF');
  assert.ok(t.has('deputado') && t.has('pt') && t.has('df') && t.has('aprovam'));
});

test('loteria sai de Economia e vai para Brasil', () => {
  assert.equal(override('Mega-Sena hoje, concurso 3074: confira o resultado', 'economia'), 'brasil');
  assert.equal(override('Copom mantém Selic em 13,75%', 'economia'), 'economia');
});
