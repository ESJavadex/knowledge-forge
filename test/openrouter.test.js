import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenRouterJsonGenerator, parseJsonDefensively } from '../src/adapters/openrouter.js';

test('parseJsonDefensively accepts fenced JSON and rejects prose', () => {
  assert.deepEqual(parseJsonDefensively('```json\n{"ok":true}\n```'), { ok: true });
  assert.throws(() => parseJsonDefensively('not json'), /valid JSON/);
});

test('OpenRouter adapter uses the configured model without exposing provider details to callers', async () => {
  let requestBody;
  const generator = new OpenRouterJsonGenerator({
    apiKey: 'test-key',
    model: 'anthropic/test-model',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' } }] }), { status: 200 });
    },
  });

  const result = await generator.generateJson({
    system: 'system',
    prompt: 'prompt',
    schemaName: 'answer',
    schema: { type: 'object' },
  });

  assert.deepEqual(result, { answer: 'ok' });
  assert.equal(requestBody.model, 'anthropic/test-model');
  assert.equal(requestBody.response_format.type, 'json_schema');
});
