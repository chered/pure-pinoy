<script>
  import { onDestroy, onMount, tick } from 'svelte';
  import { buildStreamCandidates as buildPlaybackCandidates, isSupportedPlaylistUrl } from './lib/player';

  const DEV_WP_API_BASE = '/wp-api';
  const REMOTE_WP_API_BASE = 'https://radio.fourwebminds.com/wp-json';
  const WP_API_URLS = [
    `${DEV_WP_API_BASE}/wp/v2/station?per_page=100`,
    `${REMOTE_WP_API_BASE}/wp/v2/station?per_page=100`
  ];
  const RADIO_BROWSER_ENDPOINTS = [
    'https://all.api.radio-browser.info/json/stations/bycountrycodeexact/PH?hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://all.api.radio-browser.info/json/stations/search?countrycode=PH&hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://all.api.radio-browser.info/json/stations/search?countrycodeexact=PH&hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://all.api.radio-browser.info/json/stations/search?country=Philippines&hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/PH?hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://de1.api.radio-browser.info/json/stations/search?countrycode=PH&hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://de1.api.radio-browser.info/json/stations/search?countrycodeexact=PH&hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://de1.api.radio-browser.info/json/stations/search?country=Philippines&hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://nl1.api.radio-browser.info/json/stations/bycountrycodeexact/PH?hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://nl1.api.radio-browser.info/json/stations/search?countrycode=PH&hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://nl1.api.radio-browser.info/json/stations/search?countrycodeexact=PH&hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://nl1.api.radio-browser.info/json/stations/search?country=Philippines&hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://fr1.api.radio-browser.info/json/stations/bycountrycodeexact/PH?hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://fr1.api.radio-browser.info/json/stations/search?countrycode=PH&hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://fr1.api.radio-browser.info/json/stations/search?countrycodeexact=PH&hidebroken=true&order=clickcount&reverse=true&limit=1200',
    'https://fr1.api.radio-browser.info/json/stations/search?country=Philippines&hidebroken=true&order=clickcount&reverse=true&limit=1200'
  ];
  // Revert to WordPress-first by swapping this order.
  const STATION_SOURCE_PRIORITY = ['radio-browser', 'wordpress'];
  const FETCH_TIMEOUT_MS = 8000;
  const MAX_STATIONS = 623;
  const FALLBACK_STATIONS = [
    {
      id: 'fallback-yesfm-manila',
      name: '101.1 Yes FM Manila',
      frequency: '101.1 FM',
      city: 'Manila',
      country: 'Philippines',
      genre: 'Pop',
      streamUrl: 'https://azura.yesfm.com.ph/listen/yes_fm_manila/radio.mp3',
      language: '',
      codec: 'MP3',
      bitrate: 128,
      votes: 0
    },
    {
      id: 'fallback-lovefm',
      name: '101.7 Your Love FM',
      frequency: '101.7 FM',
      city: 'NCR',
      country: 'Philippines',
      genre: 'Pop',
      streamUrl: 'https://radio.1017yourlovefm.com/listen/sanibpwersa/radio.mp3',
      language: '',
      codec: 'MP3',
      bitrate: 128,
      votes: 0
    },
    {
      id: 'fallback-lucena',
      name: '100.7 Love Radio Lucena',
      frequency: '100.7 FM',
      city: 'Lucena',
      country: 'Philippines',
      genre: 'Pop',
      streamUrl: 'https://loveradiolucena.radioca.st/stream',
      language: '',
      codec: 'MP3',
      bitrate: 64,
      votes: 0
    }
  ];
  const BLOCKED_HOST_SNIPPETS = ['youtube.com', 'youtu.be', 'facebook.com'];
  const TRUSTED_STREAM_HOSTS = ['eradioportal.com'];
  const DIRECT_AUDIO_HINTS = [
    '.mp3',
    '.aac',
    '.m3u8',
    '.ogg',
    '.opus',
    '.flac',
    '.weba',
    '/stream',
    '/radio.mp3',
    'zeno.fm',
    'radioca.st',
    'shoutca.st'
  ];
  const PLAYLIST_FILE_REGEX = /\.(pls|m3u)(?:[?#]|$)/i;
  const PLAYBACK_START_TIMEOUT_MS = 4500;
  const HLS_MANIFEST_TIMEOUT_MS = 5000;
  const TOTAL_CANDIDATE_WINDOW_MS = 15000;
  const STATION_SNAPSHOT_KEY = 'purepinoy:stations:snapshot:v1';

  let stations = [...FALLBACK_STATIONS];
  let selectedBand = 'all';
  let selectedLocation = 'all';
  let isLoading = false;
  let loadError = '';
  let loadNotice = '';
  const preferredStreamByStation = new Map();
  let playbackLog = '';
  let nowPlaying = null;
  let pendingStationId = '';
  let playingStationId = '';
  let isPlaybackPaused = false;
  let playerError = '';
  let audioPlayerEl;
  let hlsController = null;
  let hlsConstructorPromise = null;
  let playbackStartTimeoutId = null;
  let sourceStations = [...FALLBACK_STATIONS];
  let playableStations = [...FALLBACK_STATIONS];
  let bandFilteredStations = [...FALLBACK_STATIONS];
  let fmCount = 0;
  let amCount = 0;
  let otherCount = 0;
  let stationsNeedingFix = [];
  let menuItems = [];
  let visibleStations = [];
  let activeStation = null;
  let featuredStations = [];
  let hasCachedSnapshot = false;

  onMount(() => {
    const cached = loadStationSnapshot();
    if (cached.length > 0) {
      stations = cached;
      hasCachedSnapshot = true;
      loadNotice = `Loaded ${cached.length} cached station(s). Refreshing live data...`;
    }
    loadStations();
  });

  onDestroy(() => {
    clearPlaybackStartTimeout();
    destroyHlsController();
  });

  function sanitizeText(value) {
    return String(value || '').trim();
  }

  function loadStationSnapshot() {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(STATION_SNAPSHOT_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return dedupeAndCleanNormalizedStations(parsed);
    } catch {
      return [];
    }
  }

  function persistStationSnapshot(stationList) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STATION_SNAPSHOT_KEY, JSON.stringify(stationList));
    } catch {
      // Ignore storage errors and continue with in-memory stations.
    }
  }

  function deriveFrequency(name) {
    const match = sanitizeText(name).match(/(\d{2,3}(?:\.\d)?)\s*(FM|AM)\b/i);
    return match ? `${match[1]} ${match[2].toUpperCase()}` : '';
  }

  function cleanLocation(value) {
    const cleaned = sanitizeText(value).replace(/[|/]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length < 2) return '';
    return cleaned;
  }

  function getLocationCategory(station) {
    const city = sanitizeText(station?.city);
    const country = sanitizeText(station?.country) || 'Philippines';
    return city || country;
  }

  function getStationBand(station) {
    const frequency = sanitizeText(station?.frequency).toUpperCase();
    const name = sanitizeText(station?.name).toUpperCase();
    const sample = `${frequency} ${name}`;
    if (/\bFM\b/.test(sample)) return 'fm';
    if (/\bAM\b/.test(sample)) return 'am';
    return 'other';
  }

  function isBlockedUrl(url) {
    const lowered = sanitizeText(url).toLowerCase();
    return BLOCKED_HOST_SNIPPETS.some((snippet) => lowered.includes(snippet));
  }

  function isLikelyDirectAudioUrl(url) {
    const lowered = sanitizeText(url).toLowerCase();
    if (!/^https?:\/\//i.test(lowered)) return false;
    if (isBlockedUrl(lowered)) return false;
    if (PLAYLIST_FILE_REGEX.test(lowered)) {
      return isSupportedPlaylistUrl(lowered);
    }
    try {
      const parsed = new URL(lowered);
      const hostname = sanitizeText(parsed.hostname).toLowerCase();
      if (TRUSTED_STREAM_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
        return true;
      }
    } catch (error) {
      // Fall through to hint-based detection.
    }
    return DIRECT_AUDIO_HINTS.some((hint) => lowered.includes(hint));
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

  function normalizeRadioBrowserStation(raw) {
    const name = sanitizeText(raw?.name);
    const resolvedUrl = extractUrl(raw?.url_resolved) || extractUrl(raw?.url);
    const country = sanitizeText(raw?.country) || 'Philippines';
    const city = cleanLocation(sanitizeText(raw?.state));
    const genre = sanitizeText(raw?.tags);
    const codec = sanitizeText(raw?.codec);
    const bitrate = Number(raw?.bitrate) || 0;
    const votes = Number(raw?.votes) || 0;
    const lastCheckOkRaw = raw?.lastcheckok;
    const isActive =
      lastCheckOkRaw === true ||
      lastCheckOkRaw === 1 ||
      lastCheckOkRaw === '1' ||
      String(lastCheckOkRaw).toLowerCase() === 'true';

    return {
      id: sanitizeText(raw?.stationuuid || raw?.changeuuid || `${name.toLowerCase()}-${resolvedUrl.toLowerCase()}`),
      name,
      frequency: deriveFrequency(name),
      city,
      country,
      genre,
      streamUrl: resolvedUrl,
      language: sanitizeText(raw?.language || raw?.languagecodes),
      codec: codec.toUpperCase(),
      bitrate,
      votes,
      isActive
    };
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
      return (
        extractUrl(value.url) ||
        extractUrl(value.source_url) ||
        extractUrl(value.rendered) ||
        extractUrl(value.value) ||
        ''
      );
    }
    return '';
  }

  function findAudioUrlInText(text) {
    const source = sanitizeText(text);
    if (!source) return '';
    const match = source.match(/https?:\/\/[^\s"'<>]+/i);
    return match ? sanitizeText(match[0]) : '';
  }

  function dedupeAndCleanNormalizedStations(input) {
    const seenIds = new Set();
    const seenKeys = new Set();
    const out = [];

    for (const station of input) {
      if (!station?.name || !station?.streamUrl) continue;
      if (!/^https?:\/\//i.test(station.streamUrl)) continue;
      if (isBlockedUrl(station.streamUrl)) continue;
      if (PLAYLIST_FILE_REGEX.test(station.streamUrl) && !isSupportedPlaylistUrl(station.streamUrl)) continue;
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

    return out.slice(0, MAX_STATIONS);
  }

  function fetchJsonWithTimeout(url) {
    return Promise.race([
      fetch(url).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Request failed (${response.status}) at ${url}`);
        }
        return response.json();
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${FETCH_TIMEOUT_MS}ms at ${url}`)), FETCH_TIMEOUT_MS)
      )
    ]);
  }

  async function fetchWordPressStations() {
    let lastError = '';
    for (const endpoint of WP_API_URLS) {
      try {
        const json = await fetchJsonWithTimeout(endpoint);
        if (!Array.isArray(json)) {
          lastError = `Unexpected WP response format at ${endpoint}`;
          continue;
        }
        const cleaned = dedupeAndCleanNormalizedStations(json.map((item) => normalizeWpStation(item)));
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

  async function fetchRadioBrowserStations() {
    const attempts = await Promise.all(
      RADIO_BROWSER_ENDPOINTS.map(async (endpoint) => {
        try {
          const json = await fetchJsonWithTimeout(endpoint);
          if (!Array.isArray(json)) {
            return { endpoint, stations: [], error: `Unexpected Radio Browser response format at ${endpoint}` };
          }
          const cleaned = dedupeAndCleanNormalizedStations(json.map((item) => normalizeRadioBrowserStation(item)));
          return { endpoint, stations: cleaned, error: '' };
        } catch (error) {
          return { endpoint, stations: [], error: error?.message || String(error) };
        }
      })
    );

    const best = attempts.reduce(
      (acc, current) => (current.stations.length > acc.stations.length ? current : acc),
      { endpoint: '', stations: [], error: '' }
    );

    if (best.stations.length > 0) {
      return { stations: best.stations, source: best.endpoint };
    }

    const firstError = attempts.find((item) => item.error)?.error || 'Radio Browser returned no usable stations.';
    throw new Error(firstError);
  }

  async function loadStations() {
    isLoading = true;
    loadError = '';
    loadNotice = '';
    playerError = '';
    nowPlaying = null;
    pendingStationId = '';
    playingStationId = '';

    const sourceErrors = [];
    const sourceResults = [];

    try {
      for (const source of STATION_SOURCE_PRIORITY) {
        try {
          const result = source === 'radio-browser' ? await fetchRadioBrowserStations() : await fetchWordPressStations();
          const sourceLabel = source === 'radio-browser' ? 'Radio Browser' : 'WordPress';
          sourceResults.push({ ...result, sourceLabel });
        } catch (error) {
          const msg = sanitizeText(error?.message).slice(0, 140) || 'unknown error';
          sourceErrors.push(`${source}: ${msg}`);
        }
      }

      if (sourceResults.length > 0) {
        sourceResults.sort((a, b) => b.stations.length - a.stations.length);
        const best = sourceResults[0];
        stations = best.stations;
        hasCachedSnapshot = true;
        persistStationSnapshot(best.stations);
        selectedLocation = 'all';
        loadNotice = `Loaded ${best.stations.length} station(s) from ${best.sourceLabel}.`;
        return;
      }

      if (hasCachedSnapshot && stations.length > 0) {
        const combined = sourceErrors.join(' | ').slice(0, 240);
        loadNotice = combined
          ? `Live update failed (${combined}). Showing cached stations.`
          : 'Live update failed. Showing cached stations.';
        return;
      }

      stations = [...FALLBACK_STATIONS];
      selectedLocation = 'all';
      const combined = sourceErrors.join(' | ').slice(0, 240);
      loadNotice = combined
        ? `Live sources unavailable (${combined}). Showing fallback PH stations.`
        : 'Live sources are unavailable. Showing fallback PH stations.';
    } finally {
      isLoading = false;
    }
  }

  function buildLocationMenuItems(fromStations) {
    const counts = new Map();
    for (const station of fromStations) {
      const key = getLocationCategory(station);
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }

  $: sourceStations = stations.length > 0 ? stations : FALLBACK_STATIONS;
  $: {
    const activeStationId = pendingStationId || playingStationId || nowPlaying?.id || '';
    activeStation = sourceStations.find((station) => station.id === activeStationId) || nowPlaying || null;
  }
  $: stationsNeedingFix = sourceStations
    .map((station) => ({
      station,
      issue: getPlaybackError(station?.streamUrl)
    }))
    .filter((item) => !!item.issue);
  $: playableStations = sourceStations.filter((station) => !getPlaybackError(station?.streamUrl));
  $: featuredStations = [...playableStations]
    .sort((a, b) => {
      if ((b.votes || 0) !== (a.votes || 0)) return (b.votes || 0) - (a.votes || 0);
      return a.name.localeCompare(b.name);
    })
    .slice(0, 5);
  $: fmCount = playableStations.filter((station) => getStationBand(station) === 'fm').length;
  $: amCount = playableStations.filter((station) => getStationBand(station) === 'am').length;
  $: otherCount = playableStations.filter((station) => getStationBand(station) === 'other').length;
  $: bandFilteredStations =
    selectedBand === 'all' ? playableStations : playableStations.filter((station) => getStationBand(station) === selectedBand);
  $: menuItems = buildLocationMenuItems(bandFilteredStations);
  $: visibleStations =
    selectedLocation === 'all'
      ? bandFilteredStations
      : bandFilteredStations.filter((station) => getLocationCategory(station) === selectedLocation);
  $: {
    const activeStationId = pendingStationId || playingStationId || nowPlaying?.id || '';
    if (activeStationId && visibleStations.some((station) => station.id === activeStationId)) {
      visibleStations = [
        ...visibleStations.filter((station) => station.id === activeStationId),
        ...visibleStations.filter((station) => station.id !== activeStationId)
      ];
    }
  }
  $: if (selectedLocation !== 'all' && !menuItems.some((item) => item.name === selectedLocation)) {
    selectedLocation = 'all';
  }

  function getPlaybackError(url) {
    const value = sanitizeText(url).toLowerCase();
    if (!/^https?:\/\//i.test(value)) {
      return 'Invalid stream URL.';
    }
    if (isBlockedUrl(value)) {
      return 'This stream host is blocked in the app.';
    }
    if (PLAYLIST_FILE_REGEX.test(value) && !isSupportedPlaylistUrl(value)) {
      return 'Playlist URLs (.pls/.m3u) are not directly playable. Use a direct stream URL.';
    }
    return '';
  }

  function isHlsUrl(url) {
    const value = sanitizeText(url).toLowerCase();
    return /\.m3u8(?:[?#]|$)/i.test(value) || value.includes('playlist.m3u8');
  }

  function destroyHlsController() {
    if (hlsController && typeof hlsController.destroy === 'function') {
      hlsController.destroy();
    }
    hlsController = null;
  }

  function clearPlaybackStartTimeout() {
    if (playbackStartTimeoutId) {
      clearTimeout(playbackStartTimeoutId);
      playbackStartTimeoutId = null;
    }
  }

  function armPlaybackStartTimeout(stationId) {
    clearPlaybackStartTimeout();
    playbackStartTimeoutId = setTimeout(() => {
      if (pendingStationId === stationId && !playingStationId) {
        pendingStationId = '';
        playerError = 'Stream is taking too long to start. Please try Play again.';
      }
    }, 12000);
  }

  async function loadHlsConstructor() {
    if (typeof window === 'undefined') return null;
    if (window.Hls) return window.Hls;
    if (hlsConstructorPromise) return hlsConstructorPromise;

    hlsConstructorPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.18/dist/hls.min.js';
      script.async = true;
      script.onload = () => {
        if (window.Hls) {
          resolve(window.Hls);
        } else {
          reject(new Error('HLS runtime loaded but constructor is unavailable.'));
        }
      };
      script.onerror = () => reject(new Error('Unable to load HLS runtime.'));
      document.head.appendChild(script);
    });

    return hlsConstructorPromise;
  }

  async function prepareHlsPlayback(url) {
    if (!audioPlayerEl) throw new Error('Audio player is unavailable.');
    destroyHlsController();

    if (audioPlayerEl.canPlayType('application/vnd.apple.mpegurl')) {
      audioPlayerEl.src = url;
      audioPlayerEl.load();
      return;
    }

    const HlsCtor = await loadHlsConstructor();
    if (!HlsCtor || !HlsCtor.isSupported()) {
      throw new Error('HLS stream is not supported on this device.');
    }

    const hls = new HlsCtor({
      enableWorker: true,
      lowLatencyMode: true
    });
    hlsController = hls;

    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timed out while loading HLS manifest.'));
      }, HLS_MANIFEST_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeoutId);
        hls.off(HlsCtor.Events.MANIFEST_PARSED, onParsed);
        hls.off(HlsCtor.Events.ERROR, onError);
      };

      const onParsed = () => {
        cleanup();
        resolve();
      };

      const onError = (_event, data) => {
        if (data?.fatal) {
          cleanup();
          reject(new Error(data?.details || 'Fatal HLS playback error.'));
        }
      };

      hls.on(HlsCtor.Events.MANIFEST_PARSED, onParsed);
      hls.on(HlsCtor.Events.ERROR, onError);
      hls.attachMedia(audioPlayerEl);
      hls.loadSource(url);
    });
  }

  async function tryPlayUrl(station, url) {
    nowPlaying = { ...station, streamUrl: url };
    await tick();
    if (!audioPlayerEl) throw new Error('Audio player is unavailable.');
    audioPlayerEl.pause();
    audioPlayerEl.muted = false;
    audioPlayerEl.volume = 1;
    playerError = '';
    if (isHlsUrl(url)) {
      await prepareHlsPlayback(url);
    } else {
      destroyHlsController();
      audioPlayerEl.src = url;
      audioPlayerEl.load();
    }
    await Promise.race([
      audioPlayerEl.play(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timed out while starting stream playback.')), PLAYBACK_START_TIMEOUT_MS);
      })
    ]);
    clearPlaybackStartTimeout();
    pendingStationId = '';
    playingStationId = station?.id || '';
    isPlaybackPaused = false;
  }

  function getPrioritizedCandidates(station) {
    const candidates = buildPlaybackCandidates(station.streamUrl);
    const extraCandidates = Array.isArray(station?.extraStreamUrls)
      ? station.extraStreamUrls.map((value) => sanitizeText(value)).filter((value) => /^https?:\/\//i.test(value))
      : [];
    const mergedCandidates = [...new Set([...extraCandidates, ...candidates])];
    const preferred = preferredStreamByStation.get(station?.id);
    if (!preferred) return mergedCandidates;
    return [preferred, ...mergedCandidates.filter((candidate) => candidate !== preferred)];
  }

  async function playStation(station) {
    const playbackError = getPlaybackError(station?.streamUrl);
    if (playbackError) {
      playerError = playbackError;
      nowPlaying = null;
      pendingStationId = '';
      playingStationId = '';
      return;
    }

    nowPlaying = station;
    pendingStationId = station.id;
    playingStationId = '';
    isPlaybackPaused = false;
    playerError = '';
    armPlaybackStartTimeout(station.id);
    await tick();

    if (audioPlayerEl) {
      const candidates = getPrioritizedCandidates(station);
      let played = false;
      const deadline = Date.now() + TOTAL_CANDIDATE_WINDOW_MS;
      for (let index = 0; index < candidates.length; index += 1) {
        if (Date.now() >= deadline) {
          console.warn(`[playback] ${station.name} aborted candidate loop after timeout window.`);
          break;
        }
        const url = candidates[index];
        try {
          await tryPlayUrl(station, url);
          preferredStreamByStation.set(station.id, url);
          playbackLog = `Playing via candidate ${index + 1}/${candidates.length}: ${url}`;
          console.info(`[playback] ${station.name} succeeded with candidate ${index + 1}/${candidates.length}: ${url}`);
          played = true;
          break;
        } catch (error) {
          console.warn(
            `[playback] ${station.name} failed candidate ${index + 1}/${candidates.length}: ${url}`,
            error
          );
        }
      }
      if (!played) {
        clearPlaybackStartTimeout();
        pendingStationId = '';
        playingStationId = '';
        isPlaybackPaused = false;
        playbackLog = `Tried ${candidates.length} candidate URL(s) with no successful playback.`;
        playerError = 'Playback failed to start. This stream may be offline or blocked for embedded players.';
      }
    }
  }

  async function toggleStationPlayback(station) {
    if (pendingStationId === station?.id) return;

    if (playingStationId === station?.id && audioPlayerEl) {
      if (audioPlayerEl.paused) {
        pendingStationId = station.id;
        try {
          await audioPlayerEl.play();
        } catch {
          await playStation(station);
        } finally {
          if (pendingStationId === station.id) pendingStationId = '';
        }
      } else {
        audioPlayerEl.pause();
      }
      return;
    }

    await playStation(station);
  }

  function handleAudioError() {
    clearPlaybackStartTimeout();
    pendingStationId = '';
    playingStationId = '';
    isPlaybackPaused = false;
    playbackLog = '';
    playerError = 'This stream is not playable on this device. Try another station.';
  }

  function handleAudioLoaded() {
    if (pendingStationId) {
      clearPlaybackStartTimeout();
      pendingStationId = '';
    }
    playerError = '';
  }

  function handleAudioPlaying() {
    clearPlaybackStartTimeout();
    pendingStationId = '';
    playingStationId = nowPlaying?.id || '';
    isPlaybackPaused = false;
    playerError = '';
  }

  function handleAudioPause() {
    if (playingStationId) {
      isPlaybackPaused = true;
    }
  }
</script>

<main class="screen">
  <header>
    <h1>Pure Pinoy Radio Stations</h1>
    <p>No ADS</p>
    {#if isLoading}
      <p class="muted">Loading stations...</p>
    {:else if loadNotice}
      <p class="muted">{loadNotice}</p>
    {/if}
  </header>

  {#if activeStation}
    <section class="card">
      <h2>Now Playing</h2>
      <div class="top">
        <strong>{activeStation.name}</strong>
        <span>{activeStation.frequency}</span>
      </div>
      <div class="meta">{activeStation.city} • {activeStation.country} • {activeStation.genre}</div>
      {#if activeStation.streamUrl}
        <button
          type="button"
          class="play-btn"
          on:click={() => toggleStationPlayback(activeStation)}
          aria-label={`${playingStationId === activeStation.id && !isPlaybackPaused ? 'Pause' : playingStationId === activeStation.id && isPlaybackPaused ? 'Resume' : 'Play'} ${activeStation.name}`}
        >
          {pendingStationId === activeStation.id
            ? 'Starting...'
            : playingStationId === activeStation.id
              ? isPlaybackPaused
                ? 'Resume'
                : 'Pause'
              : 'Play'}
        </button>
      {/if}
    </section>
  {/if}

  {#if featuredStations.length > 0}
    <section class="card">
      <h2>Featured Stations</h2>
      <ul class="list">
        {#each featuredStations as station}
          <li>
            <div class="top">
              <strong>{station.name}</strong>
              <span>{station.frequency}</span>
            </div>
            <div class="meta">{station.city} • {station.country} • {station.genre}</div>
            <button
              type="button"
              class="play-btn"
              on:click={() => toggleStationPlayback(station)}
              aria-label={`${playingStationId === station.id && !isPlaybackPaused ? 'Pause' : playingStationId === station.id && isPlaybackPaused ? 'Resume' : 'Play'} ${station.name}`}
            >
              {pendingStationId === station.id ? 'Starting...' : playingStationId === station.id ? (isPlaybackPaused ? 'Resume' : 'Pause') : 'Play'}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}


  <section class="content-layout">
    <aside class="card side-menu">
      <h2>Band</h2>
      <ul class="menu-links">
        <li>
          <button
            type="button"
            class:selected={selectedBand === 'all'}
            on:click={() => {
              selectedBand = 'all';
              selectedLocation = 'all';
            }}
          >
            All ({playableStations.length})
          </button>
        </li>
        <li>
          <button
            type="button"
            class:selected={selectedBand === 'fm'}
            on:click={() => {
              selectedBand = 'fm';
              selectedLocation = 'all';
            }}
          >
            FM ({fmCount})
          </button>
        </li>
        <li>
          <button
            type="button"
            class:selected={selectedBand === 'am'}
            on:click={() => {
              selectedBand = 'am';
              selectedLocation = 'all';
            }}
          >
            AM ({amCount})
          </button>
        </li>
        <li>
          <button
            type="button"
            class:selected={selectedBand === 'other'}
            on:click={() => {
              selectedBand = 'other';
              selectedLocation = 'all';
            }}
          >
            Other ({otherCount})
          </button>
        </li>
      </ul>

      <h2>Location Categories</h2>
      <ul class="menu-links">
        <li>
          <button
            type="button"
            class:selected={selectedLocation === 'all'}
            on:click={() => (selectedLocation = 'all')}
          >
            All ({playableStations.length})
          </button>
        </li>
        {#each menuItems as location}
          <li>
            <button
              type="button"
              class:selected={selectedLocation === location.name}
              on:click={() => (selectedLocation = location.name)}
            >
              {location.name} ({location.count})
            </button>
          </li>
        {/each}
      </ul>
    </aside>

    <section class="card">
      <h2>Stations ({visibleStations.length})</h2>

      {#if visibleStations.length === 0}
        <p class="muted">No playable stations in this category.</p>
      {:else}
        <ul class="list">
          {#each visibleStations as station}
            <li>
              <div class="top">
                <strong>{station.name}</strong>
                <span>{station.frequency}</span>
              </div>
              <div class="meta">{station.city} • {station.country} • {station.genre}</div>
              {#if station.streamUrl}
                <button
                  type="button"
                  class="play-btn"
                  on:click={() => toggleStationPlayback(station)}
                  aria-label={`${playingStationId === station.id && !isPlaybackPaused ? 'Pause' : playingStationId === station.id && isPlaybackPaused ? 'Resume' : 'Play'} ${station.name}`}
                >
                  {pendingStationId === station.id ? 'Starting...' : playingStationId === station.id ? (isPlaybackPaused ? 'Resume' : 'Pause') : 'Play'}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if playerError}
        <p class="muted">{playerError}</p>
      {/if}
    </section>
  </section>

  {#if stationsNeedingFix.length > 0}
    <section class="card">
      <h2>Needs URL Fix ({stationsNeedingFix.length})</h2>
      <ul class="warn-list">
        {#each stationsNeedingFix as item}
          <li>
            <strong>{item.station.name}</strong>
            <div class="meta">{item.issue}</div>
            <code>{item.station.streamUrl}</code>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <audio
    bind:this={audioPlayerEl}
    autoplay
    playsinline
    src={nowPlaying?.streamUrl || ''}
    style="display: none;"
    on:error={handleAudioError}
    on:loadeddata={handleAudioLoaded}
    on:canplay={handleAudioLoaded}
    on:playing={handleAudioPlaying}
    on:pause={handleAudioPause}
  >
    Your browser does not support audio playback.
  </audio>
</main>
