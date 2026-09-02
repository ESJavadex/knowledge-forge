#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RAW_DIR } from './utils.js';
import { ingestPath } from './ingest.js';
import { createOpenClawGenerator } from './adapters/openclaw.js';
import { getWikiContextHybrid, getWikiFacets, getWikiLinks, getWikiStatus, listWikiPages, readWikiPage, searchWikiHybrid } from './wiki-reader.js';

// stdout belongs exclusively to the MCP stdio transport.
console.log = (...args) => console.error(...args);

const server = new Server({ name: 'knowledge-forge', version: '0.3.0' }, {
  capabilities: { resources: {}, tools: {}, prompts: {} },
  instructions: 'Navigate the generated wiki with list/search/read/links. Ingest only files already placed under raw/. Never claim raw provenance that a page does not expose.',
});
const allowIngest = process.env.KNOWLEDGE_FORGE_MCP_ALLOW_INGEST === 'true';

const readTools = [
  {
    name: 'wiki_list',
    description: 'List generated wiki pages, optionally filtered by page type.',
    inputSchema: objectSchema(filterProperties({ limit: { type: 'integer', minimum: 1, maximum: 200 } })),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'wiki_search',
    description: 'Search source pages with hybrid lexical + semantic retrieval when the local index is available, with deterministic lexical fallback.',
    inputSchema: objectSchema(filterProperties({ query: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }), ['query']),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'wiki_context',
    description: 'Return a compact, provenance-bearing context bundle for a question. Prefer this before reading many full pages.',
    inputSchema: objectSchema(filterProperties({ query: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 20 }, max_chars: { type: 'integer', minimum: 1000, maximum: 80000 } }), ['query']),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'wiki_facets',
    description: 'List counts by page type, category, podcast, and extraction model for discovery and filtering.',
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'wiki_status',
    description: 'Report generated-page and source-ingestion status, schema versions, modes, and models.',
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'wiki_read',
    description: 'Read one wiki page as markdown with frontmatter, outgoing links, and raw-source provenance.',
    inputSchema: objectSchema({ slug: { type: 'string', minLength: 1 } }, ['slug']),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'wiki_links',
    description: 'Get outgoing wiki links and backlinks for one page.',
    inputSchema: objectSchema({ slug: { type: 'string', minLength: 1 } }, ['slug']),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];
const ingestTool = {
    name: 'wiki_ingest',
    description: 'Ingest a supported file or directory already under raw/ with grounded LLM extraction. Writes generated artifacts only under wiki/.',
    inputSchema: objectSchema({ path: { type: 'string', minLength: 1 }, force: { type: 'boolean' } }, ['path']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  };

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allowIngest ? [...readTools, ingestTool] : readTools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = request.params.arguments || {};
    let result;
    switch (request.params.name) {
      case 'wiki_list':
        result = listWikiPages(args);
        break;
      case 'wiki_search':
        result = await searchWikiHybrid(requireString(args.query, 'query'), args);
        break;
      case 'wiki_context':
        result = await getWikiContextHybrid(requireString(args.query, 'query'), { ...args, maxChars: args.max_chars });
        break;
      case 'wiki_facets':
        result = getWikiFacets();
        break;
      case 'wiki_status':
        result = getWikiStatus();
        break;
      case 'wiki_read':
        result = readWikiPage(requireString(args.slug, 'slug'));
        break;
      case 'wiki_links':
        result = getWikiLinks(requireString(args.slug, 'slug'));
        break;
      case 'wiki_ingest': {
        if (!allowIngest) throw new Error('wiki_ingest is disabled. Set KNOWLEDGE_FORGE_MCP_ALLOW_INGEST=true for an explicitly trusted client.');
        const sourcePath = resolveRawPath(requireString(args.path, 'path'));
        result = await ingestPath(sourcePath, {
          force: args.force === true,
          requireSemantic: true,
          generator: createOpenClawGenerator({ model: process.env.KNOWLEDGE_FORGE_MCP_MODEL || 'zai/glm-5.3-flash' }),
          logger: console,
        });
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
    { uri: 'wiki://catalog', name: 'Wiki catalog', mimeType: 'application/json' },
    { uri: 'wiki://status', name: 'Wiki ingestion status', mimeType: 'application/json' },
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
  if (uri.protocol === 'wiki:' && uri.hostname === 'catalog') {
    return { contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(listWikiPages({ limit: 200 }), null, 2) }] };
  }
  if (uri.protocol === 'wiki:' && uri.hostname === 'status') {
    return { contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(getWikiStatus(), null, 2) }] };
  }
  if (uri.protocol !== 'wiki:' || uri.hostname !== 'page') throw new Error('Unsupported resource URI.');
  const page = readWikiPage(decodeURIComponent(uri.pathname.replace(/^\//, '')));
  return { contents: [{ uri: request.params.uri, mimeType: 'text/markdown', text: page.markdown }] };
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{
  name: 'grounded_wiki_research',
  description: 'Research a question using only Knowledge Forge and preserve raw-source provenance.',
  arguments: [{ name: 'question', description: 'Question to investigate', required: true }],
}] }));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== 'grounded_wiki_research') throw new Error(`Unknown prompt: ${request.params.name}`);
  const question = requireString(request.params.arguments?.question, 'question');
  return {
    description: 'Grounded research workflow for Knowledge Forge',
    messages: [{ role: 'user', content: { type: 'text', text: [
      `Research this question using Knowledge Forge: ${question}`,
      'Start with wiki_context, then use wiki_read/wiki_links only where needed.',
      'Use only claims supported by returned wiki pages and their raw-source provenance.',
      'Separate consensus, disagreements, uncertainty, and source-attributed recommendations.',
      'Cite the wiki page slug and raw source for every substantive claim.',
    ].join('\n') } }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);

function objectSchema(properties, required = []) {
  return { type: 'object', additionalProperties: false, properties, required };
}

function filterProperties(extra = {}) {
  return {
    type: { type: 'string' },
    category: { type: 'string' },
    podcast: { type: 'string' },
    from: { type: 'string', description: 'Inclusive ISO date YYYY-MM-DD' },
    to: { type: 'string', description: 'Inclusive ISO date YYYY-MM-DD' },
    ...extra,
  };
}

function textResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(value && typeof value === 'object' ? { structuredContent: value } : {}),
  };
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
