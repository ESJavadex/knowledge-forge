import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenClawJsonGenerator } from '../src/adapters/openclaw.js';

test('OpenClaw adapter uses lean local inference and validates structured output', async () => {
  let invocation;
  const generator = new OpenClawJsonGenerator({
    model: 'zai/glm-5.3-flash',
    runImpl: async (binary, args, options) => {
      invocation = { binary, args, options };
      return {
        stdout: JSON.stringify({
          provider: 'zai',
          model: 'glm-5.3-flash',
          outputs: [{ text: '{"summary":"ok","categories":["Salud"]}' }],
        }),
      };
    },
  });

  const result = await generator.generateJson({
    system: 'Ground facts.',
    prompt: 'Source text.',
    schemaName: 'extract',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'categories'],
      properties: {
        summary: { type: 'string' },
        categories: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      },
    },
  });

  assert.deepEqual(result, { summary: 'ok', categories: ['Salud'] });
  assert.equal(invocation.binary, 'openclaw');
  assert.ok(invocation.args.includes('--local'));
  assert.ok(invocation.args.includes('zai/glm-5.3-flash'));
  assert.ok(invocation.args.includes('--json'));
});

test('OpenClaw adapter rejects a different effective model', async () => {
  const generator = new OpenClawJsonGenerator({
    model: 'zai/glm-5.3-flash',
    runImpl: async () => ({
      stdout: JSON.stringify({ provider: 'other', model: 'fallback', outputs: [{ text: '{}' }] }),
    }),
  });

  await assert.rejects(
    generator.generateJson({ system: '', prompt: '', schemaName: 'x', schema: { type: 'object' } }),
    /expected exact model/,
  );
});
