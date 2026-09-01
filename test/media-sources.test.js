import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMediaSource, parseDuration, parseRss, resolveMediaSource, resolveYouTube } from '../src/media/sources.js';

const rssFixture = `<?xml version="1.0"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Dr. Borja Bandera</title>
    <itunes:author>Borja Bandera</itunes:author>
    <description>Salud basada en evidencia</description>
    <item>
      <guid>episode-2</guid>
      <title><![CDATA[Fascia y dolor corporal]]></title>
      <description><![CDATA[<p>Descripción del episodio.</p>]]></description>
      <pubDate>Tue, 01 Sep 2026 16:00:00 -0000</pubDate>
      <itunes:duration>20:14</itunes:duration>
      <enclosure url="https://cdn.example/episode-2.mp3" type="audio/mpeg" length="0"/>
    </item>
    <item>
      <guid>episode-1</guid>
      <title>Protector solar</title>
      <pubDate>Mon, 31 Aug 2026 16:00:00 -0000</pubDate>
      <itunes:duration>975</itunes:duration>
      <enclosure url="https://cdn.example/episode-1.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

test('detects Spotify, YouTube, and direct RSS inputs', () => {
  assert.equal(detectMediaSource('https://open.spotify.com/show/abc'), 'spotify');
  assert.equal(detectMediaSource('https://www.youtube.com/@example/videos'), 'youtube');
  assert.equal(detectMediaSource('https://feeds.example/podcast.xml'), 'rss');
});

test('parses podcast RSS metadata, dates, descriptions, and durations', () => {
  const source = parseRss(rssFixture, 'https://feeds.example/show');
  assert.equal(source.title, 'Dr. Borja Bandera');
  assert.equal(source.episodes.length, 2);
  assert.equal(source.episodes[0].id, 'episode-2');
  assert.equal(source.episodes[0].durationSeconds, 1214);
  assert.equal(source.episodes[0].publishedAt, '2026-09-01T16:00:00.000Z');
  assert.equal(source.episodes[0].description, 'Descripción del episodio.');
  assert.equal(parseDuration('01:02:03'), 3723);
});

test('resolves a Spotify show to an exact public RSS match', async () => {
  const spotifyUrl = 'https://open.spotify.com/show/2A4IV5p58ZtDjbI7EFDCI4';
  const feedUrl = 'https://feeds.megaphone.fm/TBT9156379627';
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url === spotifyUrl) return response('<meta property="og:title" content="Dr. Borja Bandera">', spotifyUrl);
    if (url.startsWith('https://itunes.apple.com/search')) {
      return jsonResponse({ results: [{ collectionName: 'Dr. Borja Bandera', feedUrl }] }, url);
    }
    if (url === feedUrl) return response(rssFixture, feedUrl);
    throw new Error(`Unexpected URL: ${url}`);
  };

  const source = await resolveMediaSource(spotifyUrl, { fetchImpl });
  assert.equal(source.type, 'spotify');
  assert.equal(source.feedUrl, feedUrl);
  assert.equal(source.episodes.length, 2);
});

test('normalizes a YouTube playlist from yt-dlp JSON', () => {
  const source = resolveYouTube('https://youtube.com/playlist?list=test', {
    runCommand(command, args) {
      assert.equal(command, 'yt-dlp');
      assert.ok(args.includes('--flat-playlist'));
      return JSON.stringify({
        title: 'AI Podcast',
        channel: 'Example Channel',
        entries: [{ id: 'video1', title: 'Episode One', duration: 600, upload_date: '20260901' }],
      });
    },
  });
  assert.equal(source.type, 'youtube');
  assert.equal(source.episodes[0].sourceUrl, 'https://www.youtube.com/watch?v=video1');
  assert.equal(source.episodes[0].publishedAt, '2026-09-01T00:00:00.000Z');
});

function response(body, url) {
  return { ok: true, status: 200, url, text: async () => body };
}

function jsonResponse(body, url) {
  return { ok: true, status: 200, url, json: async () => body };
}
