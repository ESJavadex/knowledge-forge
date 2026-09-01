import fs from 'fs';
import path from 'path';
import { slugify, titleCase, wikiLink, nowIso, ensureDir, writeText, listMarkdownFiles, WIKI_DIR, SOURCE_DIR, CONCEPT_DIR, ENTITY_DIR } from './utils.js';
import { readSourceDocument } from './adapters/source-reader.js';
import { extractSemantics } from './extraction.js';
import { createOpenRouterGenerator } from './adapters/openrouter.js';

/**
 * Ingest a raw source file into the wiki.
 */
export async function ingestSource(filePath, {
  generator = createOpenRouterGenerator(),
  sourceReader = readSourceDocument,
  logger = console,
} = {}) {
  const fileName = path.basename(filePath);
  const text = sourceReader(filePath);

  // 1. Create source summary
  const slug = slugify(fileName.slice(0, -path.extname(fileName).length) || fileName);
  const sourceTitle = titleCase(slug.replace(/-/g, ' '));
  const sourcePath = path.join(SOURCE_DIR, `${slug}.md`);

  const extraction = await extractSemantics({ text, fileName, generator, logger });
  const { concepts, entities, summary } = extraction;

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
    const title = titleCase(c.name);
    sourceContent += `- ${wikiLink(title)} (${c.count} mentions)\n`;
  }

  sourceContent += `\n## Key Entities\n\n`;

  for (const e of entities.slice(0, 15)) {
    const title = titleCase(e.name);
    sourceContent += `- ${wikiLink(title)} (${e.count} mentions)\n`;
  }

  sourceContent += `\n---\n> Raw source: \`raw/${fileName}\`\n`;

  writeText(sourcePath, sourceContent);
  console.log(`  📄 Source page: wiki/sources/${slug}.md`);

  // 2. Update concept pages
  const touchedPages = [sourcePath];
  for (const c of concepts.slice(0, 10)) {
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

  // 4. Update index
  updateIndex();

  // 5. Append to log
  appendLog('ingest', sourceTitle, fileName);

  return {
    sourceTitle,
    concepts: concepts.length,
    entities: entities.length,
    relevantDates: extraction.relevantDates,
    extractionMode: extraction.mode,
    touchedPages,
  };
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
