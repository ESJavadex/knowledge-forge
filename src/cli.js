#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDir, writeText, RAW_DIR, WIKI_DIR, SOURCE_DIR, CONCEPT_DIR, ENTITY_DIR, ANALYSIS_DIR, listMarkdownFiles } from './utils.js';
import { ingestSource, updateIndex, appendLog } from './ingest.js';
import { lintWiki } from './lint.js';
import { startServer } from './server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0];

function init() {
  console.log('🏗️  Initializing LLM Wiki structure...\n');

  for (const dir of [RAW_DIR, WIKI_DIR, SOURCE_DIR, CONCEPT_DIR, ENTITY_DIR, ANALYSIS_DIR]) {
    ensureDir(dir);
    console.log(`  📁 ${dir.replace(process.cwd() + '/', '')}`);
  }

  // Create log.md
  const logPath = path.join(WIKI_DIR, 'log.md');
  if (!fs.existsSync(logPath)) {
    writeText(logPath, '# Wiki Log\n\n');
    console.log('  📄 wiki/log.md');
  }

  // Create initial index
  updateIndex();

  console.log('\n✅ Wiki structure ready.\n');
}

function demo() {
  console.log('🎯 Creating demo sources and ingesting...\n');

  // Sample source 1
  writeText(path.join(RAW_DIR, 'transformer-architecture.md'), `# The Transformer Architecture

The Transformer architecture, introduced in "Attention Is All You Need" (Vaswani et al., 2017), revolutionized natural language processing and became the foundation for modern large language models.

## Key Components

- **Self-Attention**: Allows each token to attend to all other tokens in the sequence, capturing long-range dependencies without recurrence.
- **Multi-Head Attention**: Runs multiple attention mechanisms in parallel, allowing the model to attend to different representation subspaces.
- **Positional Encoding**: Since Transformers process tokens in parallel (unlike RNNs), positional information must be injected via sinusoidal or learned embeddings.
- **Feed-Forward Networks**: Applied position-wise after attention, providing non-linear transformation capacity.
- **Layer Normalization**: Stabilizes training by normalizing activations within each layer.

## Variants

- **Encoder-only**: BERT, RoBERTa — strong for classification and understanding tasks.
- **Decoder-only**: GPT family, LLaMA — autoregressive generation models.
- **Encoder-Decoder**: T5, BART — sequence-to-sequence models.

## Impact

The Transformer enabled the scaling laws that drove the LLM revolution. Models like GPT-4, Claude, and Gemini all build on this architecture with improvements in training data, compute, and fine-tuning techniques.
`);

  // Sample source 2
  writeText(path.join(RAW_DIR, 'retrieval-augmented-generation.md'), `# Retrieval-Augmented Generation (RAG)

RAG is a technique that enhances LLM responses by grounding them in external knowledge. Instead of relying solely on parametric memory, the model retrieves relevant documents from a knowledge base and includes them in its context.

## How RAG Works

1. **Indexing**: Documents are chunked and embedded into a vector database.
2. **Retrieval**: At query time, the user's question is embedded and used to find the most relevant chunks via similarity search.
3. **Generation**: Retrieved chunks are injected into the LLM prompt, which generates an answer grounded in the retrieved context.

## Limitations

- **No accumulation**: Each query is independent. The system doesn't learn or build structure across queries.
- **Context window limits**: Only a fixed number of chunks fit in the prompt.
- **Chunking quality**: Poor chunking can split important information across boundaries.
- **Staleness**: The knowledge base doesn't evolve with new information unless manually updated.

## Relationship to LLM Wiki

The LLM Wiki pattern addresses RAG's limitations by maintaining a persistent, structured knowledge base that compounds over time. Instead of re-deriving knowledge from raw chunks on every query, the wiki is pre-compiled and continuously updated.
`);

  // Sample source 3
  writeText(path.join(RAW_DIR, 'knowledge-graphs-ai.md'), `# Knowledge Graphs in AI

Knowledge graphs represent information as entities connected by relationships, forming a graph structure. They have been used in AI since the early days of symbolic systems.

## Structure

- **Entities**: Nodes representing real-world objects (people, places, concepts).
- **Relations**: Typed edges connecting entities (e.g., "works_at", "located_in").
- **Properties**: Attributes attached to entities (e.g., name, date).

## Applications

- Google Knowledge Graph powers the information panels in search results.
- Wikidata provides a free, collaborative knowledge graph with millions of entities.
- Enterprise knowledge graphs organize internal company information.
- LLM-powered agents use knowledge graphs for structured reasoning.

## Connection to LLM Wiki

An LLM Wiki can be seen as a text-based knowledge graph. Wiki pages are entities, and [[wiki links]] between pages are relations. The LLM maintains the graph structure by creating, updating, and cross-referencing pages as new sources are ingested.

## Challenges

- Knowledge graph construction is labor-intensive without automation.
- Keeping graphs current requires continuous updates.
- Querying and reasoning over large graphs can be computationally expensive.
`);

  // Ingest all
  const sources = listMarkdownFiles(RAW_DIR);
  for (const src of sources) {
    console.log(`\n📥 Ingesting: ${path.basename(src)}`);
    ingestSource(src);
  }

  console.log('\n✅ Demo complete. Run `npm run lint` to check wiki health.\n');
}

// Route commands
switch (command) {
  case 'init':
    init();
    break;

  case 'demo':
    init();
    demo();
    break;

  case 'ingest': {
    init();
    const file = args[1];
    if (!file) {
      console.error('Usage: node src/cli.js ingest <file.md>');
      process.exit(1);
    }
    console.log(`\n📥 Ingesting: ${file}`);
    ingestSource(path.resolve(file));
    console.log();
    break;
  }

  case 'lint':
    lintWiki();
    break;

  case 'serve':
  case 'start':
    startServer();
    break;

  default:
    console.log(`
LLM Wiki — Persistent knowledge base maintained by LLMs

Usage:
  node src/cli.js init        Bootstrap wiki structure
  node src/cli.js demo        Create sample sources and ingest them
  node src/cli.js ingest FILE Ingest a markdown source file
  node src/cli.js lint        Health-check the wiki
  node src/cli.js serve       Start the web UI (localhost:3000)
`);
    break;
}
