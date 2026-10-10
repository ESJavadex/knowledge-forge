---
type: source
title: "Retrieval Augmented Generation"
source_file: "retrieval-augmented-generation.md"
ingested: "2026-10-10T10:00:00.000Z"
concept_count: 2
entity_count: 1
categories: ["Information Retrieval"]
extraction_mode: "manual"
model: null
---

# Retrieval Augmented Generation

> Source: `retrieval-augmented-generation.md`

## Summary

Retrieval-Augmented Generation (RAG) grounds LLM answers in external documents: documents are chunked and embedded, the most similar chunks are retrieved for each question, and they are injected into the prompt. Its main weakness is that nothing accumulates between queries.

## Categories

- [[Information Retrieval]]

## Key Points

- Three steps: indexing (chunk and embed documents into a vector database), retrieval (similarity search with the embedded question) and generation (answer from the retrieved chunks).
- Limitations: no accumulation across queries, a fixed [[Context Window]], [[Chunking]] quality, and a knowledge base that goes stale unless it is updated by hand.

## Conclusions

- The [[Llm Wiki]] pattern addresses these limitations by keeping a persistent, structured knowledge base that is pre-compiled and continuously updated.

## Recommendations From the Source

_None extracted._

## Notable Quotes

- "Each query is independent." — Limitations

## Open Questions and Uncertainty

- Poor chunking can split important information across boundaries.

## Key Concepts

- [[Chunking]] (1 mentions)
- [[Context Window]] (1 mentions)

## Key Entities

- [[Llm Wiki]] (1 mentions)

---
> Raw source: `raw/retrieval-augmented-generation.md`
