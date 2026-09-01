import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSemantics, splitTextIntoChunks } from '../src/extraction.js';

test('semantic extraction normalizes structured output and preserves relevant dates', async () => {
  const generator = {
    available: true,
    async generateJson() {
      return {
        summary: 'El 3 de marzo se recetó pomada para la fisura.',
        concepts: ['Fisura anal', 'Tratamiento'],
        entities: ['Pomada X', 'Pomada X'],
        relevant_dates: [{ date: '2026-03-03', description: 'Prescripción' }],
      };
    },
  };

  const result = await extractSemantics({
    text: 'El 3 de marzo se recetó Pomada X para la fisura anal.',
    fileName: 'informe.md',
    generator,
  });

  assert.equal(result.mode, 'llm');
  assert.deepEqual(result.entities, [{ name: 'Pomada X', count: 1 }]);
  assert.deepEqual(result.relevantDates, [{ date: '2026-03-03', description: 'Prescripción' }]);
});

test('extraction keeps the existing heuristic fallback when no key is configured', async () => {
  const result = await extractSemantics({
    text: '# Note\n\nTreatment treatment treatment and follow up.',
    fileName: 'note.md',
    generator: { available: false },
  });

  assert.equal(result.mode, 'heuristic');
  assert.ok(result.concepts.length + result.entities.length > 0);
});

test('long documents are split on paragraph boundaries without omitting the middle', () => {
  const chunks = splitTextIntoChunks(`${'a'.repeat(20)}\n\n${'b'.repeat(20)}\n\n${'c'.repeat(20)}`, 25);
  assert.deepEqual(chunks, ['a'.repeat(20), 'b'.repeat(20), 'c'.repeat(20)]);
  assert.match(chunks.join(''), /a{20}b{20}c{20}/);
});

test('semantic extraction processes and merges every long-document chunk', async (context) => {
  const previous = process.env.LLM_CHUNK_CHARS;
  process.env.LLM_CHUNK_CHARS = '30';
  context.after(() => {
    if (previous === undefined) delete process.env.LLM_CHUNK_CHARS;
    else process.env.LLM_CHUNK_CHARS = previous;
  });
  const prompts = [];
  const generator = {
    available: true,
    async generateJson({ prompt }) {
      prompts.push(prompt);
      const part = prompts.length;
      return {
        summary: `Resumen ${part}`,
        concepts: [`Concepto ${part}`],
        entities: [],
        relevant_dates: [{ date: `2026-03-0${part}`, description: `Evento ${part}` }],
      };
    },
  };

  const result = await extractSemantics({
    text: `${'a'.repeat(20)}\n\n${'b'.repeat(20)}\n\n${'c'.repeat(20)}`,
    fileName: 'largo.md',
    generator,
  });

  assert.equal(prompts.length, 3);
  assert.match(prompts[1], /b{20}/);
  assert.equal(result.relevantDates.length, 3);
  assert.equal(result.mode, 'llm');
});
