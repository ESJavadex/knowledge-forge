import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

/** Filesystem/OS-tool adapter for the source-reading port. */
export function readSourceDocument(filePath, options) {
  return readSourceWithEvidence(filePath, options).text;
}

export function readSourceWithEvidence(filePath, { runCommand = execFileSync } = {}) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.pdf') {
    try {
      const text = runCommand('pdftotext', ['-layout', filePath, '-'], {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      });
      if (hasUsefulText(text)) return documentFromPages(text, 'text');
      if (process.env.OCR_ENABLED === 'false') throw new Error('the PDF contains no extractable text and OCR is disabled');
      return ocrPdf(filePath, runCommand);
    } catch (error) {
      throw new Error(`Could not read PDF ${path.basename(filePath)}: ${error.message}`);
    }
  }

  if (extension === '.docx') {
    try {
      const xml = runCommand('unzip', ['-p', filePath, 'word/document.xml'], {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      });
      const segments = docxXmlToSegments(xml);
      const text = segments.map((segment) => segment.text).join('\n\n');
      if (!text.trim()) throw new Error('the DOCX contains no extractable text');
      return { text, segments, extraction: 'docx-xml' };
    } catch (error) {
      throw new Error(`Could not read DOCX ${path.basename(filePath)} with unzip: ${error.message}`);
    }
  }

  const text = fs.readFileSync(filePath, 'utf8');
  return { text, segments: textToSegments(text), extraction: 'text' };
}

export function docxXmlToText(xml) {
  return docxXmlToSegments(xml).map((segment) => segment.text).join('\n\n');
}

export function docxXmlToSegments(xml) {
  if (typeof xml !== 'string') return [];
  return xml.split(/<\/w:p>/i).map((paragraph, index) => ({
    locator: `paragraph ${index + 1}`,
    text: xmlFragmentToText(paragraph),
  })).filter((segment) => segment.text);
}

function xmlFragmentToText(xml) {
  return decodeXmlEntities(xml
    .replace(/<w:tab\b[^>]*\/>/gi, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:tc>/gi, '\t')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function ocrPdf(filePath, runCommand) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-forge-ocr-'));
  try {
    const prefix = path.join(tempDir, 'page');
    runCommand('pdftoppm', ['-png', '-r', process.env.OCR_DPI || '200', filePath, prefix], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    const images = fs.readdirSync(tempDir).filter((name) => name.endsWith('.png')).sort(naturalSort);
    if (images.length === 0) throw new Error('pdftoppm did not produce any page images');

    const language = process.env.OCR_LANGUAGES || 'spa+eng';
    const segments = images.map((image, index) => ({
      locator: `page ${index + 1}`,
      text: runCommand('tesseract', [path.join(tempDir, image), 'stdout', '-l', language], {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      }).trim(),
    })).filter((segment) => segment.text);
    const text = segments.map((segment) => segment.text).join('\n\n');
    if (!hasUsefulText(text)) throw new Error('OCR produced no usable text');
    return { text, segments, extraction: 'ocr' };
  } catch (error) {
    if (error.code === 'ENOENT' && error.path === 'tesseract') {
      throw new Error('OCR requires tesseract (plus the spa/eng language packs)');
    }
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function documentFromPages(text, extraction) {
  const pages = text.split('\f');
  const segments = pages.map((page, index) => ({
    locator: `page ${index + 1}`,
    text: page.trim(),
  })).filter((segment) => segment.text);
  return { text: segments.map((segment) => segment.text).join('\n\n'), segments, extraction };
}

function textToSegments(text) {
  const lines = text.split('\n');
  const sections = [];
  let locator = 'document';
  let buffer = [];
  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) sections.push({ locator, text: content });
    buffer = [];
  };
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flush();
      locator = `section: ${heading[1].trim()}`;
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections.length > 0 ? sections : [{ locator: 'document', text: text.trim() }].filter((segment) => segment.text);
}

function hasUsefulText(text) {
  return typeof text === 'string' && text.replace(/\s/g, '').length >= 12;
}

function naturalSort(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
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
