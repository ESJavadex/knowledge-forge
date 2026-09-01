import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/** Filesystem/OS-tool adapter for the source-reading port. */
export function readSourceDocument(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.pdf') {
    try {
      const text = execFileSync('pdftotext', ['-layout', filePath, '-'], {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      });
      if (!text.trim()) throw new Error('the PDF contains no extractable text');
      return text;
    } catch (error) {
      throw new Error(`Could not read PDF ${path.basename(filePath)} with pdftotext: ${error.message}`);
    }
  }

  if (extension === '.docx') {
    try {
      const xml = execFileSync('unzip', ['-p', filePath, 'word/document.xml'], {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      });
      const text = docxXmlToText(xml);
      if (!text.trim()) throw new Error('the DOCX contains no extractable text');
      return text;
    } catch (error) {
      throw new Error(`Could not read DOCX ${path.basename(filePath)} with unzip: ${error.message}`);
    }
  }

  return fs.readFileSync(filePath, 'utf8');
}

export function docxXmlToText(xml) {
  if (typeof xml !== 'string') return '';
  return decodeXmlEntities(xml
    .replace(/<w:tab\b[^>]*\/>/gi, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:tc>/gi, '\t')
    .replace(/<\/w:p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const hexadecimal = entity[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isInteger(codePoint) ? String.fromCodePoint(codePoint) : match;
  });
}
