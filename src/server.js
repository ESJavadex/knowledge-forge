import { marked } from 'marked';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { listMarkdownFiles, WIKI_DIR } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

function getAllPages() {
  const files = listMarkdownFiles(WIKI_DIR);
  const pages = [];

  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    const { data: frontmatter, content: body } = matter(content);
    const rel = f.replace(WIKI_DIR + '/', '');
    const name = path.basename(f, '.md');
    const title = frontmatter.title || name.replace(/-/g, ' ');

    pages.push({
      slug: rel,
      name,
      title,
      type: frontmatter.type || 'page',
      created: frontmatter.created || frontmatter.ingested || null,
      body,
      raw: content,
    });
  }

  return pages;
}

function resolveWikiLinks(html, pages) {
  const pageMap = new Map();
  for (const p of pages) {
    pageMap.set(p.title.toLowerCase().replace(/\s+/g, '-'), p.slug);
    pageMap.set(p.name.toLowerCase().replace(/\s+/g, '-'), p.slug);
  }

  return html.replace(/\[\[([^\]]+)\]\]/g, (match, name) => {
    const slug = pageMap.get(name.toLowerCase().replace(/\s+/g, '-'));
    if (slug) {
      return `<a href="/page/${encodeURIComponent(slug)}" class="wikilink">${name}</a>`;
    }
    return `<span class="dangling" title="Page not found">${name}❓</span>`;
  });
}

export async function startServer() {
  const { default: express } = await import('express');
  const app = express();

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/pages', (_req, res) => {
    const pages = getAllPages();
    const summaries = pages.map(p => ({
      slug: p.slug,
      title: p.title,
      type: p.type,
      created: p.created,
      preview: p.body.slice(0, 150).replace(/[#*`>\-\[\]]/g, '').trim(),
    }));
    res.json(summaries);
  });

  app.get('/api/pages/:slug(*)', async (req, res) => {
    const slug = decodeURIComponent(req.params.slug);
    const filePath = path.join(WIKI_DIR, slug);
    if (!filePath.startsWith(WIKI_DIR) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const { data: frontmatter, content: body } = matter(content);

    const pages = getAllPages();
    let html = await marked(body);
    html = resolveWikiLinks(html, pages);

    res.json({
      slug,
      title: frontmatter.title || path.basename(slug, '.md'),
      type: frontmatter.type || 'page',
      frontmatter,
      html,
      raw: content,
    });
  });

  app.get('/api/stats', (_req, res) => {
    const pages = getAllPages();
    const types = {};
    for (const p of pages) {
      types[p.type] = (types[p.type] || 0) + 1;
    }
    res.json({ total: pages.length, types });
  });

  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`\n📚 LLM Wiki running at http://localhost:${PORT}`);
    console.log(`   ${new Date().toLocaleString()}\n`);
  });
}
