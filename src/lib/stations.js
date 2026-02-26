import { isSupportedPlaylistUrl } from './player';

export function sanitizeText(value) {
  return String(value || '').trim();
}

export function deriveFrequency(name) {
  const match = sanitizeText(name).match(/(\d{2,3}(?:\.\d)?)\s*(FM|AM)\b/i);
  return match ? `${match[1]} ${match[2].toUpperCase()}` : '';
}

export function cleanLocation(value) {
  const cleaned = sanitizeText(value).replace(/[|/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2) return '';
  return cleaned;
}

export function getLocationCategory(station) {
  const city = sanitizeText(station?.city);
  const country = sanitizeText(station?.country) || 'Philippines';
  return city || country;
}

export function isBlockedUrl(url, blockedHostSnippets) {
  const lowered = sanitizeText(url).toLowerCase();
  return blockedHostSnippets.some((snippet) => lowered.includes(snippet));
}

export function isLikelyDirectAudioUrl(url, options) {
  const { blockedHostSnippets, trustedHosts, directAudioHints, playlistRegex } = options;
  const lowered = sanitizeText(url).toLowerCase();
  if (!/^https?:\/\//i.test(lowered)) return false;
  if (isBlockedUrl(lowered, blockedHostSnippets)) return false;
  if (playlistRegex.test(lowered)) {
    return isSupportedPlaylistUrl(lowered);
  }

  try {
    const parsed = new URL(lowered);
    const hostname = sanitizeText(parsed.hostname).toLowerCase();
    if (trustedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
      return true;
    }
  } catch {
    // fall through
  }

  return directAudioHints.some((hint) => lowered.includes(hint));
}

export function getPlaybackError(url, options) {
  const { blockedHostSnippets, trustedHosts, directAudioHints, playlistRegex } = options;
  const value = sanitizeText(url).toLowerCase();
  if (!/^https?:\/\//i.test(value)) {
    return 'Invalid stream URL.';
  }
  if (isBlockedUrl(value, blockedHostSnippets)) {
    return 'This stream host is blocked in the app.';
  }
  if (playlistRegex.test(value) && !isSupportedPlaylistUrl(value)) {
    return 'Playlist URLs (.pls/.m3u) are not directly playable. Use a direct stream URL.';
  }
  if (!isLikelyDirectAudioUrl(value, { blockedHostSnippets, trustedHosts, directAudioHints, playlistRegex })) {
    return 'This station does not provide a direct embeddable audio stream.';
  }
  return '';
}

function extractUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = extractUrl(item);
      if (resolved) return resolved;
    }
    return '';
  }
  if (typeof value === 'object') {
    return extractUrl(value.url) || extractUrl(value.source_url) || extractUrl(value.rendered) || extractUrl(value.value) || '';
  }
  return '';
}

function findAudioUrlInText(text) {
  const source = sanitizeText(text);
  if (!source) return '';
  const match = source.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? sanitizeText(match[0]) : '';
}

function normalizeWpStation(raw) {
  const name = sanitizeText(raw?.name) || sanitizeText(raw?.title?.rendered) || sanitizeText(raw?.title);
  const acf = raw?.acf || {};
  const meta = raw?.meta || {};
  const streamUrl =
    extractUrl(raw?.streamUrl) ||
    extractUrl(raw?.stream_url) ||
    extractUrl(acf?.streamUrl) ||
    extractUrl(acf?.stream_url) ||
    extractUrl(meta?.streamUrl) ||
    extractUrl(meta?.stream_url) ||
    extractUrl(raw?.url_resolved) ||
    extractUrl(raw?.url) ||
    extractUrl(findAudioUrlInText(raw?.content?.rendered)) ||
    extractUrl(findAudioUrlInText(raw?.excerpt?.rendered));

  const country = sanitizeText(raw?.country) || sanitizeText(acf?.country) || 'Philippines';
  const city = cleanLocation(sanitizeText(raw?.city) || sanitizeText(acf?.city));
  const genre = sanitizeText(raw?.genre) || sanitizeText(acf?.genre) || sanitizeText(raw?.tags) || sanitizeText(acf?.tags);
  const codec = sanitizeText(raw?.codec) || sanitizeText(acf?.codec);
  const bitrate = Number(raw?.bitrate ?? acf?.bitrate) || 0;
  const isActiveRaw = raw?.is_active ?? acf?.is_active ?? meta?.is_active;
  const isActive =
    isActiveRaw === true ||
    isActiveRaw === 1 ||
    isActiveRaw === '1' ||
    String(isActiveRaw).toLowerCase() === 'true';

  return {
    id: sanitizeText(raw?.id || raw?.slug || name.toLowerCase()),
    name,
    frequency: deriveFrequency(name),
    city,
    country,
    genre,
    streamUrl,
    language: sanitizeText(raw?.language) || sanitizeText(acf?.language),
    codec: codec.toUpperCase(),
    bitrate,
    votes: Number(raw?.votes) || 0,
    isActive
  };
}

function dedupeAndCleanStations(input, options) {
  const { maxStations, blockedHostSnippets, playlistRegex } = options;
  const seenIds = new Set();
  const seenKeys = new Set();
  const out = [];

  for (const raw of input) {
    const station = normalizeWpStation(raw);
    if (station?.isActive === false) continue;
    if (!station?.name || !station?.streamUrl) continue;
    if (!/^https?:\/\//i.test(station.streamUrl)) continue;
    if (isBlockedUrl(station.streamUrl, blockedHostSnippets)) continue;
    if (playlistRegex.test(station.streamUrl) && !isSupportedPlaylistUrl(station.streamUrl)) continue;

    const fallbackKey = `${station.name.toLowerCase()}|${station.streamUrl.toLowerCase()}`;
    if (station.id && seenIds.has(station.id)) continue;
    if (seenKeys.has(fallbackKey)) continue;

    if (station.id) seenIds.add(station.id);
    seenKeys.add(fallbackKey);
    out.push(station);
  }

  out.sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return a.name.localeCompare(b.name);
  });

  return out.slice(0, maxStations);
}

function fetchJsonWithTimeout(url, timeoutMs) {
  return Promise.race([
    fetch(url).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Request failed (${response.status}) at ${url}`);
      }
      return response.json();
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms at ${url}`)), timeoutMs))
  ]);
}

export async function fetchWordPressStations({ endpoints, timeoutMs, maxStations, blockedHostSnippets, playlistRegex }) {
  let lastError = '';
  for (const endpoint of endpoints) {
    try {
      const json = await fetchJsonWithTimeout(endpoint, timeoutMs);
      if (!Array.isArray(json)) {
        lastError = `Unexpected WP response format at ${endpoint}`;
        continue;
      }

      const cleaned = dedupeAndCleanStations(json, {
        maxStations,
        blockedHostSnippets,
        playlistRegex
      });

      if (cleaned.length > 0) {
        return { stations: cleaned, source: endpoint };
      }
      lastError = `No usable stations at ${endpoint}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }

  throw new Error(lastError || 'WordPress returned no usable stations.');
}

export function buildLocationMenuItems(fromStations) {
  const counts = new Map();
  for (const station of fromStations) {
    const key = getLocationCategory(station);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}
