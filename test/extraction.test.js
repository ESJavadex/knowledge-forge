import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSemantics } from '../src/extraction.js';

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
