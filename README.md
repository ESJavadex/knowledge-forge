<p align="center">
  <img src="https://img.shields.io/badge/status-functional-brightgreen" alt="Status" />
  <img src="https://img.shields.io/badge/inspired_by-Karpathy%27s_LLM_Wiki-blue" alt="Inspired by" />
  <img src="https://img.shields.io/badge/node.js-ESM-green" alt="Node.js ESM" />
  <img src="https://img.shields.io/badge/license-MIT-orange" alt="License" />
</p>

<h1 align="center">📚 Knowledge Forge</h1>

<p align="center">
  <strong>A persistent, compounding knowledge base maintained by LLMs.</strong><br/>
  Drop sources in. Watch a wiki build itself.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> · <a href="#how-it-works">How It Works</a> · <a href="#commands">Commands</a> · <a href="#architecture">Architecture</a> · <a href="#roadmap">Roadmap</a>
</p>

<p align="center">
  <img src="docs/home.png" alt="Knowledge Forge Web UI - Home" width="700" /><br/>
  <em>Dark-themed web UI with sidebar, type filters, search, and wiki link navigation</em>
</p>

<p align="center">
  <img src="docs/source-page.png" alt="Source page with wiki links" width="700" /><br/>
  <em>Source pages auto-extract concepts and entities with clickable wiki links</em>
</p>

<p align="center">
  <img src="docs/concept-page.png" alt="Concept page" width="700" /><br/>
  <em>Concept pages accumulate cross-references from multiple sources</em>
</p>

---

> **Inspired by [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).**
>
> *"Instead of just retrieving from raw documents at query time, the LLM incrementally builds and maintains a persistent wiki — a structured, interlinked collection of markdown files that sits between you and the raw sources."*
> — Andrej Karpathy

## What It Does

Knowledge Forge takes raw documents and turns them into a living, interconnected wiki. Not a one-shot RAG pipeline — a **compounding knowledge base** that gets richer with every source you feed it.

- 📥 **Ingest** markdown/text/PDF/DOCX sources → semantically extracts grounded summaries, categories, key points, conclusions, recommendations, quotes, concepts, entities, questions, and dates
- 🧾 **OCRs** scanned PDFs when `pdftotext` finds no embedded text
- ♻️ **Skips duplicates** with a SHA-256 ingestion manifest
- 🔗 **Links** related pages together with wiki-style `[[links]]`
- 🗓️ **Builds** a source-linked timeline from relevant dates
- 📋 **Indexes** everything into a navigable catalog
- 🔍 **Lints** the wiki: finds orphans, dangling links, missing metadata
- 🌐 **Serves** a dark-themed web UI to browse and explore
- 💬 **Queries** the compiled wiki in natural language with mandatory wiki + raw-source citations
- 🔌 **Exposes MCP** so coding agents can list, search, read, navigate, and ingest the wiki
- 📝 **Logs** every operation chronologically

## Current Status

**This repo is intentionally positioned as a functional concept implementation.**

That means it already proves the end-to-end pattern:
- raw sources → wiki pages
- cross-linking between pages
- persistent markdown artifact
- index + log
- browseable UI
- health checks / linting

But it does **not** yet implement the full autonomous LLM maintainer vision described by Karpathy.

### What is already real

- A working ingestion pipeline
- Persistent wiki generation on disk
- Concept and entity page creation
- Incremental wiki updates from new sources
- A usable local web UI
- A concrete repo anyone can clone, run, and extend

### What is still missing

- **Contradiction handling**
  - The current version does not yet detect or annotate conflicts between sources
- **Human-in-the-loop workflows**
  - No review queue, approval flow, or source triage loop yet
- **Richer search / retrieval**
  - No BM25/vector search yet, only file-based navigation and simple UI filtering
- **Autonomous maintenance loop**
  - No background agent that continuously ingests, revises, and improves the wiki over time

So the right framing is:

> **Knowledge Forge is a functional prototype of the LLM Wiki pattern, with the core architecture working today and the full LLM-native maintainer loop left as the next step.**

## Why Not Just RAG?

| | RAG | Knowledge Forge |
|---|---|---|
| Knowledge | Re-derived every query | Compiled once, kept current |
| Cross-references | Missing | Built-in `[[wiki links]]` |
| Contradictions | Undetected | Not implemented yet |
| Accumulation | None — each query is independent | Compounds with every source |
| Maintenance cost | Low (but shallow) | Near zero (LLM does the bookkeeping) |

## Quick Start

```bash
git clone https://github.com/ESJavadex/knowledge-forge.git
cd knowledge-forge
npm install
npm run demo        # bootstrap + 3 sample sources
npm start           # launch web UI at http://localhost:3000
```

Open `http://localhost:3000` and browse the wiki. The sidebar lets you filter by type, search pages, and navigate through wiki links.

## Commands

```bash
node src/cli.js init              # Create folder structure + special files
node src/cli.js demo              # Create 3 sample sources and ingest them
node src/cli.js ingest <path>     # Ingest one file or every supported file in a directory
node src/cli.js ingest --all      # Ingest raw/ recursively; unchanged hashes are skipped
node src/cli.js ingest <path> --force # Reprocess even when the source hash is unchanged
node src/cli.js ingest <path> --provider openclaw --model zai/glm-5.3-flash --require-llm
                                  # Use the exact Z.AI model configured in OpenClaw; fail closed
node src/cli.js query "<question>" # Answer from wiki knowledge and save the cited analysis
node src/cli.js lint              # Health-check: orphans, dangling links, metadata
node src/cli.js serve             # Start the web UI (port 3000)
```

Or via npm scripts:

```bash
npm run init
npm run demo
npm run ingest
npm run lint
npm run mcp
npm start
```

### Model-provider configuration

Semantic extraction supports two adapters:

- `--provider openclaw` uses OpenClaw's stored provider authentication through a lean, isolated `infer model run` call. It sends no agent history, tools, memory, or workspace context. The recommended podcast pipeline uses `zai/glm-5.3-flash` through this adapter.
- `--provider openrouter` uses the existing OpenRouter adapter and remains the default for backwards compatibility.

Rich ingestion extracts a grounded summary, categories, key points, concepts, entities, conclusions, source-attributed recommendations, notable verbatim quotes, open questions, and relevant dates. Use `--require-llm` for production jobs where a heuristic fallback would be unacceptable.

For OpenClaw, authenticate and allow the selected model in OpenClaw itself; no provider credential is copied into this repository. For OpenRouter, provide `OPENROUTER_API_KEY` through your environment or secret manager. `OPENROUTER_MODEL` (or `LLM_MODEL`) optionally selects its model.

Without `OPENROUTER_API_KEY`, ingestion automatically uses the original frequency/bigram heuristic, so `init`, `demo`, `ingest`, `lint`, `mcp`, and `serve` keep working offline. Query mode reports that OpenRouter configuration is required.

When OpenRouter is enabled, source excerpts are sent to the selected model provider. Check that provider's privacy terms before ingesting sensitive personal documents.

PDF ingestion uses `pdftotext` (Poppler); if the PDF has no embedded text it falls back to `pdftoppm` + Tesseract OCR. DOCX uses `unzip` to read `word/document.xml`. None of these paths modifies the file in `raw/`.

On Debian/Ubuntu, the optional OCR runtime can be installed with:

```bash
sudo apt install poppler-utils unzip tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng
```

OCR settings:

- `OCR_ENABLED=false` disables OCR fallback.
- `OCR_LANGUAGES` defaults to `spa+eng`.
- `OCR_DPI` defaults to `200`.

## How It Works

### 1. Ingest

Drop a `.md`, `.txt`, `.pdf`, or `.docx` file into `raw/` and run `ingest`. The engine:

1. Hashes the immutable source and skips it when the same content was already ingested
2. Reads embedded text or performs OCR, preserving page/section/paragraph locators
3. Splits long documents on paragraph boundaries and extracts every part—no middle truncation
4. Extracts grounded summaries, categories, key points, conclusions, source-attributed recommendations, exact quotes, open questions, concepts, entities, and dates with the configured model
5. Creates/updates source, concept, and entity pages without changing `[[wiki links]]`
6. Stores generated citation evidence under `wiki/.evidence/`
7. Refreshes `wiki/timeline.md`, the index, manifest, and append-only log

A single source can touch 20+ wiki pages.

If OpenRouter is not configured or returns malformed structured output, ingestion falls back defensively to the original heuristic extractor.

### 2. Query

Use `node src/cli.js query "..."` or the query field in the web UI. The answer is organized into useful sections such as conclusions, actions, cross-source consensus, disagreements, and caveats. A single source may support several independently cited items; answers are not limited to one conclusion per Markdown file. The model may emit only atomic claims backed by an exact wiki page, raw source, locator, and verbatim evidence quote; unsupported claims and quantities absent from the quote are discarded. Every result is saved under `wiki/analyses/`, linked to its supporting pages, indexed, and logged.

### Hybrid search

Knowledge Forge can use a local [QMD](https://github.com/tobi/qmd) sidecar to combine BM25/full-text and semantic vector retrieval. Both the web query flow and MCP use the same adapter. Only `wiki/sources/**/*.md` should be indexed; navigation pages and generated analyses must stay out of the search corpus.

```bash
npm install --global @tobilu/qmd
export XDG_CONFIG_HOME="$HOME/.config/knowledge-forge-qmd"
export XDG_CACHE_HOME="$HOME/.cache/knowledge-forge-qmd"
qmd collection add "$PWD/wiki" --name forge --mask 'sources/**/*.md'
qmd update
qmd embed -c forge
qmd mcp --http --host 127.0.0.1 --port 8181
```

The endpoint is local-only and unauthenticated, so it must not be exposed directly to the network. Knowledge Forge connects to `http://127.0.0.1:8181` by default. Override it with `KNOWLEDGE_FORGE_QMD_URL`, or set that variable to `off` to force deterministic lexical fallback. `KNOWLEDGE_FORGE_QMD_REQUIRED=true` makes queries fail instead of falling back when the sidecar is unavailable.

### 3. MCP for coding agents

Run the local stdio server with `npm run mcp`. Configure your coding agent with:

```json
{
  "mcpServers": {
    "knowledge-forge": {
      "command": "node",
      "args": ["/absolute/path/to/knowledge-forge/src/mcp-server.js"]
    }
  }
}
```

The server exposes eight focused tools:

- `wiki_list` — catalog pages by type.
- `wiki_search` — deterministic text search.
- `wiki_context` — compact, ranked context bundle with raw provenance for agent prompts.
- `wiki_facets` — counts by type, category, podcast, and extraction model.
- `wiki_status` — ingestion/model/schema status.
- `wiki_read` — markdown, frontmatter, links, and raw provenance.
- `wiki_links` — outgoing links and backlinks.
- `wiki_ingest` — optional write tool for files/directories already under `raw/`, using grounded `zai/glm-5.3-flash` extraction. It is hidden and rejected by default; enable it only for a trusted client with `KNOWLEDGE_FORGE_MCP_ALLOW_INGEST=true`.

It also exposes `wiki://page/{slug}`, `wiki://catalog`, and `wiki://status` resources plus a `grounded_wiki_research` prompt. Direct arbitrary reads or writes to `raw/` are intentionally not exposed.

Register the read-only server with common local clients:

```bash
openclaw mcp add knowledge-forge --command /usr/bin/node \
  --arg /absolute/path/to/knowledge-forge/src/mcp-server.js \
  --include wiki_list,wiki_search,wiki_context,wiki_facets,wiki_status,wiki_read,wiki_links \
  --parallel --approval auto

codex mcp add knowledge-forge -- \
  /usr/bin/node /absolute/path/to/knowledge-forge/src/mcp-server.js

claude mcp add --scope user knowledge-forge -- \
  /usr/bin/node /absolute/path/to/knowledge-forge/src/mcp-server.js
```

The MCP defaults to read-only even when a client has no tool-filter support. Set `KNOWLEDGE_FORGE_MCP_ALLOW_INGEST=true` only for a trusted ingestion client.

### 4. Lint

Run a health check to find:
- 👻 **Orphan pages** — no other page links to them
- 🔗 **Dangling links** — `[[links]]` to pages that don't exist yet
- 📋 **Missing frontmatter** — pages without YAML metadata

## Architecture

```
knowledge-forge/
├── raw/                    # 📥 Immutable source documents (never modified)
│   └── *.md
├── wiki/                   # 📚 LLM-generated knowledge base
│   ├── sources/            # Summary pages for each ingested source
│   ├── concepts/           # Recurring themes and topics
│   ├── entities/           # Named things, tools, products
│   ├── analyses/           # Synthesized answers (user queries filed back)
│   ├── .evidence/          # Generated exact excerpts + page/section locators
│   ├── .ingest-manifest.json # SHA-256 deduplication and extraction metadata
│   ├── timeline.md         # Generated dated-event view
│   ├── index.md            # Catalog of all pages
│   └── log.md              # Append-only chronological record
├── schema/
│   └── AGENTS.md           # Rules for the wiki maintainer agent
├── src/
│   ├── cli.js              # CLI entry point
│   ├── ingest.js           # Source ingestion + extraction engine
│   ├── extraction.js       # Semantic extraction use case + heuristic fallback
│   ├── query.js            # Grounded query use case + citation validation
│   ├── mcp-server.js       # Local stdio MCP adapter
│   ├── wiki-reader.js      # Deterministic wiki navigation use cases
│   ├── ingest-state.js     # Manifest, evidence, and timeline persistence
│   ├── adapters/           # OpenRouter and source-reading adapters
│   ├── lint.js             # Wiki health checker
│   ├── server.js           # Express web UI + API
│   └── utils.js            # Shared utilities
├── public/
│   └── index.html          # Single-page web UI
└── package.json
```

### Three Layers

1. **Raw sources** — Your curated documents. Immutable. The LLM reads from them but never writes to them.
2. **The wiki** — Structured markdown pages maintained entirely by the LLM. Source summaries, concept pages, entity pages, cross-references.
3. **The schema** — Configuration (`AGENTS.md`) that tells the LLM how to structure, maintain, and evolve the wiki.

### Wiki Link Format

Pages reference each other with Obsidian-style `[[Page Name]]` links. The web UI resolves these into clickable navigation. Dangling links (to pages that don't exist yet) are marked with ❓.

## Web UI

The built-in UI features:

- 🌙 Dark theme
- 📂 Sidebar with type filters (Sources, Concepts, Entities, Analyses)
- 🔍 Full-text search across all pages
- 📊 Stats bar showing page counts by type
- 🔗 SPA navigation through wiki links
- 📱 Responsive layout

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Server**: Express.js
- **Markdown**: `marked` (rendering) + `gray-matter` (frontmatter parsing)
- **UI**: Vanilla HTML/CSS/JS — zero build step
- **VCS**: Git (your wiki is a git repo with full history)

## Demo Sources Included

| Source | Concepts | Entities |
|---|---|---|
| Transformer Architecture | 10 | 10 |
| Retrieval-Augmented Generation | 10 | 10 |
| Knowledge Graphs in AI | 10 | 10 |

Run `npm run demo` to generate all of them.

## Roadmap

- [x] **LLM-powered extraction** — Structured semantic extraction through OpenRouter with offline heuristic fallback
- [ ] **Full-text search API** — Integrate `qmd` or similar for proper search as the wiki grows
- [x] **Query mode** — Ask natural language questions and get grounded answers with wiki + raw citations
- [x] **File-and-save** — File query answers back into the wiki as linked analysis pages
- [x] **Batch + deduplication** — Recursive ingestion with SHA-256 skip logic
- [x] **OCR fallback** — Scanned PDF extraction with page provenance
- [x] **Precise citations** — Wiki + raw + locator + verbatim quote validation
- [x] **Timeline** — Persist extracted dates in an automatically linked page
- [x] **Long-document chunking** — Process all sections without middle truncation
- [x] **MCP server** — Let coding agents browse and ingest the wiki over stdio
- [ ] **Obsidian compatibility** — Open the wiki folder directly in Obsidian for graph view
- [ ] **Marp export** — Generate slide decks from wiki content
- [ ] **Dataview queries** — YAML frontmatter + Dataview plugin integration
- [ ] **Contradiction detection** — Flag when new sources contradict existing wiki claims
- [ ] **Web clipper helper** — Easy ingestion from browser extensions
- [ ] **Continuous maintainer mode** — Background agent loop for ingest, refinement, and linting
- [ ] **Review workflows** — Human approval mode for team/internal knowledge bases

## Author

<p align="center">
  <strong>Javier Santos</strong><br/>
  <a href="https://javadex.es">javadex.es</a> · <a href="https://github.com/ESJavadex">GitHub</a>
</p>

<p align="center">
  <em>Head of AI · Electronic Engineer · Building the future, one repo at a time.</em>
</p>

---

## License

MIT — use it, fork it, build on top of it.

---

<p align="center">
  Built with ☕ by <a href="https://javadex.es">Javier Santos</a> · Inspired by <a href="https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f">Andrej Karpathy</a>
</p>
