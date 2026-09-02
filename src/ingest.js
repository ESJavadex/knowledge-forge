import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { slugify, titleCase, wikiLink, nowIso, ensureDir, readText, writeText, listMarkdownFiles, toRawSourceReference, WIKI_DIR, SOURCE_DIR, CONCEPT_DIR, ENTITY_DIR } from './utils.js';
import { readSourceWithEvidence } from './adapters/source-reader.js';
import { extractSemantics } from './extraction.js';
import { createOpenRouterGenerator } from './adapters/openrouter.js';
import { hashFile, isUnchangedSource, recordIngest, writeEvidence } from './ingest-state.js';

export const SUPPORTED_SOURCE_EXTENSIONS = new Set(['.md', '.txt', '.pdf', '.docx']);
export const EXTRACTION_SCHEMA_VERSION = 4;

/**
 * Ingest a raw source file into the wiki.
 */
export async function ingestSource(filePath, {
  generator = createOpenRouterGenerator(),
  sourceReader = readSourceWithEvidence,
  logger = console,
  force = false,
  requireSemantic = process.env.LLM_REQUIRE_SEMANTIC === 'true',
} = {}) {
  const fileName = path.basename(filePath);
  const rawSource = toRawSourceReference(filePath);
  const sourceFile = rawSource.slice('raw/'.length);
  const sourceName = sourceFile.slice(0, -path.extname(sourceFile).length) || sourceFile;
  const slug = slugify(sourceName.replace(/[\\/]/g, '-'));
  const sourceMetadata = readSourceMetadata(filePath);
  const sourceTitle = deriveSourceTitle(sourceMetadata, slug);
  const sourcePath = path.join(SOURCE_DIR, `${slug}.md`);
  const sha256 = hashFile(filePath);

  if (!force && isUnchangedSource(filePath, sha256, sourcePath, {
    requiredModel: requireSemantic ? generator?.model : undefined,
    requiredSchemaVersion: EXTRACTION_SCHEMA_VERSION,
  })) {
    logger.log(`  ⏭️  Unchanged: ${fileName}`);
    return { sourceTitle, skipped: true, reason: 'unchanged', touchedPages: [] };
  }

  const sourceDocument = sourceReader(filePath);
  const document = typeof sourceDocument === 'string'
    ? { text: sourceDocument, segments: [{ locator: 'document', text: sourceDocument }], extraction: 'text' }
    : sourceDocument;
  const text = document.text;

  const extraction = await extractSemantics({ text, fileName, generator, logger, requireSemantic });
  const {
    categories = [],
    concepts,
    entities,
    summary,
    keyPoints = [],
    conclusions = [],
    recommendations = [],
    notableQuotes = [],
    openQuestions = [],
  } = extraction;

  let sourceContent = `---
type: source
title: ${JSON.stringify(sourceTitle)}
source_file: ${JSON.stringify(sourceFile)}
ingested: "${nowIso()}"
concept_count: ${concepts.length}
entity_count: ${entities.length}
categories: ${JSON.stringify(categories)}
extraction_mode: ${JSON.stringify(extraction.mode)}
model: ${JSON.stringify(extraction.mode === 'heuristic' ? null : generator?.model || null)}
${renderOptionalFrontmatter(sourceMetadata)}
---

# ${sourceTitle}

> Source: \`${sourceFile}\`

## Summary

${summary}

## Categories

${renderWikiList(categories)}

## Key Points

${renderList(keyPoints)}

## Conclusions

${renderList(conclusions)}

## Recommendations From the Source

${renderList(recommendations)}

## Notable Quotes

${renderQuotes(notableQuotes)}

## Open Questions and Uncertainty

${renderList(openQuestions)}

## Key Concepts

`;

  for (const c of concepts.slice(0, 15)) {
    const title = titleCase(c.name);
    sourceContent += `- ${wikiLink(title)} (${c.count} mentions)\n`;
  }

  sourceContent += `\n## Key Entities\n\n`;

  for (const e of entities.slice(0, 15)) {
    const title = titleCase(e.name);
    sourceContent += `- ${wikiLink(title)} (${e.count} mentions)\n`;
  }

  sourceContent += `\n---\n> Raw source: \`${rawSource}\`\n`;

  writeText(sourcePath, sourceContent);
  console.log(`  📄 Source page: wiki/sources/${slug}.md`);

  // 2. Update concept pages
  const touchedPages = [sourcePath];
  const conceptCandidates = dedupeNamedItems([
    ...categories.map((name) => ({ name, count: 1 })),
    ...concepts,
  ]);
  for (const c of conceptCandidates.slice(0, 15)) {
    const title = titleCase(c.name);
    const cSlug = slugify(c.name);
    const cPath = path.join(CONCEPT_DIR, `${cSlug}.md`);
    touchedPages.push(updateOrCreatePage(cPath, title, 'concept', sourceTitle, c.count, summary.slice(0, 200)));
  }

  // 3. Update entity pages
  for (const e of entities.slice(0, 10)) {
    const title = titleCase(e.name);
    const eSlug = slugify(e.name);
    const ePath = path.join(ENTITY_DIR, `${eSlug}.md`);
    touchedPages.push(updateOrCreatePage(ePath, title, 'entity', sourceTitle, e.count, summary.slice(0, 200)));
  }

  const evidencePath = writeEvidence(slug, {
    fileName: sourceFile,
    rawSource,
    sha256,
    extraction: document.extraction,
    segments: document.segments,
  });

  recordIngest(filePath, {
    fileName: sourceFile,
    rawSource,
    sourceTitle,
    sourcePage: `sources/${slug}.md`,
    sha256,
    bytes: fs.statSync(filePath).size,
    extractionMode: extraction.mode,
    extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
    model: extraction.mode === 'heuristic' ? null : generator?.model || null,
    categories,
    sourceMetadata,
    relevantDates: extraction.relevantDates,
  });

  // 4. Update index and timeline
  updateIndex();

  // 5. Append to log
  appendLog('ingest', sourceTitle, fileName);

  return {
    sourceTitle,
    concepts: concepts.length,
    entities: entities.length,
    relevantDates: extraction.relevantDates,
    extractionMode: extraction.mode,
    touchedPages: [...touchedPages, evidencePath],
  };
}

function readSourceMetadata(filePath) {
  if (path.extname(filePath).toLowerCase() === '.md') {
    const parsed = matter(fs.readFileSync(filePath, 'utf8'));
    const metadata = { ...parsed.data };
    Object.defineProperty(metadata, '_heading', { value: parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim() || '' });
    return metadata;
  }
  return {};
}

function deriveSourceTitle(metadata, fallbackSlug) {
  if (metadata && typeof metadata === 'object') {
    const title = typeof metadata.title === 'string' ? metadata.title.trim() : '';
    const collection = typeof metadata.podcast === 'string' ? metadata.podcast.trim() : '';
    if (title) return collection ? `${collection} — ${title}` : title;
    if (metadata._heading) return metadata._heading;
  }
  return titleCase(fallbackSlug.replace(/-/g, ' '));
}

function renderOptionalFrontmatter(metadata) {
  const allowed = ['podcast', 'published', 'source_type', 'source_url', 'show_url', 'duration_seconds'];
  return allowed
    .filter((key) => ['string', 'number'].includes(typeof metadata[key]))
    .map((key) => `${key}: ${JSON.stringify(metadata[key])}`)
    .join('\n');
}

function renderList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '_None extracted._';
}

function renderWikiList(items) {
  return items.length > 0 ? items.map((item) => `- ${wikiLink(titleCase(item))}`).join('\n') : '_None extracted._';
}

function renderQuotes(items) {
  if (items.length === 0) return '_None extracted._';
  return items.map(({ quote, context }) => `> “${quote}”${context ? `\n> — ${context}` : ''}`).join('\n\n');
}

function dedupeNamedItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.name.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function ingestPath(inputPath, options = {}) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) throw new Error(`Source path does not exist: ${inputPath}`);
  const files = fs.statSync(resolved).isDirectory() ? listSourceFiles(resolved) : [resolved];
  const supported = files.filter((file) => SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  if (supported.length === 0) throw new Error(`No supported sources found in: ${inputPath}`);

  const results = [];
  for (const file of supported) {
    options.logger?.log?.(`\n📥 Ingesting: ${path.basename(file)}`);
    results.push(await ingestSource(file, options));
  }
  return results;
}

function listSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files.sort();
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
title: ${JSON.stringify(title)}
created: "${nowIso()}"
mention_count: ${mentions}
sources: [${JSON.stringify(sourceTitle)}]
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

  if (fs.existsSync(path.join(WIKI_DIR, 'timeline.md'))) {
    index += `## Timeline\n\n- [[Timeline]] — \`wiki/timeline.md\`\n\n`;
  }

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
