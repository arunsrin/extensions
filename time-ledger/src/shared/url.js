const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'si',
  'ref_src',
  'ref_url',
  '_hsenc',
  '_hsmi',
  'vero_id',
  'mkt_tok',
]);

/**
 * Normalize a domain string (lowercase, strip leading www. and trailing dots).
 */
export function normalizeDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') return '';
  return hostname.trim().toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
}

/**
 * Check if a domain matches any entry in ignoredDomains (exact or subdomain match).
 */
export function isDomainIgnored(domain, ignoredDomains = []) {
  if (!domain || !Array.isArray(ignoredDomains) || ignoredDomains.length === 0) {
    return false;
  }
  const normalizedTarget = normalizeDomain(domain);
  return ignoredDomains.some((rawEntry) => {
    const entry = normalizeDomain(rawEntry);
    if (!entry) return false;
    return normalizedTarget === entry || normalizedTarget.endsWith(`.${entry}`);
  });
}

/**
 * Parse and normalize a browser tab URL for tracking.
 * Returns null for non-trackable internal URLs (chrome://, about:, etc.) or ignored domains.
 */
export function parseTrackableUrl(rawUrl, options = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return null;
  }

  const domain =
    parsed.protocol === 'file:' ? 'local-file' : normalizeDomain(parsed.hostname);

  if (!domain) return null;

  if (isDomainIgnored(domain, options.ignoredDomains)) {
    return null;
  }

  if (options.stripHash !== false) {
    parsed.hash = '';
  }

  if (options.stripTrackingParams !== false && parsed.search) {
    const params = new URLSearchParams(parsed.search);
    let changed = false;
    for (const key of Array.from(params.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        params.delete(key);
        changed = true;
      }
    }
    if (changed) {
      const nextSearch = params.toString();
      parsed.search = nextSearch ? `?${nextSearch}` : '';
    }
  }

  return {
    url: parsed.toString(),
    domain,
    protocol: parsed.protocol,
  };
}

/**
 * Deterministic pleasant hue for a domain monogram badge (zero external requests).
 */
export function domainColor(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i += 1) {
    hash = (hash * 31 + domain.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 68%, 46%)`;
}

export function domainInitial(domain) {
  if (!domain) return '?';
  const clean = domain.replace(/^www\./, '');
  return (clean[0] || '?').toUpperCase();
}
