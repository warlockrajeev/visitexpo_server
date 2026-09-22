/**
 * @file directoryEventsHelper.js
 * @description Helper to load and cache live WordPress directory events for instant duplicate checking across the platform.
 */

let wpDirectoryEventsCache = {
  docs: [],
  lastFetched: 0,
  ttl: 10 * 60 * 1000 // 10 minutes cache
};

export const normalizeTitle = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');

export async function fetchLiveWpDirectoryEvents() {
  const now = Date.now();
  if (wpDirectoryEventsCache.docs.length > 0 && (now - wpDirectoryEventsCache.lastFetched < wpDirectoryEventsCache.ttl)) {
    return wpDirectoryEventsCache.docs;
  }

  const wpUrl = process.env.WORDPRESS_URL || 'https://visitexpo.in';
  const wpKey = process.env.WORDPRESS_API_KEY || 'visitexpo_custom_secret_key_12345';

  try {
    const res = await fetch(`${wpUrl}/wp-json/visitexpo/v1/inspect-event-meta`, {
      headers: { 'X-VisitExpo-Key': wpKey },
      signal: AbortSignal.timeout(12000)
    });
    if (res.ok) {
      const data = await res.json();
      const rawDocs = data.data?.docs || [];
      const docs = rawDocs.map((d, idx) => {
        const m = d.meta || {};
        const startTs = m.ovaem_date_start_time?.[0];
        const endTs = m.ovaem_date_end_time?.[0];
        const venue = m.ovaem_address_event?.[0] || m.ovaem_venue?.[0] || m.ovaem_address?.[0] || 'Exhibition Center';
        const rawDesc = m.yoast_wpseo_metadesc?.[0] || m.ovaem_desc_event?.[0] || m.ovaem_org_desc?.[0] || (m.content?.[0] ? m.content[0].slice(0, 300) : '') || '';
        return {
          _id: String(d.id || `wp-${idx}`),
          id: String(d.id || `wp-${idx}`),
          wpPostId: d.id,
          title: d.title || 'Exhibition Event',
          slug: d.slug,
          description: rawDesc,
          startDate: startTs && parseInt(startTs) > 0 ? new Date(parseInt(startTs) * 1000).toISOString() : null,
          endDate: endTs && parseInt(endTs) > 0 ? new Date(parseInt(endTs) * 1000).toISOString() : null,
          venue: venue,
          city: m.ovaem_city?.[0] || 'India',
          isClaimed: false,
          source: 'wordpress'
        };
      });

      wpDirectoryEventsCache = {
        docs,
        lastFetched: now,
        ttl: 10 * 60 * 1000
      };
      return docs;
    }
  } catch (err) {
    console.warn('[WP-Cache] Failed to load live WordPress events for duplicate check:', err.message);
  }

  return wpDirectoryEventsCache.docs;
}

// Warm up cache immediately in background on boot
fetchLiveWpDirectoryEvents().catch(() => {});
