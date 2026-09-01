#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RAW_DIR } from './utils.js';
import { ingestPath } from './ingest.js';
import { getWikiLinks, listWikiPages, readWikiPage, searchWiki } from './wiki-reader.js';

// stdout belongs exclusively to the MCP stdio transport.
console.log = (...args) => console.error(...args);

const server = new Server({ name: 'knowledge-forge', version: '0.2.0' }, {
  capabilities: { resources: {}, tools: {} },
  instructions: 'Navigate the generated wiki with list/search/read/links. Ingest only files already placed under raw/. Never claim raw provenance that a page does not expose.',
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  {
    name: 'wiki_list',
    description: 'List generated wiki pages, optionally filtered by page type.',
    inputSchema: objectSchema({ type: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }),
  },
  {
    name: 'wiki_search',
    description: 'Search page titles and markdown text using deterministic lexical matching.',
    inputSchema: objectSchema({ query: { type: 'string', minLength: 1 }, type: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['query']),
  },
  {
    name: 'wiki_read',
    description: 'Read one wiki page as markdown with frontmatter, outgoing links, and raw-source provenance.',
    inputSchema: objectSchema({ slug: { type: 'string', minLength: 1 } }, ['slug']),
  },
  {
    name: 'wiki_links',
    description: 'Get outgoing wiki links and backlinks for one page.',
    inputSchema: objectSchema({ slug: { type: 'string', minLength: 1 } }, ['slug']),
  },
  {
    name: 'wiki_ingest',
    description: 'Ingest a supported file or directory already under raw/. Writes generated artifacts only under wiki/.',
    inputSchema: objectSchema({ path: { type: 'string', minLength: 1 }, force: { type: 'boolean' } }, ['path']),
  },
] }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = request.params.arguments || {};
    let result;
    switch (request.params.name) {
      case 'wiki_list':
        result = listWikiPages(args);
        break;
      case 'wiki_search':
        result = searchWiki(requireString(args.query, 'query'), args);
        break;
      case 'wiki_read':
        result = readWikiPage(requireString(args.slug, 'slug'));
        break;
      case 'wiki_links':
        result = getWikiLinks(requireString(args.slug, 'slug'));
        break;
      case 'wiki_ingest': {
        const sourcePath = resolveRawPath(requireString(args.path, 'path'));
        result = await ingestPath(sourcePath, { force: args.force === true, logger: console });
        break;
      }
      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
    return textResult(result);
  } catch (error) {
    return { ...textResult({ error: error.message }), isError: true };
  }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: 'wiki://page/index.md', name: 'Wiki index', mimeType: 'text/markdown' },
    { uri: 'wiki://page/timeline.md', name: 'Wiki timeline', mimeType: 'text/markdown' },
  ],
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [{
    uriTemplate: 'wiki://page/{slug}',
    name: 'Knowledge Forge wiki page',
    description: 'A generated markdown page addressed by its wiki-relative slug.',
    mimeType: 'text/markdown',
  }],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = new URL(request.params.uri);
  if (uri.protocol !== 'wiki:' || uri.hostname !== 'page') throw new Error('Unsupported resource URI.');
  const page = readWikiPage(decodeURIComponent(uri.pathname.replace(/^\//, '')));
  return { contents: [{ uri: request.params.uri, mimeType: 'text/markdown', text: page.markdown }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);

function objectSchema(properties, required = []) {
  return { type: 'object', additionalProperties: false, properties, required };
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function resolveRawPath(input) {
  const relative = input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^raw\//, '');
  const resolved = path.resolve(RAW_DIR, relative);
  if (resolved !== RAW_DIR && !resolved.startsWith(`${RAW_DIR}${path.sep}`)) throw new Error('Source path must stay inside raw/.');
  if (!fs.existsSync(resolved)) throw new Error(`Source path does not exist under raw/: ${input}`);
  const realRaw = fs.realpathSync(RAW_DIR);
  const realSource = fs.realpathSync(resolved);
  if (realSource !== realRaw && !realSource.startsWith(`${realRaw}${path.sep}`)) throw new Error('Source symlink escapes raw/.');
  return realSource;
}
