import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseJsonDefensively } from './openrouter.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MODEL = 'zai/glm-5.3-flash';

/**
 * Lean structured-generation adapter backed by OpenClaw's configured providers.
 * It uses `infer model run`, which sends only the supplied prompt and exposes no
 * agent history, tools, or workspace context to the model.
 */
export class OpenClawJsonGenerator {
  constructor({
    model = process.env.OPENCLAW_LLM_MODEL || process.env.LLM_MODEL || DEFAULT_MODEL,
    agent = process.env.OPENCLAW_LLM_AGENT || 'main',
    binary = process.env.OPENCLAW_BIN || 'openclaw',
    timeoutMs = Number(process.env.OPENCLAW_LLM_TIMEOUT_MS || 180_000),
    runImpl = execFileAsync,
  } = {}) {
    this.model = model;
    this.agent = agent;
    this.binary = binary;
    this.timeoutMs = timeoutMs;
    this.runImpl = runImpl;
  }

  get available() {
    return Boolean(this.model && this.binary);
  }

  async generateJson({ system, prompt, schemaName, schema }) {
    const instruction = [
      system,
      'Return exactly one JSON object. Do not use Markdown fences or commentary.',
      `The object must conform exactly to JSON Schema ${schemaName}: ${JSON.stringify(schema)}`,
      prompt,
    ].join('\n\n');

    let stdout;
    try {
      ({ stdout } = await this.runImpl(this.binary, [
        'infer', 'model', 'run', '--local',
        '--agent', this.agent,
        '--model', this.model,
        '--prompt', instruction,
        '--json',
      ], {
        timeout: this.timeoutMs,
        maxBuffer: 12 * 1024 * 1024,
      }));
    } catch (error) {
      const detail = error?.stderr?.trim() || error.message;
      throw new Error(`OpenClaw model run failed: ${detail}`);
    }

    const envelope = parseJsonDefensively(stdout);
    if (envelope?.provider && envelope?.model) {
      const actual = `${envelope.provider}/${envelope.model}`;
      if (actual !== this.model) {
        throw new Error(`OpenClaw returned ${actual}; expected exact model ${this.model}.`);
      }
    }
    const content = envelope?.outputs?.[0]?.text;
    const value = normalizeForSchema(parseJsonDefensively(content), schema);
    validateSchema(value, schema, '$');
    return value;
  }
}

function normalizeForSchema(value, schema) {
  if (!schema || typeof schema !== 'object') return value;
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(schema.properties || {})
      .filter(([key]) => key in value)
      .map(([key, childSchema]) => [key, normalizeForSchema(value[key], childSchema)]));
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    const items = schema.maxItems ? value.slice(0, schema.maxItems) : value;
    return items.map((item) => normalizeForSchema(item, schema.items));
  }
  if (schema.type === 'string' && (typeof value === 'number' || typeof value === 'boolean')) return String(value);
  return value;
}

function validateSchema(value, schema, path) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
    for (const key of schema.required || []) {
      if (!(key in value)) throw new Error(`${path}.${key} is required.`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties || {}, key)) throw new Error(`${path}.${key} is not allowed.`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (key in value) validateSchema(value[key], childSchema, `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
    value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`));
  } else if (schema.type === 'string' && typeof value !== 'string') {
    throw new Error(`${path} must be a string.`);
  }
}

export function createOpenClawGenerator(options) {
  return new OpenClawJsonGenerator(options);
}
