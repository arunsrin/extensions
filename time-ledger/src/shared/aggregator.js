import { getLocalDateKey, shiftDateKey } from './time.js';

/**
 * Compute inclusive [startDate, endDate] YYYY-MM-DD bounds for named presets.
 */
export function resolveDateRange(preset, nowMs = Date.now(), customStart = null, customEnd = null) {
  const today = getLocalDateKey(nowMs);
  switch (preset) {
    case 'today':
      return { startDate: today, endDate: today };
    case 'yesterday': {
      const y = shiftDateKey(today, -1);
      return { startDate: y, endDate: y };
    }
    case '7d':
      return { startDate: shiftDateKey(today, -6), endDate: today };
    case '30d':
      return { startDate: shiftDateKey(today, -29), endDate: today };
    case 'custom':
      return {
        startDate: customStart || today,
        endDate: customEnd || today,
      };
    case 'all':
    default:
      return { startDate: null, endDate: null };
  }
}

/**
 * Aggregate daily buckets into domain summaries, page/article summaries, and daily series.
 */
export function aggregateBuckets(
  buckets,
  {
    startDate = null,
    endDate = null,
    domainFilter = '',
    searchQuery = '',
    minPageMs = 0,
  } = {}
) {
  const normalizedDomainFilter = domainFilter.trim().toLowerCase();
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredBuckets = (buckets || []).filter((b) => {
    if (!b || !b.date) return false;
    if (startDate && b.date < startDate) return false;
    if (endDate && b.date > endDate) return false;
    return true;
  });

  const domainMap = new Map();
  const pageMap = new Map();
  const dailySeries = [];
  let totalMs = 0;

  for (const bucket of filteredBuckets) {
    let dayTotalMs = 0;
    const dayDomains = Object.values(bucket.domains || {});
    const dayPages = Object.values(bucket.pages || {});

    // Accumulate pages first so domain.pageCount reflects unique pages in range
    const pagesPerDomainInDay = new Map();
    for (const page of dayPages) {
      if (!page || !page.url) continue;
      if (normalizedDomainFilter && page.domain !== normalizedDomainFilter) continue;

      const existing = pageMap.get(page.url);
      if (!existing) {
        pageMap.set(page.url, {
          url: page.url,
          domain: page.domain,
          title: page.title || page.url,
          totalMs: page.totalMs || 0,
          visits: page.visits || 0,
          firstVisitedAt: page.firstVisitedAt || page.lastVisitedAt || 0,
          lastVisitedAt: page.lastVisitedAt || 0,
        });
      } else {
        existing.totalMs += page.totalMs || 0;
        existing.visits += page.visits || 0;
        if (page.title && (!existing.title || page.lastVisitedAt >= existing.lastVisitedAt)) {
          existing.title = page.title;
        }
        if (page.firstVisitedAt && (!existing.firstVisitedAt || page.firstVisitedAt < existing.firstVisitedAt)) {
          existing.firstVisitedAt = page.firstVisitedAt;
        }
        if ((page.lastVisitedAt || 0) > existing.lastVisitedAt) {
          existing.lastVisitedAt = page.lastVisitedAt || 0;
        }
      }

      if (!pagesPerDomainInDay.has(page.domain)) {
        pagesPerDomainInDay.set(page.domain, new Set());
      }
      pagesPerDomainInDay.get(page.domain).add(page.url);
    }

    for (const dom of dayDomains) {
      if (!dom || !dom.domain) continue;
      if (normalizedDomainFilter && dom.domain !== normalizedDomainFilter) continue;

      dayTotalMs += dom.totalMs || 0;
      const existing = domainMap.get(dom.domain);
      if (!existing) {
        domainMap.set(dom.domain, {
          domain: dom.domain,
          totalMs: dom.totalMs || 0,
          visits: dom.visits || 0,
          lastVisitedAt: dom.lastVisitedAt || 0,
          activeDays: 1,
          pageUrls: new Set(pagesPerDomainInDay.get(dom.domain) || []),
        });
      } else {
        existing.totalMs += dom.totalMs || 0;
        existing.visits += dom.visits || 0;
        existing.activeDays += 1;
        if ((dom.lastVisitedAt || 0) > existing.lastVisitedAt) {
          existing.lastVisitedAt = dom.lastVisitedAt || 0;
        }
        for (const u of pagesPerDomainInDay.get(dom.domain) || []) {
          existing.pageUrls.add(u);
        }
      }
    }

    totalMs += dayTotalMs;

    // Determine top domain for this day
    let topDomain = null;
    for (const dom of dayDomains) {
      if (normalizedDomainFilter && dom.domain !== normalizedDomainFilter) continue;
      if (!topDomain || (dom.totalMs || 0) > (topDomain.totalMs || 0)) {
        topDomain = dom;
      }
    }

    dailySeries.push({
      date: bucket.date,
      totalMs: dayTotalMs,
      domainCount: dayDomains.length,
      pageCount: dayPages.length,
      topDomain: topDomain ? topDomain.domain : null,
      topDomainMs: topDomain ? topDomain.totalMs : 0,
    });
  }

  let domains = Array.from(domainMap.values()).map((d) => ({
    domain: d.domain,
    totalMs: d.totalMs,
    visits: d.visits,
    lastVisitedAt: d.lastVisitedAt,
    activeDays: d.activeDays,
    pageCount: d.pageUrls.size,
    sharePct: totalMs > 0 ? (d.totalMs / totalMs) * 100 : 0,
  }));

  if (normalizedQuery) {
    domains = domains.filter((d) => d.domain.toLowerCase().includes(normalizedQuery));
  }
  domains.sort((a, b) => b.totalMs - a.totalMs);

  let pages = Array.from(pageMap.values()).map((p) => ({
    ...p,
    sharePct: totalMs > 0 ? (p.totalMs / totalMs) * 100 : 0,
  }));

  if (minPageMs > 0) {
    pages = pages.filter((p) => p.totalMs >= minPageMs);
  }
  if (normalizedQuery) {
    pages = pages.filter(
      (p) =>
        p.title.toLowerCase().includes(normalizedQuery) ||
        p.url.toLowerCase().includes(normalizedQuery) ||
        p.domain.toLowerCase().includes(normalizedQuery)
    );
  }
  pages.sort((a, b) => b.totalMs - a.totalMs);

  const activeDaysCount = dailySeries.filter((d) => d.totalMs > 0).length;

  return {
    totalMs,
    activeDaysCount,
    avgPerDayMs: activeDaysCount > 0 ? Math.round(totalMs / activeDaysCount) : 0,
    uniqueDomainsCount: domains.length,
    uniquePagesCount: pages.length,
    dailySeries,
    domains,
    pages,
  };
}

/**
 * Fill missing calendar days in a continuous date range (useful for 7d / 30d bar charts).
 */
export function fillDailySeries(dailySeries, startDate, endDate) {
  if (!startDate || !endDate || startDate > endDate) {
    return dailySeries;
  }
  const byDate = new Map((dailySeries || []).map((d) => [d.date, d]));
  const filled = [];
  let cursor = startDate;
  let guard = 0;

  while (cursor <= endDate && guard < 400) {
    filled.push(
      byDate.get(cursor) || {
        date: cursor,
        totalMs: 0,
        domainCount: 0,
        pageCount: 0,
        topDomain: null,
        topDomainMs: 0,
      }
    );
    cursor = shiftDateKey(cursor, 1);
    guard += 1;
  }
  return filled;
}

function escapeCsvCell(value) {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert aggregated pages or domains into RFC-4180 CSV text.
 */
export function toCsv(rows, mode = 'pages') {
  if (mode === 'domains') {
    const header = ['Domain', 'Total Seconds', 'Formatted Duration', 'Share %', 'Visits', 'Unique Pages', 'Active Days', 'Last Visited ISO'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.domain,
          Math.round((r.totalMs || 0) / 1000),
          formatCsvDuration(r.totalMs),
          (r.sharePct || 0).toFixed(2),
          r.visits || 0,
          r.pageCount || 0,
          r.activeDays || 0,
          r.lastVisitedAt ? new Date(r.lastVisitedAt).toISOString() : '',
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
    return lines.join('\r\n');
  }

  const header = ['Title', 'URL', 'Domain', 'Total Seconds', 'Formatted Duration', 'Share %', 'Visits', 'Last Visited ISO'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.title || '',
        r.url || '',
        r.domain || '',
        Math.round((r.totalMs || 0) / 1000),
        formatCsvDuration(r.totalMs),
        (r.sharePct || 0).toFixed(2),
        r.visits || 0,
        r.lastVisitedAt ? new Date(r.lastVisitedAt).toISOString() : '',
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return lines.join('\r\n');
}

function formatCsvDuration(ms) {
  const totalSec = Math.round((ms || 0) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
