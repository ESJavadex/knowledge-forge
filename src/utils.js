import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const RAW_DIR = path.join(ROOT, 'raw');
export const WIKI_DIR = path.join(ROOT, 'wiki');
export const SOURCE_DIR = path.join(WIKI_DIR, 'sources');
export const CONCEPT_DIR = path.join(WIKI_DIR, 'concepts');
export const ENTITY_DIR = path.join(WIKI_DIR, 'entities');
export const ANALYSIS_DIR = path.join(WIKI_DIR, 'analyses');

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function titleCase(value) {
  return value
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

export function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

export function readMarkdownWithFrontmatter(filePath) {
  const raw = readText(filePath);
  return matter(raw);
}

export function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) results.push(full);
    }
  }
  walk(dir);
  return results;
}

export function wikiLink(name) {
  return `[[${name}]]`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function extractWikiLinks(text) {
  return [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
}
