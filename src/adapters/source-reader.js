import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/** Filesystem/poppler adapter for the source-reading port. */
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

  return fs.readFileSync(filePath, 'utf8');
}
