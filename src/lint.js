import { listMarkdownFiles, readText, WIKI_DIR, SOURCE_DIR, CONCEPT_DIR, ENTITY_DIR } from './utils.js';
import { extractWikiLinks, slugify } from './utils.js';

const keyOf = (value) => slugify(String(value));
const titleOf = (content) => {
  const match = content.match(/^---[\s\S]*?^title:\s*"?(.+?)"?\s*$[\s\S]*?^---/m);
  return match ? match[1] : null;
};

/**
 * Lint the wiki: find orphans, missing backlinks, and inconsistencies.
 */
export function lintWiki() {
  const issues = [];

  // Gather all pages
  const allPages = [
    ...listMarkdownFiles(SOURCE_DIR),
    ...listMarkdownFiles(CONCEPT_DIR),
    ...listMarkdownFiles(ENTITY_DIR),
    ...listMarkdownFiles(`${WIKI_DIR}/analyses`),
  ];

  // Build a map: normalized name -> list of files containing that link
  const linkTargets = new Map();
  for (const page of allPages) {
    const content = readText(page);
    const links = extractWikiLinks(content);
    for (const link of links) {
      const normalized = keyOf(link);
      if (!linkTargets.has(normalized)) linkTargets.set(normalized, []);
      linkTargets.set(normalized, linkTargets.get(normalized).concat([page]));
    }
  }

  // Build a map: page key (file name or frontmatter title) -> page path
  const pageBySlug = new Map();
  const keysByPage = new Map();
  for (const page of allPages) {
    const name = page
      .replace(WIKI_DIR + '/', '')
      .replace('.md', '')
      .split('/')
      .pop();
    const keys = new Set([keyOf(name)]);
    const title = titleOf(readText(page));
    if (title) keys.add(keyOf(title));
    keysByPage.set(page, keys);
    for (const key of keys) pageBySlug.set(key, page);
  }

  // 1. Check for orphan pages (no inbound links from other pages)
  for (const page of allPages) {
    const keys = keysByPage.get(page);

    const inbound = allPages.filter(p => {
      if (p === page) return false;
      const content = readText(p);
      const links = extractWikiLinks(content);
      return links.some(l => keys.has(keyOf(l)));
    });

    if (inbound.length === 0 && !page.endsWith('index.md') && !page.endsWith('log.md')) {
      const shortPath = page.replace(WIKI_DIR + '/', '');
      issues.push({ type: 'orphan', severity: 'info', page: shortPath, message: 'No other pages link to this page.' });
    }
  }

  // 2. Check for dangling links (links to pages that don't exist)
  for (const page of allPages) {
    const content = readText(page);
    const links = extractWikiLinks(content);
    const shortPage = page.replace(WIKI_DIR + '/', '');

    for (const link of links) {
      const normalized = keyOf(link);
      if (!pageBySlug.has(normalized)) {
        issues.push({ type: 'dangling', severity: 'warn', page: shortPage, message: `Link [[${link}]] points to a page that does not exist.` });
      }
    }
  }

  // 3. Check for pages without frontmatter
  for (const page of allPages) {
    const content = readText(page);
    if (!content.startsWith('---')) {
      const shortPath = page.replace(WIKI_DIR + '/', '');
      issues.push({ type: 'no-frontmatter', severity: 'info', page: shortPath, message: 'Missing YAML frontmatter.' });
    }
  }

  // Report
  if (issues.length === 0) {
    console.log('✅ Wiki looks clean! No issues found.');
  } else {
    const byType = {};
    for (const i of issues) {
      byType[i.type] = byType[i.type] || [];
      byType[i.type].push(i);
    }

    for (const [type, items] of Object.entries(byType)) {
      const icon = type === 'orphan' ? '👻' : type === 'dangling' ? '🔗' : '📋';
      console.log(`\n${icon} ${type} (${items.length})`);
      for (const item of items) {
        console.log(`  ${item.severity === 'warn' ? '⚠️' : 'ℹ️'} ${item.page}: ${item.message}`);
      }
    }

    console.log(`\nTotal: ${issues.length} issues`);
  }

  return issues;
}
