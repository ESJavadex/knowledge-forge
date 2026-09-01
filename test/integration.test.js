import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const extension of ['md', 'pdf', 'docx']) {
  test(`medical ${extension.toUpperCase()} can be ingested and queried with exact wiki/raw citations`, async (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-forge-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  for (const directory of ['src', 'schema']) {
    fs.cpSync(path.join(projectRoot, directory), path.join(fixtureRoot, directory), { recursive: true });
  }
  fs.symlinkSync(path.join(projectRoot, 'node_modules'), path.join(fixtureRoot, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(fixtureRoot, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'wiki'), { recursive: true });

  const sourcePath = path.join(fixtureRoot, 'raw', `informe-medico.${extension}`);
  writeMedicalSource(sourcePath, extension, fixtureRoot);
  const sourceBefore = fs.readFileSync(sourcePath);

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
              raw_source: `raw/informe-medico.${extension}`,
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
  assert.match(queryOutput, new RegExp(`raw/informe-medico\\.${extension}`));
  assert.deepEqual(fs.readFileSync(sourcePath), sourceBefore);

  const analyses = fs.readdirSync(path.join(fixtureRoot, 'wiki', 'analyses'));
  assert.equal(analyses.length, 1);
  const analysis = fs.readFileSync(path.join(fixtureRoot, 'wiki', 'analyses', analyses[0]), 'utf8');
  assert.match(analysis, /\[\[Informe Medico\]\]/);
  assert.match(analysis, new RegExp(`raw/informe-medico\\.${extension}`));
  });
}

function writeMedicalSource(sourcePath, extension, fixtureRoot) {
  const text = 'El 3 de marzo de 2026 se recetó Pomada X para una fisura anal.';
  if (extension === 'md') {
    fs.writeFileSync(sourcePath, `# Informe médico\n\n${text}\n`);
    return;
  }
  if (extension === 'pdf') {
    fs.writeFileSync(sourcePath, createMinimalPdf('Pomada X para fisura anal el 3 de marzo de 2026'));
    return;
  }

  const staging = path.join(fixtureRoot, 'docx-staging');
  fs.mkdirSync(path.join(staging, 'word'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'word', 'document.xml'),
    `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  execFileSync('zip', ['-q', sourcePath, 'word/document.xml'], { cwd: staging });
}

function createMinimalPdf(text) {
  const escaped = text.replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}

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
