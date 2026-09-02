import test from 'node:test';
import assert from 'node:assert/strict';
import { lexicalQuery, qmdUriToWikiPage, searchHybridIndex } from '../src/hybrid-search.js';

test('hybrid search sends lexical and semantic queries and maps QMD source paths', async () => {
  let request;
  const results = await searchHybridIndex('¿Cómo vivir más años con salud?', {
    endpoint: 'http://127.0.0.1:8181',
    collection: 'forge',
    fetchImpl: async (url, options) => {
      request = { url: String(url), body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => [{
          file: 'qmd://forge/episodio-longevidad.md',
          score: 0.8,
          snippet: 'envejecimiento saludable',
        }],
      };
    },
  });

  assert.equal(request.url, 'http://127.0.0.1:8181/query');
  assert.deepEqual(request.body.collections, ['forge']);
  assert.deepEqual(request.body.searches.map((item) => item.type), ['lex', 'vec']);
  assert.equal(results[0].wikiPage, 'sources/episodio-longevidad.md');
});

test('hybrid search falls back cleanly when the optional sidecar is unavailable', async () => {
  const results = await searchHybridIndex('longevidad', {
    endpoint: 'http://127.0.0.1:8181',
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(results, null);
});

test('lexical query removes filler while the QMD URI mapper rejects unsafe paths', () => {
  assert.equal(lexicalQuery('Dime las conclusiones para la longevidad'), 'las conclusiones longevidad');
  assert.equal(qmdUriToWikiPage('qmd://forge/a.md'), 'sources/a.md');
  assert.equal(qmdUriToWikiPage('qmd://forge/../secret.md'), null);
});
