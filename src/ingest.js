import { readText, slugify, titleCase, wikiLink, nowIso, ensureDir, writeText, listMarkdownFiles, extractWikiLinks, WIKI_DIR, SOURCE_DIR, CONCEPT_DIR, ENTITY_DIR, RAW_DIR } from './utils.js';

/**
 * Analyze a text and extract candidate concepts/entities.
 * Uses simple frequency heuristics + common stop-words.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'as', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
  'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very', 'just',
  'about', 'above', 'after', 'again', 'all', 'also', 'am', 'any', 'because',
  'before', 'between', 'both', 'each', 'few', 'further', 'get', 'got', 'he',
  'her', 'here', 'him', 'his', 'how', 'i', 'into', 'its', 'let', 'like',
  'make', 'me', 'more', 'most', 'much', 'must', 'my', 'new', 'now', 'old',
  'only', 'other', 'our', 'out', 'own', 'per', 'put', 'same', 'she', 'some',
  'still', 'such', 'take', 'their', 'them', 'there', 'these', 'they', 'those',
  'through', 'time', 'under', 'up', 'us', 'use', 'used', 'using', 'via',
  'want', 'we', 'well', 'what', 'when', 'where', 'which', 'while', 'who',
  'why', 'you', 'your', 'one', 'two', 'way', 'many', 'even', 'back',
  'over', 'work', 'first', 'down', 'since', 'off', 'come', 'around',
  'long', 'every', 'year', 'good', 'give', 'most', 'day', 'look',
]);

const MIN_LEN = 3;
const MAX_EXTRACTS = 30;

function extractCandidates(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  const freq = {};

  for (const w of words) {
    if (w.length >= MIN_LEN && !STOP_WORDS.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }

  // Bigrams
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i], b = words[i + 1];
    if (!STOP_WORDS.has(a) && !STOP_WORDS.has(b) && a.length >= MIN_LEN && b.length >= MIN_LEN) {
      const bigram = `${a} ${b}`;
      freq[bigram] = (freq[bigram] || 0) + 2; // slight boost
    }
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_EXTRACTS)
    .map(([word, count]) => ({ word, count }));
}

function classifyCandidate(word) {
  // Simple heuristic: longer phrases and capitalized terms tend to be entities
  const lower = word.toLowerCase();
  const entityIndicators = ['http', 'api', 'llm', 'rag', 'wiki', 'mcp', 'ai', 'gpt', 'claude', 'gemini', 'obsidian'];
  const isEntity = word.includes(' ') || entityIndicators.some(e => lower.includes(e));
  return isEntity ? 'entity' : 'concept';
}

/**
 * Ingest a raw source file into the wiki.
 */
export function ingestSource(filePath) {
  const fileName = path.basename(filePath);
  const text = readText(filePath);

  // 1. Create source summary
  const slug = slugify(fileName.replace(/\.md$/, ''));
  const sourceTitle = titleCase(slug.replace(/-/g, ' '));
  const sourcePath = path.join(SOURCE_DIR, `${slug}.md`);

  const candidates = extractCandidates(text);

  // Separate into concepts and entities
  const concepts = candidates.filter(c => classifyCandidate(c.word) === 'concept');
  const entities = candidates.filter(c => classifyCandidate(c.word) === 'entity');

  // Extract first paragraph as summary
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 20);
  const summary = paragraphs[0]?.replace(/^#+\s/gm, '').slice(0, 500) || 'No summary available.';

  let sourceContent = `---
type: source
title: "${sourceTitle}"
source_file: "${fileName}"
ingested: "${nowIso()}"
concept_count: ${concepts.length}
entity_count: ${entities.length}
---

# ${sourceTitle}

> Source: \`${fileName}\`

## Summary

${summary}

## Key Concepts

`;

  for (const c of concepts.slice(0, 15)) {
    const title = titleCase(c.word);
    sourceContent += `- ${wikiLink(title)} (${c.count} mentions)\n`;
  }

  sourceContent += `\n## Key Entities\n\n`;

  for (const e of entities.slice(0, 15)) {
    const title = titleCase(e.word);
    sourceContent += `- ${wikiLink(title)} (${e.count} mentions)\n`;
  }

  sourceContent += `\n---\n> Raw source: \`raw/${fileName}\`\n`;

  writeText(sourcePath, sourceContent);
  console.log(`  📄 Source page: wiki/sources/${slug}.md`);

  // 2. Update concept pages
  const touchedPages = [sourcePath];
  for (const c of concepts.slice(0, 10)) {
    const title = titleCase(c.word);
    const cSlug = slugify(c.word);
    const cPath = path.join(CONCEPT_DIR, `${cSlug}.md`);
    touchedPages.push(updateOrCreatePage(cPath, title, 'concept', sourceTitle, c.count, summary.slice(0, 200)));
  }

  // 3. Update entity pages
  for (const e of entities.slice(0, 10)) {
    const title = titleCase(e.word);
    const eSlug = slugify(e.word);
    const ePath = path.join(ENTITY_DIR, `${eSlug}.md`);
    touchedPages.push(updateOrCreatePage(ePath, title, 'entity', sourceTitle, e.count, summary.slice(0, 200)));
  }

  // 4. Update index
  updateIndex();

  // 5. Append to log
  appendLog('ingest', sourceTitle, fileName);

  return { sourceTitle, concepts: concepts.length, entities: entities.length, touchedPages };
}

function updateOrCreatePage(pagePath, title, type, sourceTitle, mentions, excerpt) {
  ensureDir(path.dirname(pagePath));

  let content;
  if (fs.existsSync(pagePath)) {
    const existing = readText(pagePath);
    const now = nowIso();

    if (!existing.includes(wikiLink(sourceTitle))) {
      // Append new source reference
      content = existing + `\n## ${sourceTitle} (${now})\n\n> Mentioned ${mentions}x\n>\n> ${excerpt}\n\n${wikiLink(sourceTitle)}\n`;
    } else {
      content = existing;
    }

    // Update mention count in frontmatter
    const lines = content.split('\n');
    const idx = lines.findIndex(l => l.startsWith('mention_count:'));
    if (idx !== -1) {
      const prev = parseInt(lines[idx].match(/\d+/)?.[0] || '0', 10);
      lines[idx] = `mention_count: ${prev + mentions}`;
      content = lines.join('\n');
    }
  } else {
    content = `---
type: ${type}
title: "${title}"
created: "${nowIso()}"
mention_count: ${mentions}
sources: ["${sourceTitle}"]
---

# ${title}

## ${sourceTitle}

> Mentioned ${mentions}x
>
> ${excerpt}

${wikiLink(sourceTitle)}
`;
  }

  writeText(pagePath, content);
  const shortPath = pagePath.replace(WIKI_DIR + '/', '');
  console.log(`  ${type === 'concept' ? '💡' : '👤'} ${shortPath}`);
  return pagePath;
}

export function updateIndex() {
  const allPages = [
    ...listMarkdownFiles(SOURCE_DIR),
    ...listMarkdownFiles(CONCEPT_DIR),
    ...listMarkdownFiles(ENTITY_DIR),
    ...listMarkdownFiles(path.join(WIKI_DIR, 'analyses')),
  ];

  let index = `# Wiki Index\n\n> Auto-generated. Updated: ${nowIso()}\n\n`;

  const categories = {
    'Sources': allPages.filter(f => f.includes('/sources/')),
    'Concepts': allPages.filter(f => f.includes('/concepts/')),
    'Entities': allPages.filter(f => f.includes('/entities/')),
    'Analyses': allPages.filter(f => f.includes('/analyses/')),
  };

  for (const [cat, files] of Object.entries(categories)) {
    if (files.length === 0) continue;
    index += `## ${cat}\n\n`;
    for (const f of files) {
      const name = path.basename(f, '.md').replace(/-/g, ' ');
      const title = titleCase(name);
      const rel = f.replace(WIKI_DIR + '/', '');
      index += `- [[${title}]] — \`wiki/${rel}\`\n`;
    }
    index += '\n';
  }

  writeText(path.join(WIKI_DIR, 'index.md'), index);
  console.log('  📋 Index updated');
}

export function appendLog(action, title, detail) {
  const logPath = path.join(WIKI_DIR, 'log.md');
  ensureDir(WIKI_DIR);

  const date = new Date().toISOString().split('T')[0];
  const entry = `\n## [${date}] ${action} | ${title}\n\n- Detail: ${detail}\n- Timestamp: ${nowIso()}\n`;

  if (fs.existsSync(logPath)) {
    fs.appendFileSync(logPath, entry);
  } else {
    writeText(logPath, `# Wiki Log\n${entry}`);
  }

  console.log('  📝 Log entry appended');
}

import path from 'path';
import fs from 'fs';
