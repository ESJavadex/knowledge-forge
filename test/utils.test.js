import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/utils.js';

test('slugify keeps accented letters as their plain form', () => {
  assert.equal(slugify('Lucía Ferrer'), 'lucia-ferrer');
  assert.equal(slugify('Sérum de vitamina C'), 'serum-de-vitamina-c');
  assert.equal(slugify('España'), 'espana');
  assert.equal(slugify('Straße'), 'strasse');
});
