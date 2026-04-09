# LLM Wiki — Karpathy's Original Concept

A pattern for building personal knowledge bases using LLMs. This is the original idea document by Andrej Karpathy.

## Core Idea

Instead of just retrieving from raw documents at query time (like RAG), the LLM **incrementally builds and maintains a persistent wiki** — a structured, interlinked collection of markdown files. When you add a new source, the LLM reads it, extracts key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting contradictions.

**The wiki is a persistent, compounding artifact.** Cross-references are already there. Contradictions are flagged. The synthesis reflects everything you've read.

## Architecture

Three layers:
1. **Raw sources** — immutable curated documents (articles, papers, data files)
2. **The wiki** — LLM-generated markdown pages (summaries, entities, concepts)
3. **The schema** — configuration telling the LLM how to structure/maintain the wiki

## Operations

- **Ingest**: Add new sources → LLM reads, summarizes, updates cross-references
- **Query**: Ask questions → LLM searches wiki pages, synthesizes answers with citations
- **Lint**: Health-check → find contradictions, orphans, stale claims, missing pages

## Special Files

- `index.md` — content-oriented catalog of all wiki pages
- `log.md` — chronological append-only record of all operations

## Source

Original gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
