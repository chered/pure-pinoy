function parseTuneinPls(url) {
  const parsed = safeParseUrl(url);
  if (!parsed) return null;
  const pathname = (parsed.pathname || '').trim();
  const match = pathname.match(/^\/tunein\/([^/?#]+)\.pls$/i);
  if (!match) return null;

  const host = (parsed.hostname || '').trim().toLowerCase();
  const port = (parsed.port || '').trim();
  const rawStreamId = match[1] || '';
  const normalizedStreamId = rawStreamId.replace(/-stream$/i, '');
  if (!host || !rawStreamId) return null;

  return { host, port, rawStreamId, normalizedStreamId };
}

function safeParseUrl(url) {
  try {
    return new URL(String(url || '').trim());
  } catch {
    return null;
  }
}

function parseRadiocaPanelUrl(url) {
  const parsed = safeParseUrl(url);
  if (!parsed) return null;
  const host = (parsed.hostname || '').toLowerCase();
  if (!host.endsWith('radioca.st')) return null;
  const pathname = (parsed.pathname || '').toLowerCase();
  if (!pathname.endsWith('/index.html') && pathname !== '/index.html') return null;

  const sid = (parsed.searchParams.get('sid') || '').trim();
  const subdomain = host.split('.')[0] || '';
  return { host, sid, subdomain };
}

export function isSupportedPlaylistUrl(url) {
  return !!parseTuneinPls(url);
}

export function buildStreamCandidates(url) {
  const base = String(url || '').trim();
  const candidates = [];

  if (!base) return [base];
  const tunein = parseTuneinPls(base);
  if (tunein) {
    const panelPort = tunein.port || '2199';
    const hostVariants = tunein.host.startsWith('www.') ? [tunein.host, tunein.host.slice(4)] : [tunein.host];
    const origins = [
      ...hostVariants.map((h) => `https://${h}`),
      ...hostVariants.map((h) => `http://${h}`),
      ...hostVariants.map((h) => `https://${h}:${panelPort}`),
      ...hostVariants.map((h) => `http://${h}:${panelPort}`)
    ];

    // Different panels expose proxy/stream paths with either raw or normalized ids.
    for (const origin of origins) {
      candidates.push(`${origin}/proxy/${tunein.rawStreamId}?mp=/1`);
      candidates.push(`${origin}/proxy/${tunein.normalizedStreamId}?mp=/1`);
      candidates.push(`${origin}/stream/${tunein.rawStreamId}`);
      candidates.push(`${origin}/stream/${tunein.normalizedStreamId}`);
      candidates.push(`${origin}/stream`);
      candidates.push(`${origin}/stream/`);
      candidates.push(`${origin}/stream?type=http&nocache=1`);
      candidates.push(`${origin}/;`);
      candidates.push(`${origin}/;stream.mp3`);
      candidates.push(`${origin}/listen.mp3`);
      candidates.push(`${origin}/radio.mp3`);
    }
    // Keep the original playlist URL as a last-resort fallback.
    candidates.push(base);
  } else {
    candidates.push(base);
  }

  if (!tunein) {
    const radiocaPanel = parseRadiocaPanelUrl(base);
    if (radiocaPanel) {
      const httpsOrigin = `https://${radiocaPanel.host}`;
      const httpOrigin = `http://${radiocaPanel.host}`;

      candidates.push(`${httpsOrigin}/stream`);
      candidates.push(`${httpOrigin}/stream`);
      candidates.push(`${httpsOrigin}/stream/`);
      candidates.push(`${httpOrigin}/stream/`);
      candidates.push(`${httpsOrigin}/stream?type=http&nocache=1`);
      candidates.push(`${httpOrigin}/stream?type=http&nocache=1`);
      candidates.push(`${httpsOrigin}/;stream.mp3`);
      candidates.push(`${httpOrigin}/;stream.mp3`);
      candidates.push(`${httpsOrigin}/listen.mp3`);
      candidates.push(`${httpOrigin}/listen.mp3`);
      candidates.push(`${httpsOrigin}/radio.mp3`);
      candidates.push(`${httpOrigin}/radio.mp3`);

      if (radiocaPanel.subdomain) {
        candidates.push(`${httpsOrigin}/proxy/${radiocaPanel.subdomain}?mp=/1`);
        candidates.push(`${httpOrigin}/proxy/${radiocaPanel.subdomain}?mp=/1`);
      }
      if (radiocaPanel.sid) {
        candidates.push(`${httpsOrigin}/stream/${radiocaPanel.sid}`);
        candidates.push(`${httpOrigin}/stream/${radiocaPanel.sid}`);
      }
    } else {
      const parsed = safeParseUrl(base);
      if (parsed) {
        const origin = parsed.origin;
        const pathname = parsed.pathname || '/';
        const trimmedPath = pathname.replace(/\/+$/, '') || '/';
        candidates.push(`${origin}${trimmedPath}/`);
        if (!/\/stream$/i.test(trimmedPath)) {
          candidates.push(`${origin}${trimmedPath}/stream`);
        }
        if (!/\.mp3$/i.test(trimmedPath)) {
          candidates.push(`${origin}${trimmedPath}.mp3`);
        }
      } else {
        if (!base.endsWith('/')) candidates.push(`${base}/`);
        if (!/\/stream(?:[/?#]|$)/i.test(base)) candidates.push(`${base.replace(/\/+$/, '')}/stream`);
        if (!/\.mp3(?:[?#]|$)/i.test(base)) candidates.push(`${base.replace(/\/+$/, '')}.mp3`);
      }
    }
  }

  return [...new Set(candidates)];
}
