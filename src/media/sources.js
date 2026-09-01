import path from 'path';
import { execFileSync } from 'child_process';
import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
});

export function detectMediaSource(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, '');
  if (host === 'open.spotify.com' && parsed.pathname.startsWith('/show/')) return 'spotify';
  if (host === 'youtube.com' || host === 'youtu.be') return 'youtube';
  return 'rss';
}

export async function resolveMediaSource(url, {
  fetchImpl = globalThis.fetch,
  runCommand = execFileSync,
} = {}) {
  const type = detectMediaSource(url);
  if (type === 'youtube') return resolveYouTube(url, { runCommand });
  if (type === 'spotify') {
    const feedUrl = await resolveSpotifyFeed(url, { fetchImpl });
    const source = await resolveRss(feedUrl, { fetchImpl });
    return { ...source, type: 'spotify', originalUrl: url, feedUrl };
  }
  return resolveRss(url, { fetchImpl });
}

export async function resolveSpotifyFeed(url, { fetchImpl = globalThis.fetch } = {}) {
  const pageResponse = await fetchImpl(url, { headers: { 'User-Agent': 'Knowledge-Forge/0.1' } });
  if (!pageResponse.ok) throw new Error(`Spotify page returned HTTP ${pageResponse.status}`);
  const title = extractMeta(await pageResponse.text(), 'og:title');
  if (!title) throw new Error('Could not identify the Spotify show title.');

  const endpoint = new URL('https://itunes.apple.com/search');
  endpoint.search = new URLSearchParams({
    media: 'podcast',
    entity: 'podcast',
    limit: '25',
    term: title,
  }).toString();
  const directoryResponse = await fetchImpl(endpoint);
  if (!directoryResponse.ok) throw new Error(`Podcast directory returned HTTP ${directoryResponse.status}`);
  const payload = await directoryResponse.json();
  const exact = (payload.results || []).find((candidate) => (
    candidate.feedUrl && normalizeName(candidate.collectionName) === normalizeName(title)
  ));
  if (!exact) {
    throw new Error(`No public RSS feed was found for Spotify show ${JSON.stringify(title)}. It may be Spotify-exclusive.`);
  }
  return exact.feedUrl;
}

export async function resolveRss(url, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'Knowledge-Forge/0.1' } });
  if (!response.ok) throw new Error(`RSS feed returned HTTP ${response.status}`);
  const source = parseRss(await response.text(), response.url || url);
  if (source.episodes.length === 0) throw new Error('The RSS feed contains no downloadable episodes.');
  return source;
}

export function parseRss(xml, feedUrl = '') {
  const parsed = xmlParser.parse(xml);
  const channel = parsed?.rss?.channel || parsed?.feed;
  if (!channel) throw new Error('The URL did not return a valid RSS or Atom podcast feed.');
  const items = asArray(channel.item || channel.entry);
  const title = textValue(channel.title) || 'Untitled podcast';
  const episodes = items.map((item, index) => {
    const enclosure = asArray(item.enclosure)[0] || {};
    const audioUrl = enclosure.url || enclosure.href || textValue(item.link?.find?.((link) => link.rel === 'enclosure'));
    const sourceUrl = textValue(item.link) || item.link?.href || item.guid?.['#text'] || audioUrl;
    const id = textValue(item.guid) || textValue(item.id) || audioUrl || `${title}-${index}`;
    const publishedAt = parseDate(textValue(item.pubDate) || textValue(item.published) || textValue(item.updated));
    return {
      id,
      title: textValue(item.title) || `Episode ${index + 1}`,
      description: stripHtml(textValue(item['content:encoded']) || textValue(item.description) || textValue(item.summary)),
      publishedAt,
      durationSeconds: parseDuration(textValue(item['itunes:duration'])),
      sourceUrl,
      audioUrl,
      sourceType: 'rss',
      downloadStrategy: 'http',
    };
  }).filter((episode) => episode.audioUrl);

  episodes.sort((left, right) => (right.publishedAt || '').localeCompare(left.publishedAt || ''));
  return {
    type: 'rss',
    title,
    author: textValue(channel['itunes:author']) || textValue(channel.author?.name) || '',
    description: stripHtml(textValue(channel.description) || textValue(channel.subtitle)),
    feedUrl,
    originalUrl: feedUrl,
    episodes,
  };
}

export function resolveYouTube(url, { runCommand = execFileSync } = {}) {
  const output = runCommand('yt-dlp', [
    '--js-runtimes', `node:${process.execPath}`,
    '--flat-playlist',
    '--dump-single-json',
    '--no-warnings',
    url,
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const payload = JSON.parse(output);
  const entries = payload.entries || [payload];
  const episodes = entries.filter(Boolean).map((entry, index) => {
    const videoId = entry.id || entry.url;
    return {
      id: videoId || `${payload.title}-${index}`,
      title: entry.title || `Video ${index + 1}`,
      description: entry.description || '',
      publishedAt: youtubeDate(entry.upload_date, entry.timestamp),
      durationSeconds: Number(entry.duration) || null,
      sourceUrl: entry.webpage_url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : url),
      audioUrl: null,
      sourceType: 'youtube',
      downloadStrategy: 'yt-dlp',
    };
  });
  episodes.sort((left, right) => (right.publishedAt || '').localeCompare(left.publishedAt || ''));
  return {
    type: 'youtube',
    title: payload.title || payload.channel || payload.uploader || 'YouTube',
    author: payload.channel || payload.uploader || '',
    description: payload.description || '',
    originalUrl: url,
    feedUrl: null,
    episodes,
  };
}

export function parseDuration(value) {
  if (!value) return null;
  if (/^\d+$/.test(String(value).trim())) return Number(value);
  const parts = String(value).trim().split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((seconds, part) => (seconds * 60) + part, 0);
}

function extractMeta(html, property) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)=["']([^"']*)["']/g)].map((match) => [match[1], match[2]]));
    if (attributes.property === property || attributes.name === property) return decodeEntities(attributes.content || '');
  }
  return '';
}

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return textValue(value[0]);
  return textValue(value['#text'] ?? value.__cdata ?? value.href ?? '');
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function stripHtml(value) {
  return decodeEntities(String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? match;
    const hexadecimal = entity[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isInteger(codePoint) ? String.fromCodePoint(codePoint) : match;
  });
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function youtubeDate(uploadDate, timestamp) {
  if (/^\d{8}$/.test(uploadDate || '')) {
    return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}T00:00:00.000Z`;
  }
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}
