/**
 * Extensible Page Row Action Registry.
 *
 * Future integrations (e.g., "Add to Todoist", "Blog about this", "Send to Readwise")
 * can be added as declarative entries here without touching the table rendering logic.
 *
 * Each action receives `{ page, helpers }`:
 * - `page`: { url, domain, title, totalMs, visits, firstVisitedAt, lastVisitedAt }
 * - `helpers`: { copyText, formatDuration, showToast }
 */
export const PAGE_ACTIONS = [
  {
    id: 'copy-markdown',
    label: 'Copy MD',
    title: 'Copy as Markdown link [Title](url)',
    async run({ page, helpers }) {
      const safeTitle = (page.title || page.url).replace(/\[|\]/g, '');
      await helpers.copyText(`[${safeTitle}](${page.url})`);
      helpers.showToast('Copied Markdown link');
    },
  },
  {
    id: 'copy-url',
    label: 'Copy URL',
    title: 'Copy clean URL',
    async run({ page, helpers }) {
      await helpers.copyText(page.url);
      helpers.showToast('Copied URL');
    },
  },
  {
    id: 'open-page',
    label: 'Open ↗',
    title: 'Open page in a new tab',
    async run({ page }) {
      chrome.tabs.create({ url: page.url });
    },
  },
];
