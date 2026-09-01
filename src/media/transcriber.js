import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { ensureDir } from '../utils.js';

export function transcribeWithWhisper(audioPath, {
  model = 'turbo',
  language = 'es',
  outputDir = path.dirname(audioPath),
  runCommand = execFileSync,
} = {}) {
  ensureDir(outputDir);
  const args = [
    audioPath,
    '--model', model,
    '--output_format', 'json',
    '--output_dir', outputDir,
    '--verbose', 'False',
  ];
  if (language && language !== 'auto') args.push('--language', language);
  runCommand('whisper', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

  const transcriptPath = path.join(outputDir, `${path.basename(audioPath, path.extname(audioPath))}.json`);
  if (!fs.existsSync(transcriptPath)) throw new Error(`Whisper did not create ${transcriptPath}`);
  const result = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  return {
    language: result.language || language,
    text: result.text || '',
    segments: (result.segments || []).map((segment) => ({
      start: Number(segment.start) || 0,
      end: Number(segment.end) || Number(segment.start) || 0,
      text: String(segment.text || '').trim(),
    })).filter((segment) => segment.text),
    transcriptPath,
  };
}
