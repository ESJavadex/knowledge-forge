const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'as', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
  'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very', 'just',
  'about', 'above', 'after', 'again', 'all', 'also', 'am', 'any', 'because',
  'before', 'between', 'both', 'each', 'few', 'further', 'get', 'got', 'he',
  'her', 'here', 'him', 'his', 'how', 'i', 'into', 'its', 'let', 'like',
  'make', 'me', 'more', 'most', 'much', 'must', 'my', 'new', 'now', 'old',
  'only', 'other', 'our', 'out', 'own', 'per', 'put', 'same', 'she', 'some',
  'still', 'such', 'take', 'their', 'them', 'there', 'these', 'they', 'those',
  'through', 'time', 'under', 'up', 'us', 'use', 'used', 'using', 'via',
  'want', 'we', 'well', 'what', 'when', 'where', 'which', 'while', 'who',
  'why', 'you', 'your', 'one', 'two', 'way', 'many', 'even', 'back',
  'over', 'work', 'first', 'down', 'since', 'off', 'come', 'around',
  'long', 'every', 'year', 'good', 'give', 'day', 'look',
]);

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'concepts', 'entities', 'relevant_dates'],
  properties: {
    summary: { type: 'string' },
    concepts: { type: 'array', items: { type: 'string' }, maxItems: 15 },
    entities: { type: 'array', items: { type: 'string' }, maxItems: 15 },
    relevant_dates: {
      type: 'array',
      maxItems: 15,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'description'],
        properties: {
          date: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  },
};

export function heuristicExtract(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  const frequency = {};

  for (const word of words) {
    if (word.length >= 3 && !STOP_WORDS.has(word)) frequency[word] = (frequency[word] || 0) + 1;
  }

  for (let index = 0; index < words.length - 1; index += 1) {
    const first = words[index];
    const second = words[index + 1];
    if (!STOP_WORDS.has(first) && !STOP_WORDS.has(second) && first.length >= 3 && second.length >= 3) {
      const bigram = `${first} ${second}`;
      frequency[bigram] = (frequency[bigram] || 0) + 2;
    }
  }

  const entityIndicators = ['http', 'api', 'llm', 'rag', 'wiki', 'mcp', 'ai', 'gpt', 'claude', 'gemini', 'obsidian'];
  const candidates = Object.entries(frequency)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 30)
    .map(([name, count]) => ({ name, count }));
  const paragraphs = text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim().length > 20);

  return {
    summary: paragraphs[0]?.replace(/^#+\s/gm, '').slice(0, 500) || 'No summary available.',
    concepts: candidates.filter(({ name }) => !name.includes(' ') && !entityIndicators.some((term) => name.includes(term))),
    entities: candidates.filter(({ name }) => name.includes(' ') || entityIndicators.some((term) => name.includes(term))),
    relevantDates: [],
    mode: 'heuristic',
  };
}

export async function extractSemantics({ text, fileName, generator, logger = console }) {
  if (!generator?.available) return heuristicExtract(text);

  const maxChars = positiveInteger(process.env.LLM_CHUNK_CHARS, 60_000);
  const chunks = splitTextIntoChunks(text, maxChars);
  const extractions = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    try {
      const raw = await generator.generateJson({
        schemaName: 'knowledge_extraction',
        schema: EXTRACTION_SCHEMA,
        system: [
          'You extract grounded knowledge from personal documents for a private wiki.',
          'Return only facts explicitly present in the source. Never infer diagnoses, treatments, dates, identities, or missing details.',
          'Write the summary in the source language. Include important relationships between treatments/events and their dates in the summary.',
          'Normalize complete relevant dates as YYYY-MM-DD when the source makes the date unambiguous; preserve partial or uncertain dates explicitly.',
          'Concepts are recurring topics. Entities are named people, organizations, medications, products, places, tests, or conditions.',
          'Keep names faithful to the source and make each item concise and unique.',
        ].join(' '),
        prompt: `Source file: ${fileName}\nPart ${index + 1} of ${chunks.length}\n\n<source>\n${chunk}\n</source>`,
      });
      extractions.push(normalizeExtraction(raw, chunk));
    } catch (error) {
      logger.warn(`  ⚠️  Semantic extraction failed for part ${index + 1}/${chunks.length} (${error.message}); using heuristic fallback for that part.`);
      extractions.push(heuristicExtract(chunk));
    }
  }

  return mergeExtractions(extractions, text);
}

export function splitTextIntoChunks(text, maxChars = 60_000) {
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      for (let offset = 0; offset < paragraph.length; offset += maxChars) {
        chunks.push(paragraph.slice(offset, offset + maxChars));
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars) pushCurrent();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  pushCurrent();
  return chunks;
}

function mergeExtractions(extractions, sourceText) {
  const summaries = [...new Set(extractions.map((item) => item.summary).filter(Boolean))];
  const concepts = mergeNames(extractions.flatMap((item) => item.concepts), sourceText);
  const entities = mergeNames(extractions.flatMap((item) => item.entities), sourceText);
  const dates = new Map();
  for (const item of extractions.flatMap((extraction) => extraction.relevantDates)) {
    const key = `${item.date.toLocaleLowerCase()}\u0000${item.description.toLocaleLowerCase()}`;
    if (!dates.has(key)) dates.set(key, item);
  }
  const modes = new Set(extractions.map((item) => item.mode));
  return {
    summary: summaries.join(' ').slice(0, 2_000) || 'No summary available.',
    concepts,
    entities,
    relevantDates: [...dates.values()].slice(0, 30),
    mode: modes.size === 1 ? [...modes][0] : 'hybrid',
  };
}

function mergeNames(items, sourceText) {
  const names = new Map();
  for (const item of items) {
    const key = item.name.toLocaleLowerCase();
    if (!names.has(key)) names.set(key, item.name);
  }
  return [...names.values()].slice(0, 15).map((name) => ({
    name,
    count: countOccurrences(sourceText, name) || 1,
  }));
}

function normalizeExtraction(value, sourceText) {
  if (!value || typeof value !== 'object') throw new Error('Extraction payload is not an object.');
  const summary = cleanString(value.summary, 2_000);
  if (!summary) throw new Error('Extraction payload has no summary.');

  return {
    summary,
    concepts: normalizeNames(value.concepts, sourceText),
    entities: normalizeNames(value.entities, sourceText),
    relevantDates: normalizeDates(value.relevant_dates ?? value.relevantDates),
    mode: 'llm',
  };
}

function normalizeNames(items, sourceText) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const name = cleanString(typeof item === 'string' ? item : item?.name ?? item?.word, 100);
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    normalized.push({ name, count: countOccurrences(sourceText, name) || 1 });
    if (normalized.length === 15) break;
  }
  return normalized;
}

function normalizeDates(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 15).map((item) => ({
    date: cleanString(item?.date ?? item, 80),
    description: cleanString(item?.description, 300),
  })).filter((item) => item.date);
}

function countOccurrences(text, phrase) {
  const haystack = text.toLocaleLowerCase();
  const needle = phrase.toLocaleLowerCase();
  let count = 0;
  let cursor = 0;
  while (needle && (cursor = haystack.indexOf(needle, cursor)) !== -1) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

function cleanString(value, maxLength) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
