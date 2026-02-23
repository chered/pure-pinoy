<script>
  import { onMount, tick } from 'svelte';

  const DEV_WP_API_BASE = '/wp-api';
  const REMOTE_WP_API_BASE = 'https://radio.fourwebminds.com/wp-json';
  const WP_API_URLS = [
    `${DEV_WP_API_BASE}/wp/v2/station?per_page=100`,
    `${REMOTE_WP_API_BASE}/wp/v2/station?per_page=100`
  ];
  const FETCH_TIMEOUT_MS = 8000;
  const MAX_STATIONS = 700;
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

  let stations = [...FALLBACK_STATIONS];
  let selectedLocation = 'all';
  let isLoading = false;
  let loadError = '';
  let loadNotice = '';
  let nowPlaying = null;
  let pendingStationId = '';
  let playingStationId = '';
  let playerError = '';
  let audioPlayerEl;
  let sourceStations = [...FALLBACK_STATIONS];
  let playableStations = [...FALLBACK_STATIONS];
  let stationsNeedingFix = [];
  let menuItems = [];
  let visibleStations = [];

  onMount(() => {
    loadStations();
  });

  function sanitizeText(value) {
    return String(value || '').trim();
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

  function isBlockedUrl(url) {
    const lowered = sanitizeText(url).toLowerCase();
    return BLOCKED_HOST_SNIPPETS.some((snippet) => lowered.includes(snippet));
  }

  function isLikelyDirectAudioUrl(url) {
    const lowered = sanitizeText(url).toLowerCase();
    if (!/^https?:\/\//i.test(lowered)) return false;
    if (isBlockedUrl(lowered)) return false;
    if (PLAYLIST_FILE_REGEX.test(lowered)) return false;
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
      if (station?.isActive === false) continue;
      if (!station?.name || !station?.streamUrl) continue;
      if (!/^https?:\/\//i.test(station.streamUrl)) continue;
      if (isBlockedUrl(station.streamUrl)) continue;
      if (PLAYLIST_FILE_REGEX.test(station.streamUrl)) continue;
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

  async function loadStations() {
    isLoading = true;
    loadError = '';
    loadNotice = '';
    playerError = '';
    nowPlaying = null;
    pendingStationId = '';
    playingStationId = '';

    try {
      const wpResult = await fetchWordPressStations();
      stations = wpResult.stations;
      selectedLocation = 'all';
      loadNotice = `Loaded ${wpResult.stations.length} station(s) from WordPress.`;
    } catch (error) {
      stations = [...FALLBACK_STATIONS];
      selectedLocation = 'all';
      const msg = sanitizeText(error?.message).slice(0, 220);
      loadNotice = msg
        ? `WordPress fetch issue (${msg}). Showing fallback PH stations.`
        : 'WordPress API is unavailable. Showing fallback PH stations.';
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
  $: stationsNeedingFix = sourceStations
    .map((station) => ({
      station,
      issue: getPlaybackError(station?.streamUrl)
    }))
    .filter((item) => !!item.issue);
  $: playableStations = sourceStations.filter((station) => !getPlaybackError(station?.streamUrl));
  $: menuItems = buildLocationMenuItems(playableStations);
  $: visibleStations =
    selectedLocation === 'all'
      ? playableStations
      : playableStations.filter((station) => getLocationCategory(station) === selectedLocation);
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
    if (PLAYLIST_FILE_REGEX.test(value)) {
      return 'Playlist URLs (.pls/.m3u) are not directly playable. Use a direct stream URL.';
    }
    if (!isLikelyDirectAudioUrl(value)) {
      return 'This station does not provide a direct embeddable audio stream.';
    }
    return '';
  }

  function buildStreamCandidates(url) {
    const base = sanitizeText(url);
    const candidates = [base];

    if (!base) return candidates;
    if (!base.endsWith('/')) candidates.push(`${base}/`);
    if (!/\/stream(?:[/?#]|$)/i.test(base)) candidates.push(`${base.replace(/\/+$/, '')}/stream`);
    if (!/\.mp3(?:[?#]|$)/i.test(base)) candidates.push(`${base.replace(/\/+$/, '')}.mp3`);

    return [...new Set(candidates)];
  }

  async function tryPlayUrl(station, url) {
    nowPlaying = { ...station, streamUrl: url };
    await tick();
    if (!audioPlayerEl) throw new Error('Audio player is unavailable.');
    audioPlayerEl.pause();
    audioPlayerEl.muted = false;
    audioPlayerEl.volume = 1;
    audioPlayerEl.load();
    await audioPlayerEl.play();
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
    playerError = '';
    await tick();

    if (audioPlayerEl) {
      const candidates = buildStreamCandidates(station.streamUrl);
      let played = false;
      for (const url of candidates) {
        try {
          await tryPlayUrl(station, url);
          played = true;
          break;
        } catch (error) {
          // Try next candidate URL shape.
        }
      }
      if (!played) {
        pendingStationId = '';
        playingStationId = '';
        playerError = 'Playback failed for this stream. Try tapping Play again or choose another station.';
      }
    }
  }

  function handleAudioError() {
    pendingStationId = '';
    playingStationId = '';
    playerError = 'This stream is not playable on this device. Try another station.';
  }

  function handleAudioLoaded() {
    playerError = '';
  }

  function handleAudioPlaying() {
    pendingStationId = '';
    playingStationId = nowPlaying?.id || '';
    playerError = '';
  }
</script>

<main class="screen">
  <header>
    <h1>Pure Pinoy Radio Stations</h1>
    <p>No ADS</p>
  </header>


  <section class="content-layout">
    <aside class="card side-menu">
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
                  on:click={() => playStation(station)}
                  aria-label={`Play ${station.name}`}
                >
                  {playingStationId === station.id ? 'Playing' : pendingStationId === station.id ? 'Starting...' : 'Play'}
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
  >
    Your browser does not support audio playback.
  </audio>
</main>
