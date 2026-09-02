const DEFAULT_TIMEOUT_MS = 12_000;

export async function searchHybridIndex(query, {
  limit = 24,
  fetchImpl = globalThis.fetch,
  endpoint = process.env.KNOWLEDGE_FORGE_QMD_URL || 'http://127.0.0.1:8181',
  collection = process.env.KNOWLEDGE_FORGE_QMD_COLLECTION || 'forge',
  required = process.env.KNOWLEDGE_FORGE_QMD_REQUIRED === 'true',
} = {}) {
  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  if (!cleanQuery || !endpoint || endpoint === 'off') return null;

  const searches = [
    { type: 'lex', query: lexicalQuery(cleanQuery) },
    { type: 'vec', query: cleanQuery },
  ].filter((search) => search.query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(new URL('/query', endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        searches,
        collections: [collection],
        limit: Math.min(Math.max(Number.parseInt(limit, 10) || 24, 1), 100),
        candidateLimit: 50,
        rerank: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`QMD returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('QMD returned a non-array response.');

    return payload.map((result, index) => ({
      wikiPage: qmdUriToWikiPage(result?.file),
      score: Number.isFinite(result?.score) ? result.score : 1 / (index + 1),
      snippet: typeof result?.snippet === 'string' ? result.snippet : '',
    })).filter((result) => result.wikiPage);
  } catch (error) {
    if (required) throw new Error(`Hybrid search unavailable: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function lexicalQuery(value) {
  return [...new Set(normalize(value).split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term)))]
    .join(' ');
}

export function qmdUriToWikiPage(value) {
  if (typeof value !== 'string' || !value.startsWith('qmd://')) return null;
  try {
    if (decodeURIComponent(value).split('/').includes('..')) return null;
    const pathname = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, '');
    if (!pathname || pathname.includes('..')) return null;
    return `sources/${pathname}`;
  } catch {
    return null;
  }
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

const STOP_WORDS = new Set([
  'and', 'como', 'con', 'cual', 'cuando', 'dime', 'para', 'por', 'que', 'the', 'una',
]);
