# Retrieval-Augmented Generation (RAG)

RAG is a technique that enhances LLM responses by grounding them in external knowledge. Instead of relying solely on parametric memory, the model retrieves relevant documents from a knowledge base and includes them in its context.

## How RAG Works

1. **Indexing**: Documents are chunked and embedded into a vector database.
2. **Retrieval**: At query time, the user question is embedded and used to find the most relevant chunks via similarity search.
3. **Generation**: Retrieved chunks are injected into the LLM prompt, which generates an answer grounded in the retrieved context.

## Limitations

- **No accumulation**: Each query is independent. The system does not learn or build structure across queries.
- **Context window limits**: Only a fixed number of chunks fit in the prompt.
- **Chunking quality**: Poor chunking can split important information across boundaries.
- **Staleness**: The knowledge base does not evolve with new information unless manually updated.

## Relationship to LLM Wiki

The LLM Wiki pattern addresses RAG limitations by maintaining a persistent, structured knowledge base that compounds over time. Instead of re-deriving knowledge from raw chunks on every query, the wiki is pre-compiled and continuously updated.
