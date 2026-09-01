const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-3.5-haiku';

/**
 * OpenRouter adapter for the application's structured-text generation port.
 * The rest of the codebase depends only on generateJson(), not on OpenRouter.
 */
export class OpenRouterJsonGenerator {
  constructor({
    apiKey = process.env.OPENROUTER_API_KEY,
    model = process.env.OPENROUTER_MODEL || process.env.LLM_MODEL || DEFAULT_MODEL,
    baseUrl = process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL,
    appUrl = process.env.OPENROUTER_APP_URL,
    appName = process.env.OPENROUTER_APP_NAME || 'Knowledge Forge',
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.appUrl = appUrl;
    this.appName = appName;
    this.fetchImpl = fetchImpl;
  }

  get available() {
    return Boolean(this.apiKey);
  }

  async generateJson({ system, prompt, schemaName, schema, temperature = 0 }) {
    if (!this.available) {
      throw new Error('OPENROUTER_API_KEY is not configured.');
    }

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': this.appName,
    };
    if (this.appUrl) headers['HTTP-Referer'] = this.appUrl;

    const request = async (responseFormat, systemMessage = system) => {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          temperature,
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: prompt },
          ],
          response_format: responseFormat,
        }),
      });
      const payload = await response.json().catch(() => null);
      return { response, payload };
    };

    let { response, payload } = await request({
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema },
    });

    // Some OpenRouter models support JSON mode but not strict JSON Schema.
    if (!response.ok && response.status === 400) {
      ({ response, payload } = await request(
        { type: 'json_object' },
        `${system}\nReturn one JSON object matching this schema exactly: ${JSON.stringify(schema)}`,
      ));
    }

    if (!response.ok) {
      const detail = payload?.error?.message || `HTTP ${response.status}`;
      throw new Error(`OpenRouter request failed: ${detail}`);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('OpenRouter returned an empty structured response.');
    }

    return parseJsonDefensively(content);
  }
}

export function parseJsonDefensively(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') throw new Error('Expected a JSON string.');

  const trimmed = value.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(withoutFence.slice(start, end + 1));
      } catch {
        // Fall through to the stable error below.
      }
    }
  }

  throw new Error('The model response did not contain valid JSON.');
}

export function createOpenRouterGenerator(options) {
  return new OpenRouterJsonGenerator(options);
}
