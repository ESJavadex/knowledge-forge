import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { docxXmlToText, readSourceDocument, readSourceWithEvidence } from '../src/adapters/source-reader.js';

test('DOCX XML is converted to readable paragraphs, tabs, line breaks, and entities', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>Pomada &amp; crema</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>3 de marzo</w:t><w:tab/><w:t>2026</w:t><w:br/><w:t>Control</w:t></w:r></w:p>'
    + '</w:body></w:document>';

  assert.equal(docxXmlToText(xml), 'Pomada & crema\n\n3 de marzo\t2026\nControl');
});

test('source reader extracts text from real PDF and DOCX containers without modifying them', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-forge-readers-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const pdfPath = path.join(fixtureRoot, 'informe.pdf');
  const docxPath = path.join(fixtureRoot, 'informe.docx');
  fs.writeFileSync(pdfPath, createMinimalPdf('Pomada X on 2026-03-03'));

  const wordDir = path.join(fixtureRoot, 'word');
  fs.mkdirSync(wordDir);
  fs.writeFileSync(path.join(wordDir, 'document.xml'),
    '<w:document><w:body><w:p><w:r><w:t>Pomada X el 3 de marzo de 2026</w:t></w:r></w:p></w:body></w:document>');
  execFileSync('zip', ['-q', docxPath, 'word/document.xml'], { cwd: fixtureRoot });

  const pdfBefore = fs.readFileSync(pdfPath);
  const docxBefore = fs.readFileSync(docxPath);
  assert.match(readSourceDocument(pdfPath), /Pomada X on 2026-03-03/);
  assert.match(readSourceDocument(docxPath), /Pomada X el 3 de marzo de 2026/);
  assert.deepEqual(fs.readFileSync(pdfPath), pdfBefore);
  assert.deepEqual(fs.readFileSync(docxPath), docxBefore);
});

test('a scanned PDF falls back to page OCR with precise page locators', () => {
  const calls = [];
  const document = readSourceWithEvidence('/tmp/scanned.pdf', {
    runCommand(command, args) {
      calls.push(command);
      if (command === 'pdftotext') return '   ';
      if (command === 'pdftoppm') {
        fs.writeFileSync(`${args.at(-1)}-1.png`, 'fake image');
        return '';
      }
      if (command === 'tesseract') return 'Pomada X para la fisura, 3 de marzo de 2026';
      throw new Error(`Unexpected command: ${command}`);
    },
  });

  assert.equal(document.extraction, 'ocr');
  assert.deepEqual(document.segments, [{ locator: 'page 1', text: 'Pomada X para la fisura, 3 de marzo de 2026' }]);
  assert.deepEqual(calls, ['pdftotext', 'pdftoppm', 'tesseract']);
});

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
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}
