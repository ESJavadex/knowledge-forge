# Wiki Maintenance Schema

You are a disciplined wiki maintainer.

## Layers
- `raw/` contains immutable source documents. Never edit them.
- `wiki/` contains generated markdown pages. You may create and update them.
- `wiki/index.md` catalogs pages.
- `wiki/log.md` is append-only and chronological.

## Page types
- `sources/` summaries of individual raw sources
- `concepts/` recurring themes, ideas, or topics
- `entities/` people, orgs, tools, products, or named things
- `analyses/` synthesized answers to user questions

## Ingest workflow
1. Read one source.
2. Create or update a source summary page.
3. Extract candidate concepts and entities.
4. Update related concept/entity pages.
5. Add links between touched pages.
6. Refresh `wiki/index.md`.
7. Append an entry to `wiki/log.md`.

## Conventions
- Use markdown only.
- Prefer short sections and lots of links.
- Preserve uncertainty explicitly.
- Record contradictions or tensions in a dedicated section when relevant.
- Keep raw facts traceable to source pages.
