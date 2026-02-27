import { writeFile } from 'node:fs/promises';

const OUTPUT_FILE = new URL('../src/lib/phStationsBackup.json', import.meta.url);
const MAX_STATIONS = 500;
const API_URL =
  process.env.RADIO_BACKUP_SOURCE_URL ||
  'https://all.api.radio-browser.info/json/stations/bycountrycodeexact/PH?hidebroken=true&order=clickcount&reverse=true&limit=1200';

function cleanText(value) {
  return String(value || '').trim();
}

function deriveFrequency(name) {
  const match = cleanText(name).match(/(\d{2,3}(?:\.\d)?)\s*(FM|AM)\b/i);
  return match ? `${match[1]} ${match[2].toUpperCase()}` : '';
}

function normalizeStation(raw) {
  const name = cleanText(raw?.name);
  const streamUrl = cleanText(raw?.url_resolved || raw?.url);
  return {
    id: cleanText(raw?.stationuuid || raw?.changeuuid || `${name.toLowerCase()}-${streamUrl.toLowerCase()}`),
    name,
    frequency: deriveFrequency(name),
    city: cleanText(raw?.state),
    country: cleanText(raw?.country) || 'Philippines',
    genre: cleanText(raw?.tags),
    streamUrl,
    language: cleanText(raw?.language || raw?.languagecodes),
    codec: cleanText(raw?.codec).toUpperCase(),
    bitrate: Number(raw?.bitrate) || 0,
    votes: Number(raw?.votes) || 0,
    isActive: true
  };
}

function isBlockedUrl(url) {
  const lowered = cleanText(url).toLowerCase();
  return lowered.includes('youtube.com') || lowered.includes('youtu.be') || lowered.includes('facebook.com');
}

function dedupeAndClean(input) {
  const seenIds = new Set();
  const seenKeys = new Set();
  const output = [];

  for (const raw of input) {
    const station = normalizeStation(raw);
    if (!station.name || !station.streamUrl) continue;
    if (!/^https?:\/\//i.test(station.streamUrl)) continue;
    if (isBlockedUrl(station.streamUrl)) continue;

    const key = `${station.name.toLowerCase()}|${station.streamUrl.toLowerCase()}`;
    if (station.id && seenIds.has(station.id)) continue;
    if (seenKeys.has(key)) continue;

    if (station.id) seenIds.add(station.id);
    seenKeys.add(key);
    output.push(station);
  }

  output.sort((a, b) => {
    if ((b.votes || 0) !== (a.votes || 0)) return (b.votes || 0) - (a.votes || 0);
    return a.name.localeCompare(b.name);
  });

  return output.slice(0, MAX_STATIONS);
}

async function main() {
  const response = await fetch(API_URL, {
    headers: {
      accept: 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch stations (${response.status}) from ${API_URL}`);
  }

  const json = await response.json();
  if (!Array.isArray(json)) {
    throw new Error(`Unexpected response format from ${API_URL}`);
  }

  const stations = dedupeAndClean(json);
  if (stations.length === 0) {
    throw new Error('No usable stations returned from API.');
  }

  await writeFile(OUTPUT_FILE, `${JSON.stringify(stations, null, 2)}\n`, 'utf8');
  console.log(`Saved ${stations.length} station(s) to ${OUTPUT_FILE.pathname}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
