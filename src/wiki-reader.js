import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { WIKI_DIR, extractWikiLinks, listMarkdownFiles, readText } from './utils.js';
import { searchHybridIndex } from './hybrid-search.js';

export function listWikiPages({ type, category, podcast, from, to, limit = 100 } = {}) {
  return loadPages()
    .filter((page) => matchesFilters(page, { type, category, podcast, from, to }))
    .slice(0, clampLimit(limit))
    .map(publicPage);
}

export function searchWiki(query, { type, category, podcast, from, to, limit = 20 } = {}) {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  return loadPages()
    .filter((page) => page.slug !== 'index.md' && page.slug !== 'log.md')
    .filter((page) => matchesFilters(page, { type, category, podcast, from, to }))
    .map((page) => ({ ...page, score: scorePage(page, terms) }))
    .filter((page) => page.score > 0)
    .sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug))
    .slice(0, clampLimit(limit))
    .map((page) => ({ ...publicPage(page), score: page.score }));
}

export async function searchWikiHybrid(query, { type, category, podcast, from, to, limit = 20 } = {}) {
  const requestedLimit = clampLimit(limit);
  const hybridMatches = await searchHybridIndex(query, { limit: Math.min(requestedLimit * 3, 100) });
  if (!hybridMatches) return searchWiki(query, { type, category, podcast, from, to, limit: requestedLimit });

  const pagesBySlug = new Map(loadPages()
    .filter((page) => page.slug !== 'index.md' && page.slug !== 'log.md')
    .filter((page) => matchesFilters(page, { type, category, podcast, from, to }))
    .map((page) => [page.slug, page]));
  const results = [];
  const seen = new Set();
  for (const match of hybridMatches) {
    const page = pagesBySlug.get(match.wikiPage);
    if (!page || seen.has(page.slug)) continue;
    results.push({ ...publicPage(page), score: match.score });
    seen.add(page.slug);
    if (results.length >= requestedLimit) return results;
  }

  for (const page of searchWiki(query, { type, category, podcast, from, to, limit: requestedLimit * 2 })) {
    if (seen.has(page.slug)) continue;
    results.push(page);
    seen.add(page.slug);
    if (results.length >= requestedLimit) break;
  }
  return results;
}

export function getWikiContext(query, { maxChars = 24_000, limit = 8, ...filters } = {}) {
  const budget = Math.min(Math.max(Number.parseInt(maxChars, 10) || 24_000, 1_000), 80_000);
  const requestedLimit = Math.min(clampLimit(limit), 20);
  const matches = searchWiki(query, { ...filters, limit: Math.min(requestedLimit * 3, 200) })
    .filter((page) => filters.type || page.type !== 'analysis')
    .slice(0, requestedLimit);
  const pages = [];
  let used = 0;
  const perPageBudget = matches.length > 0 ? Math.floor(budget / matches.length) : budget;
  for (const match of matches) {
    const page = readWikiPage(match.slug);
    const header = `# ${page.title}\nWiki page: ${page.slug}\nRaw sources: ${page.provenance.rawSources.join(', ') || 'none'}\n\n`;
    const remaining = Math.min(budget - used - header.length, Math.max(500, perPageBudget - header.length));
    if (remaining <= 0) break;
    const markdown = page.markdown.slice(0, remaining);
    pages.push({
      slug: page.slug,
      title: page.title,
      type: page.type,
      score: match.score,
      provenance: page.provenance,
      markdown,
      truncated: markdown.length < page.markdown.length,
    });
    used += header.length + markdown.length;
  }
  return { query, pages, pageCount: pages.length, characters: used, maxChars: budget };
}

export async function getWikiContextHybrid(query, { maxChars = 24_000, limit = 8, ...filters } = {}) {
  const budget = Math.min(Math.max(Number.parseInt(maxChars, 10) || 24_000, 1_000), 80_000);
  const requestedLimit = Math.min(clampLimit(limit), 20);
  const matches = (await searchWikiHybrid(query, {
    ...filters,
    limit: Math.min(requestedLimit * 3, 200),
  })).filter((page) => filters.type || page.type !== 'analysis').slice(0, requestedLimit);
  return buildContext(query, matches, budget);
}

function buildContext(query, matches, budget) {
  const pages = [];
  let used = 0;
  const perPageBudget = matches.length > 0 ? Math.floor(budget / matches.length) : budget;
  for (const match of matches) {
    const page = readWikiPage(match.slug);
    const header = `# ${page.title}\nWiki page: ${page.slug}\nRaw sources: ${page.provenance.rawSources.join(', ') || 'none'}\n\n`;
    const remaining = Math.min(budget - used - header.length, Math.max(500, perPageBudget - header.length));
    if (remaining <= 0) break;
    const markdown = page.markdown.slice(0, remaining);
    pages.push({
      slug: page.slug,
      title: page.title,
      type: page.type,
      score: match.score,
      provenance: page.provenance,
      markdown,
      truncated: markdown.length < page.markdown.length,
    });
    used += header.length + markdown.length;
  }
  return { query, pages, pageCount: pages.length, characters: used, maxChars: budget };
}

export function getWikiFacets() {
  const pages = loadPages();
  return {
    types: countValues(pages.map((page) => page.type)),
    categories: countValuesNormalized(pages.flatMap((page) => page.frontmatter.categories || [])),
    podcasts: countValues(pages.map(podcastFromPage).filter(Boolean)),
    models: countValues(pages.map((page) => page.frontmatter.model).filter(Boolean)),
  };
}

export function getWikiStatus() {
  const manifestPath = path.join(WIKI_DIR, '.ingest-manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(readText(manifestPath)) : { sources: {} };
  const sources = Object.values(manifest.sources || {});
  return {
    generatedPages: loadPages().length,
    ingestedSources: sources.length,
    extractionModes: countValues(sources.map((source) => source.extractionMode || 'unknown')),
    schemaVersions: countValues(sources.map((source) => String(source.extractionSchemaVersion || 'unknown'))),
    models: countValues(sources.map((source) => source.model || 'none')),
    latestIngest: sources.map((source) => source.ingestedAt || source.ingested || null).filter(Boolean).sort().at(-1) || null,
  };
}

export function readWikiPage(slug) {
  const filePath = resolveWikiPath(slug);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`Wiki page not found: ${slug}`);
  const raw = readText(filePath);
  const { data, content } = matter(raw);
  const catalogEntry = loadPages().find((page) => page.slug === relativeSlug(filePath));
  return {
    slug: relativeSlug(filePath),
    title: data.title || path.basename(filePath, '.md').replace(/-/g, ' '),
    type: data.type || 'page',
    frontmatter: data,
    outgoingLinks: extractWikiLinks(content),
    markdown: raw,
    provenance: catalogEntry?.provenance || provenanceFromFrontmatter(data),
  };
}

export function getWikiLinks(slug) {
  const target = readWikiPage(slug);
  const normalizedTitle = normalize(target.title);
  const normalizedName = normalize(path.basename(target.slug, '.md').replace(/-/g, ' '));
  const backlinks = loadPages().filter((page) => page.slug !== target.slug && page.links.some((link) => {
    const normalized = normalize(link);
    return normalized === normalizedTitle || normalized === normalizedName;
  })).map(publicPage);
  return { page: publicPage(target), outgoingLinks: target.outgoingLinks, backlinks };
}

function loadPages() {
  const pages = listMarkdownFiles(WIKI_DIR).map((filePath) => {
    const raw = readText(filePath);
    const { data, content } = matter(raw);
    return {
      slug: relativeSlug(filePath),
      title: data.title || path.basename(filePath, '.md').replace(/-/g, ' '),
      type: data.type || 'page',
      created: data.created || data.ingested || data.updated || null,
      content,
      links: extractWikiLinks(content),
      provenance: provenanceFromFrontmatter(data),
      frontmatter: data,
    };
  });
  const sourceByTitle = new Map();
  for (const page of pages) {
    for (const rawSource of page.provenance.rawSources) sourceByTitle.set(normalize(page.title), rawSource);
  }
  for (const page of pages) {
    const rawSources = new Set(page.provenance.rawSources);
    for (const source of Array.isArray(page.frontmatter.sources) ? page.frontmatter.sources : []) {
      const rawSource = sourceByTitle.get(normalize(source));
      if (rawSource) rawSources.add(rawSource);
    }
    for (const link of page.links) {
      const rawSource = sourceByTitle.get(normalize(link));
      if (rawSource) rawSources.add(rawSource);
    }
    page.provenance = { rawSources: [...rawSources].sort() };
  }
  return pages.sort((left, right) => left.slug.localeCompare(right.slug));
}

function publicPage(page) {
  return {
    slug: page.slug,
    title: page.title,
    type: page.type,
    created: page.created || null,
    preview: page.content?.replace(/[#*`>\-\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240) || '',
    provenance: page.provenance || provenanceFromFrontmatter(page.frontmatter || {}),
    categories: Array.isArray(page.frontmatter?.categories) ? page.frontmatter.categories : [],
    podcast: podcastFromPage(page),
  };
}

function matchesFilters(page, { type, category, podcast, from, to }) {
  if (type && page.type !== type) return false;
  if (category && !(page.frontmatter.categories || []).some((item) => normalize(item) === normalize(category))) return false;
  if (podcast && normalize(podcastFromPage(page)).includes(normalize(podcast)) === false) return false;
  const date = page.frontmatter.published || page.created;
  if (from && (!date || String(date) < from)) return false;
  if (to && (!date || String(date) > to)) return false;
  return true;
}

function podcastFromPage(page) {
  if (typeof page.frontmatter?.podcast === 'string') return page.frontmatter.podcast;
  const sourceFile = page.frontmatter?.source_file;
  const match = typeof sourceFile === 'string' ? sourceFile.match(/^media\/([^/]+)\//) : null;
  return match?.[1] || null;
}

function countValues(values) {
  const counts = {};
  for (const value of values) {
    const key = String(value).trim();
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function countValuesNormalized(values) {
  const entries = new Map();
  for (const value of values) {
    const display = String(value).trim();
    const key = normalize(display);
    if (!key) continue;
    const current = entries.get(key);
    entries.set(key, { display: current?.display || display, count: (current?.count || 0) + 1 });
  }
  return Object.fromEntries([...entries.values()]
    .sort((left, right) => right.count - left.count || left.display.localeCompare(right.display))
    .map(({ display, count }) => [display, count]));
}

function provenanceFromFrontmatter(data) {
  const rawSources = [];
  if (typeof data.source_file === 'string') rawSources.push(`raw/${data.source_file.replace(/\\/g, '/').replace(/^\/+/, '')}`);
  if (Array.isArray(data.raw_sources)) rawSources.push(...data.raw_sources.filter((item) => typeof item === 'string' && item.startsWith('raw/')));
  return { rawSources: [...new Set(rawSources)] };
}

function resolveWikiPath(slug) {
  if (typeof slug !== 'string' || !slug.trim()) throw new Error('A wiki page slug is required.');
  const requested = slug.endsWith('.md') ? slug : `${slug}.md`;
  const resolved = path.resolve(WIKI_DIR, requested);
  if (resolved !== WIKI_DIR && !resolved.startsWith(`${WIKI_DIR}${path.sep}`)) throw new Error('Wiki page path escapes wiki/.');
  if (fs.existsSync(resolved)) {
    const realWiki = fs.realpathSync(WIKI_DIR);
    const realPage = fs.realpathSync(resolved);
    if (!realPage.startsWith(`${realWiki}${path.sep}`)) throw new Error('Wiki page symlink escapes wiki/.');
  }
  return resolved;
}

function relativeSlug(filePath) {
  return path.relative(WIKI_DIR, filePath).split(path.sep).join('/');
}

function scorePage(page, terms) {
  const title = normalize(page.title);
  const body = normalize(page.content);
  return terms.reduce((score, term) => score + (title.includes(term) ? 8 : 0) + countMatches(body, term, 10), 0);
}

function countMatches(value, term, limit) {
  let count = 0;
  let cursor = 0;
  while ((cursor = value.indexOf(term, cursor)) !== -1 && count < limit) {
    count += 1;
    cursor += term.length;
  }
  return count;
}

function tokenize(value) {
  return [...new Set(normalize(value).split(/[^a-z0-9]+/).filter((term) => term.length > 1))];
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

function clampLimit(limit) {
  const parsed = Number.parseInt(limit, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 200) : 100;
}
