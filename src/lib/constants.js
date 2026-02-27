export const DEV_WP_API_BASE = '/wp-api';
export const REMOTE_WP_API_BASE = 'https://radio.fourwebminds.com/wp-json';

export const WP_API_URLS = [
  `${DEV_WP_API_BASE}/wp/v2/station?per_page=100`,
  `${REMOTE_WP_API_BASE}/wp/v2/station?per_page=100`
];

export const FETCH_TIMEOUT_MS = 8000;
export const MAX_STATIONS = 700;

export const BLOCKED_HOST_SNIPPETS = ['youtube.com', 'youtu.be', 'facebook.com'];
export const TRUSTED_STREAM_HOSTS = ['eradioportal.com', 'fastcast4u.com', 'theanchor.app', 'listen2myradio.com', 'streamtheworld.com'];

export const DIRECT_AUDIO_HINTS = [
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

export const PLAYLIST_FILE_REGEX = /\.(pls|m3u)(?:[?#]|$)/i;
