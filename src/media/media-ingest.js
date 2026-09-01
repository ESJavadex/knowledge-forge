import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { ingestSource } from '../ingest.js';
import { ensureDir, nowIso, RAW_DIR, ROOT, slugify, writeText } from '../utils.js';
import { resolveMediaSource } from './sources.js';
import { transcribeWithWhisper } from './transcriber.js';

export const DEFAULT_MEDIA_CACHE = path.join(ROOT, '.media-cache');
export const DEFAULT_MEDIA_RAW = path.join(RAW_DIR, 'media');

export async function runMediaIngest(url, {
  all = false,
  latest = 1,
  after = null,
  before = null,
  match = null,
  oldestFirst = false,
  dryRun = false,
  downloadOnly = false,
  model = 'turbo',
  language = 'es',
  ingest = true,
  deleteAudio = false,
  force = false,
  cacheRoot = DEFAULT_MEDIA_CACHE,
  rawRoot = DEFAULT_MEDIA_RAW,
  logger = console,
  fetchImpl = globalThis.fetch,
  runCommand = execFileSync,
  resolveFn = resolveMediaSource,
  downloadFn = downloadEpisode,
  transcribeFn = transcribeWithWhisper,
  ingestFn = ingestSource,
} = {}) {
  const source = await resolveFn(url, { fetchImpl, runCommand });
  const selected = selectEpisodes(source.episodes, { all, latest, after, before, match, oldestFirst });
  const estimatedSeconds = selected.reduce((sum, episode) => sum + (episode.durationSeconds || 0), 0);
  logger.log(`\n🎙️  ${source.title}`);
  logger.log(`  Source: ${source.type}${source.feedUrl ? ` (${source.feedUrl})` : ''}`);
  logger.log(`  Episodes: ${selected.length} selected / ${source.episodes.length} available`);
  if (estimatedSeconds) logger.log(`  Duration: ${formatDuration(estimatedSeconds)}`);

  if (dryRun) {
    selected.forEach((episode, index) => logger.log(`  ${index + 1}. ${episode.title} (${formatDuration(episode.durationSeconds)})`));
    return { source, selected, processed: [], skipped: [], failures: [], dryRun: true };
  }

  ensureDir(cacheRoot);
  ensureDir(rawRoot);
  const manifestPath = path.join(cacheRoot, 'manifest.json');
  const manifest = loadManifest(manifestPath);
  const sourceSlug = slugify(source.title) || 'media-source';
  const audioDir = path.join(cacheRoot, 'audio', sourceSlug);
  const transcriptDir = path.join(cacheRoot, 'transcripts', sourceSlug);
  const rawDir = path.join(rawRoot, sourceSlug);
  [audioDir, transcriptDir, rawDir].forEach(ensureDir);

  const processed = [];
  const skipped = [];
  const failures = [];
  for (const episode of selected) {
    const key = `${source.type}:${episode.id}`;
    const existing = manifest.episodes[key];
    if (!force && existing?.status === 'complete' && existing.rawPath && fs.existsSync(existing.rawPath)) {
      logger.log(`\n  ⏭️  ${episode.title}`);
      skipped.push(episode);
      continue;
    }

    try {
      logger.log(`\n  ⬇️  ${episode.title}`);
      const stem = episodeFileStem(episode);
      const extension = episode.downloadStrategy === 'yt-dlp' ? '.mp3' : audioExtension(episode.audioUrl);
      const audioPath = path.join(audioDir, `${stem}${extension}`);
      if (force || !fs.existsSync(audioPath)) {
        await downloadFn(episode, audioPath, { fetchImpl, runCommand, logger });
      } else {
        logger.log('     Audio cache hit');
      }
      manifest.episodes[key] = {
        ...existing,
        status: 'downloaded',
        title: episode.title,
        sourceUrl: episode.sourceUrl,
        audioPath,
        downloadedAt: nowIso(),
      };
      saveManifest(manifestPath, manifest);

      if (downloadOnly) {
        processed.push({ episode, audioPath, status: 'downloaded' });
        continue;
      }

      logger.log(`  🎤 Transcribing with Whisper (${model}, ${language})`);
      const transcript = transcribeFn(audioPath, { model, language, outputDir: transcriptDir, runCommand });
      const rawPath = path.join(rawDir, `${stem}.md`);
      writeText(rawPath, renderEpisodeMarkdown({ source, episode, transcript, model }));
      logger.log(`  📝 ${path.relative(ROOT, rawPath)}`);

      let wikiResult = null;
      if (ingest) {
        logger.log('  🧠 Compiling into LLM Wiki');
        wikiResult = await ingestFn(rawPath, { logger, force });
      }

      manifest.episodes[key] = {
        ...manifest.episodes[key],
        status: 'complete',
        rawPath,
        transcriptPath: transcript.transcriptPath || null,
        transcribedAt: nowIso(),
        model,
      };
      saveManifest(manifestPath, manifest);
      if (deleteAudio && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      processed.push({ episode, audioPath, rawPath, wikiResult, status: 'complete' });
    } catch (error) {
      manifest.episodes[key] = {
        ...manifest.episodes[key],
        status: 'failed',
        title: episode.title,
        error: error.message,
        failedAt: nowIso(),
      };
      saveManifest(manifestPath, manifest);
      logger.error(`  ❌ ${error.message}`);
      failures.push({ episode, error });
    }
  }

  return { source, selected, processed, skipped, failures, dryRun: false };
}

export function selectEpisodes(episodes, {
  all = false,
  latest = 1,
  after = null,
  before = null,
  match = null,
  oldestFirst = false,
} = {}) {
  const afterDate = parseDateFilter(after, '--after');
  const beforeDate = parseDateFilter(before, '--before');
  if (afterDate && beforeDate && afterDate > beforeDate) throw new Error('--after must be earlier than or equal to --before.');
  let filtered = episodes.filter((episode) => {
    const date = episode.publishedAt?.slice(0, 10) || null;
    if (afterDate && (!date || date < afterDate)) return false;
    if (beforeDate && (!date || date > beforeDate)) return false;
    if (match && !String(episode.title).toLocaleLowerCase().includes(String(match).toLocaleLowerCase())) return false;
    return true;
  });
  if (oldestFirst) filtered = [...filtered].reverse();
  if (all) return filtered;
  const limit = Number(latest);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--latest must be a positive integer.');
  return filtered.slice(0, limit);
}

export async function downloadEpisode(episode, outputPath, {
  fetchImpl = globalThis.fetch,
  runCommand = execFileSync,
  logger = console,
} = {}) {
  ensureDir(path.dirname(outputPath));
  if (episode.downloadStrategy === 'yt-dlp') {
    const template = path.join(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}.%(ext)s`);
    runCommand('yt-dlp', [
      '--js-runtimes', `node:${process.execPath}`,
      '--no-playlist',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      '--output', template,
      episode.sourceUrl,
    ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (!fs.existsSync(outputPath)) throw new Error(`yt-dlp did not create ${outputPath}`);
    return outputPath;
  }

  const response = await fetchImpl(episode.audioUrl, { headers: { 'User-Agent': 'Knowledge-Forge/0.1' } });
  if (!response.ok || !response.body) throw new Error(`Audio download returned HTTP ${response.status}`);
  const temporaryPath = `${outputPath}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporaryPath));
    fs.renameSync(temporaryPath, outputPath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
  logger.log(`     Saved ${formatBytes(fs.statSync(outputPath).size)}`);
  return outputPath;
}

export function renderEpisodeMarkdown({ source, episode, transcript, model }) {
  const published = episode.publishedAt?.slice(0, 10) || null;
  const grouped = groupSegments(transcript.segments || []);
  let markdown = `---\n`;
  markdown += `type: media-transcript\n`;
  markdown += `title: ${JSON.stringify(episode.title)}\n`;
  markdown += `podcast: ${JSON.stringify(source.title)}\n`;
  markdown += `source_type: ${JSON.stringify(source.type)}\n`;
  markdown += `source_url: ${JSON.stringify(episode.sourceUrl || source.originalUrl)}\n`;
  markdown += `show_url: ${JSON.stringify(source.originalUrl || null)}\n`;
  markdown += `audio_url: ${JSON.stringify(episode.audioUrl || null)}\n`;
  markdown += `feed_url: ${JSON.stringify(source.feedUrl || null)}\n`;
  markdown += `episode_id: ${JSON.stringify(String(episode.id))}\n`;
  markdown += `published: ${JSON.stringify(published)}\n`;
  markdown += `duration_seconds: ${episode.durationSeconds || 'null'}\n`;
  markdown += `transcription_model: ${JSON.stringify(model)}\n`;
  markdown += `transcription_language: ${JSON.stringify(transcript.language || null)}\n`;
  markdown += `transcribed_at: ${JSON.stringify(nowIso())}\n`;
  markdown += `---\n\n# ${episode.title}\n\n`;
  markdown += `> Podcast: ${source.title}\n>\n> Original: ${episode.sourceUrl || source.originalUrl}\n`;
  if (episode.publishedAt) markdown += `> Published: ${published}\n`;
  if (episode.durationSeconds) markdown += `> Duration: ${formatDuration(episode.durationSeconds)}\n`;
  if (episode.description) markdown += `\n## Description\n\n${episode.description}\n`;
  markdown += `\n## Transcript\n`;
  for (const group of grouped) {
    markdown += `\n### ${formatTimestamp(group.start)}–${formatTimestamp(group.end)}\n\n`;
    for (const segment of group.segments) markdown += `**[${formatTimestamp(segment.start)}]** ${segment.text}\n\n`;
  }
  return markdown.trimEnd() + '\n';
}

function groupSegments(segments, bucketSeconds = 300) {
  const groups = new Map();
  for (const segment of segments) {
    const bucket = Math.floor((segment.start || 0) / bucketSeconds) * bucketSeconds;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(segment);
  }
  return [...groups.entries()].map(([start, bucketSegments]) => ({
    start,
    end: Math.max(...bucketSegments.map((segment) => segment.end || segment.start || start)),
    segments: bucketSegments,
  }));
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return { version: 1, episodes: {} };
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return { version: 1, ...manifest, episodes: manifest.episodes || {} };
  } catch {
    throw new Error(`Invalid media manifest: ${manifestPath}`);
  }
}

function saveManifest(manifestPath, manifest) {
  ensureDir(path.dirname(manifestPath));
  const temporaryPath = `${manifestPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.renameSync(temporaryPath, manifestPath);
}

function episodeFileStem(episode) {
  const date = episode.publishedAt?.slice(0, 10) || 'undated';
  const idHash = Buffer.from(String(episode.id)).toString('base64url').slice(0, 8).toLowerCase();
  return `${date}-${slugify(episode.title).slice(0, 90) || 'episode'}-${idHash}`;
}

function audioExtension(url) {
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.(mp3|m4a|aac|ogg|opus|wav|flac|mp4)$/.test(extension)) return extension;
  } catch {
    // Fall through to the common podcast default.
  }
  return '.mp3';
}

function parseDateFilter(value, flag) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf())) {
    throw new Error(`${flag} must use YYYY-MM-DD.`);
  }
  return value;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return 'unknown';
  const total = Math.max(0, Math.round(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
