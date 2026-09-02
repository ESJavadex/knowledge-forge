import test from 'node:test';
import assert from 'node:assert/strict';
import { getWikiContext, getWikiLinks, listWikiPages, readWikiPage, searchWiki } from '../src/wiki-reader.js';

test('wiki navigation use cases list, search, read, and follow backlinks', () => {
  const sources = listWikiPages({ type: 'source' });
  assert.ok(sources.some((page) => page.slug === 'sources/knowledge-graphs-ai.md'));

  const matches = searchWiki('knowledge graph', { limit: 3 });
  assert.equal(matches[0].slug, 'sources/knowledge-graphs-ai.md');
  assert.ok(!matches.some((page) => page.slug === 'index.md' || page.slug === 'log.md'));

  const context = getWikiContext('knowledge graph', { limit: 3 });
  assert.ok(!context.pages.some((page) => page.slug === 'index.md' || page.slug === 'log.md'));
  assert.ok(context.characters <= context.maxChars);

  const source = readWikiPage('sources/knowledge-graphs-ai.md');
  assert.deepEqual(source.provenance.rawSources, ['raw/knowledge-graphs-ai.md']);
  assert.ok(source.outgoingLinks.includes('Knowledge Graph'));

  const links = getWikiLinks('sources/knowledge-graphs-ai.md');
  assert.ok(links.backlinks.some((page) => page.slug === 'entities/knowledge-graph.md'));
});

test('wiki reader rejects paths outside the generated wiki', () => {
  assert.throws(() => readWikiPage('../README.md'), /escapes wiki/);
});
