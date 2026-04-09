# LLM Wiki

A functional local-first prototype of the "persistent wiki between you and your sources" concept from Karpathy's LLM Wiki note.

## What it does

- Stores immutable raw sources in `raw/`
- Builds and maintains a markdown wiki in `wiki/`
- Keeps an `index.md` catalog and append-only `log.md`
- Ingests new markdown/text sources into structured wiki pages
- Updates concept/entity pages incrementally based on source content
- Runs a simple lint pass for orphan pages and missing backlinks
- Serves the wiki in a small local web app

## Project structure

- `raw/` immutable source documents
- `wiki/` generated markdown knowledge base
- `schema/AGENTS.md` maintenance rules for the wiki agent
- `src/` ingestion, parsing, linting, and web server

## Quick start

```bash
npm install
npm run init
npm run demo
npm start
```

Then open: <http://localhost:3000>

## Commands

```bash
npm run init                # bootstrap folders and special files
npm run demo                # create sample sources and ingest them
npm run ingest -- raw/file.md
npm run lint
npm start
```

## Notes

This version is intentionally simple and hackable. It proves the workflow end to end:
raw sources -> structured wiki -> persistent updates -> queryable UI.
