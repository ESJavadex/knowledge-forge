import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGroundedAnswer } from '../src/query.js';

const documents = [{
  wikiPage: 'sources/informe-medico.md',
  title: 'Informe Medico',
  type: 'source',
  rawSources: ['raw/informe-medico.pdf'],
  content: 'Se recetó una pomada el 3 de marzo.',
}];

test('query validation keeps only claims with an exact wiki/raw citation pair', () => {
  const result = validateGroundedAnswer({
    found: true,
    claims: [
      {
        text: 'Se recetó una pomada el 3 de marzo.',
        citations: [{ wiki_page: 'sources/informe-medico.md', raw_source: 'raw/informe-medico.pdf' }],
      },
      {
        text: 'La dosis fue dos veces al día.',
        citations: [{ wiki_page: 'sources/informe-medico.md', raw_source: 'raw/otro.pdf' }],
      },
    ],
  }, documents);

  assert.equal(result.found, true);
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].citations[0].wikiTitle, 'Informe Medico');
});

test('query validation returns not found when every model claim is unsupported', () => {
  const result = validateGroundedAnswer({
    found: true,
    claims: [{ text: 'Invented', citations: [] }],
  }, documents);

  assert.deepEqual(result, { found: false, claims: [] });
});
