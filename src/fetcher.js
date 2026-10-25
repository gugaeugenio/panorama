// HTTP com timeout, User-Agent fixo, decodificação de charset e cache condicional (ETag).

import { setDefaultResultOrder } from 'node:dns';

// Redes domésticas com IPv6 mal configurado fazem alguns sites (ex.: UOL) estourarem o tempo.
setDefaultResultOrder('ipv4first');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Panorama/1.0 (leitor pessoal)';

const validators = new Map(); // url -> { etag, lastModified, body }

export class FetchError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function detectCharset(contentType, bytes) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1].toLowerCase();
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const fromXml = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head);
  if (fromXml) return fromXml[1].toLowerCase();
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  if (fromMeta) return fromMeta[1].toLowerCase();
  return 'utf-8';
}

function decode(bytes, charset) {
  let text;
  try {
    text = new TextDecoder(charset).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  // Servidores que não declaram o charset e mandam Latin-1 geram caracteres de substituição.
  if (/utf-?8/i.test(charset) && (text.match(/\uFFFD/g) || []).length > 3) {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text;
}

/**
 * Baixa uma URL e devolve o corpo como texto já decodificado.
 * Com `conditional`, reaproveita o corpo anterior quando o servidor responde 304.
 */
export async function fetchText(url, { timeoutMs = 15000, conditional = false, accept = '*/*' } = {}) {
  const headers = { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6' };
  const cached = conditional ? validators.get(url) : undefined;
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

  let res;
  try {
    res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? `tempo esgotado (${timeoutMs / 1000}s)` : error.cause?.code || error.message;
    throw new FetchError(`Falha de rede: ${reason}`);
  }

  if (res.status === 304 && cached) return { text: cached.body, notModified: true, finalUrl: res.url || url };
  if (!res.ok) throw new FetchError(`HTTP ${res.status}`, res.status);

  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = decode(bytes, detectCharset(res.headers.get('content-type'), bytes));

  if (conditional) {
    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');
    if (etag || lastModified) validators.set(url, { etag, lastModified, body: text });
  }
  return { text, notModified: false, finalUrl: res.url || url };
}

/** Executa tarefas assíncronas com no máximo `limit` simultâneas. */
export async function mapLimit(list, limit, fn) {
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      results[i] = await fn(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
}
