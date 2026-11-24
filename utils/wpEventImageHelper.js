/**
 * @file wpEventImageHelper.js
 * @description Canonical WordPress event image validation, mismatched category-pool detection,
 * and live WordPress featured image fetching (oEmbed + HTML og:image stream fallback).
 */

const WORDPRESS_URL = process.env.WORDPRESS_URL || 'https://visitexpo.in';

export const BROKEN_WP_URLS = new Set([
  'https://visitexpo.in/wp-content/uploads/2026/09/India-International-EV-Show-2026_new.jpg',
  'https://visitexpo.in/wp-content/uploads/2026/08/Medicall-Expo-2026.jpg',
  'https://visitexpo.in/wp-content/uploads/2026/08/ET-TECH-X-2026_new.jpg',
  'https://visitexpo.in/wp-content/uploads/2026/09/FINETECH-JAPAN_new.jpg',
  'https://visitexpo.in/wp-content/uploads/2026/09/Cosmobeaute-Indonesia_new.jpg',
  'https://visitexpo.in/wp-content/uploads/2026/09/Watch-Jewellery-Middle-East-Show_new.jpg',
  'https://visitexpo.in/wp-content/uploads/2026/09/Feria-Habitat-Valencia_new.jpg'
]);

/**
 * Legacy category-pool posters that were mistakenly assigned to hundreds of unrelated events.
 * Each URL is paired with a regex matching ONLY the genuine owner exhibition(s).
 */
export const LEGACY_POOL_OWNERS = {
  'https://visitexpo.in/wp-content/uploads/2026/08/Hotel-Data-Conference-2.jpg': /hotel[\s-]+data/i,
  'https://visitexpo.in/wp-content/uploads/2026/07/Empowering-Women-Expo-Culture-Entrepreneurship_re.jpg': /empowering[\s-]+women/i,
  'https://visitexpo.in/wp-content/uploads/2026/08/The-Wedding-Collective-Expo.jpg': /wedding[\s-]+collective/i,
  'https://visitexpo.in/wp-content/uploads/2026/08/Rush-Administrative-Services-Inc.-Annual-Trucks-Centers-and-Skills-Rodeo-1.jpg': /rush[\s-]+administrative|skills[\s-]+rodeo/i,
  'https://visitexpo.in/wp-content/uploads/2026/07/Bharat-Mobility-Global-Expo_new.jpg': /bharat[\s-]+mobility/i,
  'https://visitexpo.in/wp-content/uploads/2026/09/India-International-EV-Show-2026_new.jpg': /india[\s-]+international[\s-]+ev/i,
  'https://visitexpo.in/wp-content/uploads/2026/08/Refining-India-2026.jpg': /refining[\s-]+india/i,
  'https://visitexpo.in/wp-content/uploads/2026/09/Scotland-Manufacturing-and-Supply-Chain-Conference-Exhibition-2026_new.jpg': /scotland[\s-]+manufacturing/i,
  'https://visitexpo.in/wp-content/uploads/2026/08/48th-edition-Medicall-Expo-New-Delhi-2026_new.jpg': /medicall.*delhi|48th.*medicall/i,
  'https://visitexpo.in/wp-content/uploads/2026/06/India-Med-Expo-Hyderabad-1.jpg': /india[\s-]+med[\s-]+expo|med[\s-]+expo.*hyderabad/i,
  'https://visitexpo.in/wp-content/uploads/2026/08/Medicall-Expo-2026.jpg': /\bmedicall\b/i,
  'https://visitexpo.in/wp-content/uploads/2026/07/Build-Bangladesh-Expo-31st-Edition.jpg': /build[\s-]+bangladesh/i,
  'https://visitexpo.in/wp-content/uploads/2026/07/Bangladesh-Buildcon-International-Expo.jpg': /bangladesh[\s-]+buildcon|buildcon.*bangladesh/i,
  'https://visitexpo.in/wp-content/uploads/2026/07/Water-Environment-Expo.jpg': /water[\s&-]+environment/i,
  'https://visitexpo.in/wp-content/uploads/2026/08/ET-TECH-X-2026_new.jpg': /et[\s-]+tech[\s-]*x/i,
  'https://visitexpo.in/wp-content/uploads/2026/07/led.png': /\bled\b[\s-]+expo|\bled\b[\s-]+show/i,
  'https://visitexpo.in/wp-content/uploads/2026/09/FINETECH-JAPAN_new.jpg': /finetech[\s-]+japan/i,
  'https://visitexpo.in/wp-content/uploads/2026/09/ITEX-IRAQ_new.jpg': /itex[\s-]+iraq/i,
  'https://visitexpo.in/wp-content/uploads/2026/07/Sutraa-The-Indian-Fashion-Exhibition.jpg': /\bsutraa\b/i,
  'https://visitexpo.in/wp-content/uploads/2026/07/gte.png': /\bgte\b|garment[\s-]+technology[\s-]+expo/i,
  'https://visitexpo.in/wp-content/uploads/2026/07/DyeChem-Bangladesh-Expo-53rd-Edition.jpg': /dyechem[\s-]+bangladesh/i,
  'https://visitexpo.in/wp-content/uploads/2026/09/Interfabric-Russia_new.jpg': /interfabric/i,
  'https://visitexpo.in/wp-content/uploads/2026/08/Food-Connoisseurs-India-Convention-2026.jpg': /food[\s-]+connoisseurs/i,
  'https://visitexpo.in/wp-content/uploads/2026/06/12.jpg': /^__never_match__$/i,
  'https://visitexpo.in/wp-content/uploads/2026/07/icecream-social-for-pets.jpg': /ice[\s-]*cream[\s-]+social/i,
  'https://visitexpo.in/wp-content/uploads/2026/08/Couture-India-Show-2026-New-Delhi.jpg': /couture[\s-]+india/i,
  'https://visitexpo.in/wp-content/uploads/2026/09/Cosmobeaute-Indonesia_new.jpg': /cosmobeaute[\s-]+indonesia/i,
  'https://visitexpo.in/wp-content/uploads/2026/09/Watch-Jewellery-Middle-East-Show_new.jpg': /watch[\s&-]+jewellery[\s-]+middle[\s-]+east/i,
  'https://visitexpo.in/wp-content/uploads/2026/08/9th-India-International-Water-Week-2026.jpg': /water[\s-]+week/i,
  'https://visitexpo.in/wp-content/uploads/2026/07/Water-Bangladesh-Intl-Expo-8th-Edition.jpg': /water[\s-]+bangladesh/i,
  'https://visitexpo.in/wp-content/uploads/2026/06/Global-Recycling-Expo-Summit-GREENS.jpg': /global[\s-]+recycling|greens/i,
  'https://visitexpo.in/wp-content/uploads/2026/09/Feria-Habitat-Valencia_new.jpg': /feria[\s-]+habitat|habitat[\s-]+valencia/i
};

export const LEGACY_POOL_URL_SET = new Set([
  ...Object.keys(LEGACY_POOL_OWNERS),
  ...BROKEN_WP_URLS
]);

export function normalizeEventImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url
    .trim()
    .replace(/^http:\/\/visitexpo\.in/i, 'https://visitexpo.in')
    .replace(/^http:\/\/www\.visitexpo\.in/i, 'https://visitexpo.in');
}

export function isValidEventImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = normalizeEventImageUrl(url);
  if (!trimmed) return false;
  if (
    trimmed.includes('unsplash.com') ||
    trimmed.includes('cropped-Untitled') ||
    trimmed.includes('placeholder') ||
    BROKEN_WP_URLS.has(trimmed)
  ) {
    return false;
  }
  return (
    trimmed.includes('wp-content/uploads') ||
    trimmed.includes('res.cloudinary.com') ||
    /^https?:\/\//i.test(trimmed)
  );
}

/**
 * Returns true if `url` is one of the legacy category-pool posters AND does NOT belong
 * to the given event (by slug or title).
 */
export function isMismatchedPoolImage(url, slug = '', title = '') {
  const clean = normalizeEventImageUrl(url);
  if (!clean) return false;
  if (BROKEN_WP_URLS.has(clean)) return true;
  const ownerRegex = LEGACY_POOL_OWNERS[clean];
  if (!ownerRegex) return false;
  const identity = `${String(slug || '')} ${String(title || '')}`.trim();
  if (!identity) return true;
  return !ownerRegex.test(identity);
}

export function isGenuineEventImageUrl(url, slug = '', title = '') {
  return isValidEventImageUrl(url) && !isMismatchedPoolImage(url, slug, title);
}

/**
 * Fetch the real featured image URL for an event directly from visitexpo.in WordPress.
 * Priority:
 *  1. WordPress oEmbed endpoint (/wp-json/oembed/1.0/embed?url=...) -> thumbnail_url
 *  2. Event page HTML <head> stream -> <meta property="og:image">
 */
export async function fetchLiveWpEventImageWithStatus(slug, title = '', timeoutMs = 7000) {
  const cleanSlug = String(slug || '').trim().replace(/^\/+|\/+$/g, '');
  if (!cleanSlug) return { url: '', rateLimited: false };

  // 1. WordPress oEmbed API (lightweight JSON, fastest)
  try {
    const oembedUrl = `${WORDPRESS_URL}/wp-json/oembed/1.0/embed?url=${encodeURIComponent(`${WORDPRESS_URL}/event/${cleanSlug}/`)}`;
    const res = await fetch(oembedUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 6000))
    });
    if (res.status === 403 || res.status === 429) {
      return { url: '', rateLimited: true };
    }
    if (res.ok) {
      const data = await res.json();
      const thumb = normalizeEventImageUrl(data?.thumbnail_url || '');
      if (isValidEventImageUrl(thumb) && !isMismatchedPoolImage(thumb, cleanSlug, title)) {
        return { url: thumb, rateLimited: false };
      }
    }
  } catch {}

  // 2. HTML <head> og:image stream fallback
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const pageRes = await fetch(`${WORDPRESS_URL}/event/${cleanSlug}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: controller.signal
    });
    if (pageRes.status === 403 || pageRes.status === 429) {
      return { url: '', rateLimited: true };
    }
    if (pageRes.ok && pageRes.body) {
      const reader = pageRes.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let foundUrl = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const ogMatch =
          buffer.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
          buffer.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
        if (ogMatch && ogMatch[1]) {
          foundUrl = normalizeEventImageUrl(ogMatch[1]);
          controller.abort();
          break;
        }
        if (buffer.includes('</head>') || buffer.length > 32000) {
          controller.abort();
          break;
        }
      }

      if (
        foundUrl &&
        (foundUrl.includes('wp-content/uploads') || foundUrl.includes('res.cloudinary.com')) &&
        isValidEventImageUrl(foundUrl) &&
        !isMismatchedPoolImage(foundUrl, cleanSlug, title)
      ) {
        return { url: foundUrl, rateLimited: false };
      }
    }
  } catch {} finally {
    clearTimeout(timeout);
  }

  return { url: '', rateLimited: false };
}

export async function fetchLiveWpEventImage(slug, title = '', timeoutMs = 7000) {
  const { url } = await fetchLiveWpEventImageWithStatus(slug, title, timeoutMs);
  return url;
}
