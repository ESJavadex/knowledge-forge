import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('medical note can be ingested and queried with exact wiki/raw citations', async (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-forge-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  for (const directory of ['src', 'schema']) {
    fs.cpSync(path.join(projectRoot, directory), path.join(fixtureRoot, directory), { recursive: true });
  }
  fs.symlinkSync(path.join(projectRoot, 'node_modules'), path.join(fixtureRoot, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(fixtureRoot, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'wiki'), { recursive: true });

  const sourcePath = path.join(fixtureRoot, 'raw', 'informe-medico.md');
  const sourceText = '# Informe médico\n\nEl 3 de marzo de 2026 se recetó Pomada X para una fisura anal.\n';
  fs.writeFileSync(sourcePath, sourceText);

  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const schemaName = payload.response_format?.json_schema?.name;
    const result = schemaName === 'knowledge_extraction'
      ? {
          summary: 'El 3 de marzo de 2026 se recetó Pomada X para una fisura anal.',
          concepts: ['Fisura anal', 'Tratamiento'],
          entities: ['Pomada X'],
          relevant_dates: [{ date: '2026-03-03', description: 'Prescripción de Pomada X' }],
        }
      : {
          found: true,
          claims: [{
            text: 'Se recetó Pomada X para la fisura anal el 3 de marzo de 2026.',
            citations: [{
              wiki_page: 'sources/informe-medico.md',
              raw_source: 'raw/informe-medico.md',
            }],
          }],
          not_found_reason: '',
        };

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());

  const env = {
    ...process.env,
    OPENROUTER_API_KEY: 'integration-test-key',
    OPENROUTER_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    OPENROUTER_MODEL: 'anthropic/test-model',
  };

  await runCli(['ingest', sourcePath], fixtureRoot, env);
  const queryOutput = await runCli(['query', '¿qué me recetaron para la fisura y en qué fecha?'], fixtureRoot, env);

  assert.match(queryOutput, /Pomada X/);
  assert.match(queryOutput, /wiki\/sources\/informe-medico\.md/);
  assert.match(queryOutput, /raw\/informe-medico\.md/);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), sourceText);

  const analyses = fs.readdirSync(path.join(fixtureRoot, 'wiki', 'analyses'));
  assert.equal(analyses.length, 1);
  const analysis = fs.readFileSync(path.join(fixtureRoot, 'wiki', 'analyses', analyses[0]), 'utf8');
  assert.match(analysis, /\[\[Informe Medico\]\]/);
  assert.match(analysis, /raw\/informe-medico\.md/);
});

function runCli(args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/cli.js', ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`CLI exited ${code}: ${stderr || stdout}`));
    });
  });
}
