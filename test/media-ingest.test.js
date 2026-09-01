import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMediaIngest, selectEpisodes } from '../src/media/media-ingest.js';

const episodes = [
  episode('new', 'Fascia y dolor corporal', '2026-09-01T16:00:00.000Z'),
  episode('middle', 'Protector solar y cáncer', '2026-08-31T16:00:00.000Z'),
  episode('old', 'Ayuno intermitente', '2026-08-28T16:00:00.000Z'),
];

test('filters episodes inclusively by date, title, limit, and ordering', () => {
  assert.deepEqual(selectEpisodes(episodes, { all: true, after: '2026-08-30', before: '2026-09-01' }).map((item) => item.id), ['new', 'middle']);
  assert.deepEqual(selectEpisodes(episodes, { all: true, match: 'ayuno' }).map((item) => item.id), ['old']);
  assert.deepEqual(selectEpisodes(episodes, { latest: 2, oldestFirst: true }).map((item) => item.id), ['old', 'middle']);
  assert.throws(() => selectEpisodes(episodes, { all: true, after: '09/01/2026' }), /YYYY-MM-DD/);
});

test('creates one formatted Markdown transcript per episode and skips it incrementally', async (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-forge-media-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const cacheRoot = path.join(fixtureRoot, 'cache');
  const rawRoot = path.join(fixtureRoot, 'raw');
  const ingested = [];
  const options = {
    latest: 1,
    cacheRoot,
    rawRoot,
    logger: { log() {}, error() {} },
    resolveFn: async () => ({
      type: 'spotify',
      title: 'Dr. Borja Bandera',
      feedUrl: 'https://feeds.megaphone.fm/test',
      originalUrl: 'https://open.spotify.com/show/test',
      episodes,
    }),
    downloadFn: async (_episode, outputPath) => fs.writeFileSync(outputPath, 'audio'),
    transcribeFn: (_audioPath, { model }) => ({
      language: 'es',
      text: 'Texto de prueba',
      transcriptPath: path.join(cacheRoot, `${model}.json`),
      segments: [
        { start: 0, end: 8, text: 'Bienvenidos al episodio.' },
        { start: 310, end: 318, text: 'Segunda sección.' },
      ],
    }),
    ingestFn: async (rawPath) => { ingested.push(rawPath); return { skipped: false }; },
  };

  const first = await runMediaIngest('https://open.spotify.com/show/test', options);
  assert.equal(first.processed.length, 1);
  assert.equal(ingested.length, 1);
  const markdown = fs.readFileSync(first.processed[0].rawPath, 'utf8');
  assert.match(markdown, /title: "Fascia y dolor corporal"/);
  assert.match(markdown, /published: "2026-09-01"/);
  assert.match(markdown, /## Description/);
  assert.match(markdown, /## Transcript/);
  assert.match(markdown, /\*\*\[00:00\]\*\* Bienvenidos al episodio/);
  assert.match(markdown, /### 05:00–05:18/);

  const second = await runMediaIngest('https://open.spotify.com/show/test', options);
  assert.equal(second.processed.length, 0);
  assert.equal(second.skipped.length, 1);
  assert.equal(ingested.length, 1);
});

function episode(id, title, publishedAt) {
  return {
    id,
    title,
    publishedAt,
    description: `Descripción de ${title}`,
    durationSeconds: 1214,
    sourceUrl: `https://example.com/${id}`,
    audioUrl: `https://cdn.example.com/${id}.mp3`,
    sourceType: 'rss',
    downloadStrategy: 'http',
  };
}
