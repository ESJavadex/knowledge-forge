import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
  EVIDENCE_DIR,
  INGEST_MANIFEST_PATH,
  TIMELINE_PATH,
  WIKI_DIR,
  ensureDir,
  nowIso,
  readText,
  writeText,
} from './utils.js';

export function hashFile(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function readIngestManifest() {
  if (!fs.existsSync(INGEST_MANIFEST_PATH)) return { version: 1, sources: {} };
  try {
    const value = JSON.parse(readText(INGEST_MANIFEST_PATH));
    return value && value.version === 1 && value.sources ? value : { version: 1, sources: {} };
  } catch {
    return { version: 1, sources: {} };
  }
}

export function manifestKey(filePath) {
  return path.relative(path.join(WIKI_DIR, '..'), filePath).split(path.sep).join('/');
}

export function isUnchangedSource(filePath, hash, sourcePage, {
  requiredModel,
  requiredSchemaVersion,
} = {}) {
  const record = readIngestManifest().sources[manifestKey(filePath)];
  if (record?.sha256 !== hash || !fs.existsSync(sourcePage)) return false;
  if (requiredModel && record.model !== requiredModel) return false;
  if (requiredSchemaVersion && record.extractionSchemaVersion !== requiredSchemaVersion) return false;
  return true;
}

export function recordIngest(filePath, record) {
  const manifest = readIngestManifest();
  manifest.sources[manifestKey(filePath)] = { ...record, ingestedAt: nowIso() };
  writeJsonAtomic(INGEST_MANIFEST_PATH, manifest);
  updateTimeline(manifest);
}

export function writeEvidence(slug, { fileName, rawSource = `raw/${fileName}`, sha256, extraction, segments }) {
  ensureDir(EVIDENCE_DIR);
  const evidencePath = path.join(EVIDENCE_DIR, `${slug}.json`);
  writeJsonAtomic(evidencePath, {
    version: 1,
    sourceFile: fileName,
    rawSource,
    sha256,
    extraction,
    segments: Array.isArray(segments) ? segments : [],
  });
  return evidencePath;
}

export function readEvidenceForSourceSlug(slug) {
  const evidencePath = path.join(EVIDENCE_DIR, `${slug}.json`);
  if (!fs.existsSync(evidencePath)) return null;
  try {
    return JSON.parse(readText(evidencePath));
  } catch {
    return null;
  }
}

export function updateTimeline(manifest = readIngestManifest()) {
  const events = Object.values(manifest.sources).flatMap((source) =>
    (source.relevantDates || []).map((event) => ({ ...event, source })),
  ).filter((event) => event.date);
  events.sort((left, right) => left.date.localeCompare(right.date) || left.source.sourceTitle.localeCompare(right.source.sourceTitle));

  let body = `---
type: timeline
title: "Timeline"
updated: "${nowIso()}"
---

# Timeline

> Auto-generated from relevant dates extracted during ingestion.

`;
  if (events.length === 0) {
    body += 'No dated events have been extracted yet.\n';
  } else {
    for (const event of events) {
      body += `- **${escapeInline(event.date)}** — ${escapeInline(event.description || 'Relevant event')} — [[${escapeWikiLink(event.source.sourceTitle)}]] (\`${event.source.rawSource || `raw/${path.basename(event.source.fileName)}`}\`)\n`;
    }
  }
  writeText(TIMELINE_PATH, body);
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function escapeInline(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>])/g, '\\$1').trim();
}

function escapeWikiLink(value) {
  return String(value ?? '').replace(/[\[\]\r\n]/g, '').trim();
}
