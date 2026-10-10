---
type: source
title: "Karpathy Llm Wiki Concept"
source_file: "karpathy-llm-wiki-concept.md"
ingested: "2026-10-10T10:00:00.000Z"
concept_count: 1
entity_count: 2
categories: ["Knowledge Management"]
extraction_mode: "manual"
model: null
---

# Karpathy Llm Wiki Concept

> Source: `karpathy-llm-wiki-concept.md`

## Summary

Andrej Karpathy's original idea: instead of retrieving from raw documents at query time, an LLM incrementally builds and maintains a persistent, interlinked wiki of markdown files. Each new source is read once and integrated into existing pages, so knowledge compounds over time.

## Categories

- [[Knowledge Management]]

## Key Points

- The wiki is a persistent, compounding artifact: cross-references already exist and contradictions are flagged.
- Three layers: immutable raw sources, LLM-generated wiki pages, and a schema that tells the LLM how to maintain the wiki.
- Three operations: ingest (read, summarize, update cross-references), query (answer with citations) and lint (find contradictions, orphans, stale claims and missing pages).
- Two special files: `index.md` (catalog) and `log.md` (append-only record of operations).

## Conclusions

- Knowledge is compiled once at ingest time rather than re-derived on every question.

## Recommendations From the Source

- Keep raw sources immutable and let the LLM own the wiki layer.

## Notable Quotes

- "The wiki is a persistent, compounding artifact." — Core idea

## Open Questions and Uncertainty

- The source does not say how contradictions between sources should be resolved, only that they are flagged.

## Key Concepts

- [[Wiki Links]] (1 mentions)

## Key Entities

- [[Andrej Karpathy]] (2 mentions)
- [[Llm Wiki]] (2 mentions)

---
> Raw source: `raw/karpathy-llm-wiki-concept.md`
