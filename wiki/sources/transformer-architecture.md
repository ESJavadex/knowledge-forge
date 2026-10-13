---
type: source
title: "Transformer Architecture"
source_file: "transformer-architecture.md"
ingested: "2026-10-10T10:00:00.000Z"
concept_count: 1
entity_count: 1
categories: ["Machine Learning"]
extraction_mode: "manual"
model: null
---

# Transformer Architecture

> Source: `transformer-architecture.md`

## Summary

The Transformer, introduced in "Attention Is All You Need" (Vaswani et al., 2017), replaced recurrence with self-attention and became the foundation of modern large language models.

## Categories

- [[Machine Learning]]

## Key Points

- Core components: self-attention, multi-head attention, positional encoding, position-wise feed-forward networks and layer normalization.
- Tokens are processed in parallel, so positional information has to be injected with sinusoidal or learned embeddings.
- Three families: encoder-only (BERT, RoBERTa), decoder-only (GPT, LLaMA) and encoder-decoder (T5, BART).

## Conclusions

- The Transformer enabled the scaling laws behind the LLM revolution; GPT-4, Claude and Gemini all build on it.

## Recommendations From the Source

_None extracted._

## Notable Quotes

- "Allows each token to attend to all other tokens in the sequence" — Self-Attention

## Open Questions and Uncertainty

_None extracted._

## Key Concepts

- [[Attention Mechanism]] (4 mentions)

## Key Entities

- [[Attention Is All You Need]] (1 mentions)

---
> Raw source: `raw/transformer-architecture.md`
