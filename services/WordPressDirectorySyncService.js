/**
 * @file WordPressDirectorySyncService.js
 * @description Background synchronization & ingestion service to fetch WordPress events from visitexpo.in
 * and store them directly in MongoDB so all platform pages, search, and directory views load instantly.
 */

import fs from 'fs';
import path from 'path';
import Event from '../models/Event.js';
import DeletedEvent from '../models/DeletedEvent.js';
import { parseWpLocation } from '../routes/adminRoutes.js';

const WORDPRESS_URL = process.env.WORDPRESS_URL || 'https://visitexpo.in';
const WORDPRESS_API_KEY = process.env.WORDPRESS_API_KEY || 'visitexpo_custom_secret_key_12345';

// Precomputed category pools for high-quality fallback images
const CATEGORY_IMAGE_POOLS = {
  'Travel & Tourism': [
    'https://visitexpo.in/wp-content/uploads/2026/08/Hotel-Data-Conference-2.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/07/Empowering-Women-Expo-Culture-Entrepreneurship_re.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/08/The-Wedding-Collective-Expo.jpg'
  ],
  'Automotive & EV': [
    'https://visitexpo.in/wp-content/uploads/2026/08/Rush-Administrative-Services-Inc.-Annual-Trucks-Centers-and-Skills-Rodeo-1.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/07/Bharat-Mobility-Global-Expo_new.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/09/India-International-EV-Show-2026_new.jpg'
  ],
  'Aerospace & Aviation': [
    'https://visitexpo.in/wp-content/uploads/2026/08/Refining-India-2026.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/09/Scotland-Manufacturing-and-Supply-Chain-Conference-Exhibition-2026_new.jpg'
  ],
  'Logistics & Cargo': [
    'https://visitexpo.in/wp-content/uploads/2026/08/Rush-Administrative-Services-Inc.-Annual-Trucks-Centers-and-Skills-Rodeo-1.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/09/Scotland-Manufacturing-and-Supply-Chain-Conference-Exhibition-2026_new.jpg'
  ],
  'Healthcare & Pharma': [
    'https://visitexpo.in/wp-content/uploads/2026/08/48th-edition-Medicall-Expo-New-Delhi-2026_new.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/06/India-Med-Expo-Hyderabad-1.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/08/Medicall-Expo-2026.jpg'
  ],
  'Construction & Infra': [
    'https://visitexpo.in/wp-content/uploads/2026/07/Build-Bangladesh-Expo-31st-Edition.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/07/Bangladesh-Buildcon-International-Expo.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/07/Water-Environment-Expo.jpg'
  ],
  'Technology & AI': [
    'https://visitexpo.in/wp-content/uploads/2026/08/ET-TECH-X-2026_new.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/07/led.png',
    'https://visitexpo.in/wp-content/uploads/2026/09/FINETECH-JAPAN_new.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/09/ITEX-IRAQ_new.jpg'
  ],
  'Textile & Fashion': [
    'https://visitexpo.in/wp-content/uploads/2026/07/Sutraa-The-Indian-Fashion-Exhibition.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/07/gte.png',
    'https://visitexpo.in/wp-content/uploads/2026/07/DyeChem-Bangladesh-Expo-53rd-Edition.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/09/Interfabric-Russia_new.jpg'
  ],
  'Agri & Food Tech': [
    'https://visitexpo.in/wp-content/uploads/2026/08/Food-Connoisseurs-India-Convention-2026.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/06/12.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/07/icecream-social-for-pets.jpg'
  ],
  'Art & Lifestyle': [
    'https://visitexpo.in/wp-content/uploads/2026/08/Couture-India-Show-2026-New-Delhi.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/08/The-Wedding-Collective-Expo.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/09/Cosmobeaute-Indonesia_new.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/09/Watch-Jewellery-Middle-East-Show_new.jpg'
  ],
  'Energy & Environment': [
    'https://visitexpo.in/wp-content/uploads/2026/07/Water-Environment-Expo.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/08/9th-India-International-Water-Week-2026.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/07/Water-Bangladesh-Intl-Expo-8th-Edition.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/06/Global-Recycling-Expo-Summit-GREENS.jpg'
  ],
  'Trade & Industry': [
    'https://visitexpo.in/wp-content/uploads/2026/08/Refining-India-2026.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/09/Scotland-Manufacturing-and-Supply-Chain-Conference-Exhibition-2026_new.jpg',
    'https://visitexpo.in/wp-content/uploads/2026/09/Feria-Habitat-Valencia_new.jpg'
  ]
};

function inferCategory(title = '', desc = '') {
  const text = `${title} ${desc}`.toLowerCase();
  if (/\b(art|jewel|jewellery|jewelry|lifestyle|photo|handicraft|madridjoya|wedding|bridal|marriage|decor|interior|gift|gifts|luxury|pet|pets|cosmetics|beauty|hair|salon)\b/i.test(text)) return 'Art & Lifestyle';
  if (/\b(health|med|medical|pharma|cancer|doctor|hospital|surgical|pharmaexpo|iranpharma|dent|dental|biotech|clinical|nurse)\b/i.test(text)) return 'Healthcare & Pharma';
  if (/\b(textile|garment|fabric|yarn|fashion|apparel|dye|bisutex|clothing|leather|tailor|sewing|knit|hometextile)\b/i.test(text)) return 'Textile & Fashion';
  if (/\b(rice|food|agriculture|bakery|crop|biofuel|grain|beverage|confectionery|agritech|dairy|ice cream|seafood|agro|farming|spice|organic|sugar)\b/i.test(text)) return 'Agri & Food Tech';
  if (/\b(travel|tourism|tourist|destination|hospitality|hotel|resort|leisure|cruise|mice|resa|iftm)\b/i.test(text)) return 'Travel & Tourism';
  if (/\b(auto|automobile|automotive|vehicles?|motor|motors|ev|evs|electric vehicle|mobility|tyre|tire|truck|trucks|transport|rodeo|car|cars)\b/i.test(text)) return 'Automotive & EV';
  if (/\b(airport|aviation|rotorcraft|airlines?|airways?|aerospace|drone|aircraft)\b/i.test(text)) return 'Aerospace & Aviation';
  if (/\b(cargo|logistics|freight|supply chain|warehousing|innotrans|shipping|maritime)\b/i.test(text)) return 'Logistics & Cargo';
  if (/\b(build|building|construction|cement|concrete|infrastructure|municipal|architecture|foaid|real estate|property|housing|realty|urban land|flooring|roofing)\b/i.test(text)) return 'Construction & Infra';
  if (/\b(tech|technology|ai|software|cyber|iot|cloud|digital|broadcast|bes|lighting|led|electronics|semiconductor|smart|startup|startupx|it|data|telecom)\b/i.test(text)) return 'Technology & AI';
  if (/\b(energy|solar|power|water|environment|waste|clean|renewable|sustainability|storage|battery|oil|gas|wind)\b/i.test(text)) return 'Energy & Environment';
  return 'Trade & Industry';
}

function getCategoryFallback(category, title = '') {
  const pool = CATEGORY_IMAGE_POOLS[category] || CATEGORY_IMAGE_POOLS['Trade & Industry'];
  const hash = (title || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return pool[Math.abs(hash) % pool.length];
}

// In-memory cache for ultra-fast serving
let memoryCache = {
  events: null,
  timestamp: 0,
  ttl: 5 * 60 * 1000 // 5 minutes cache
};

class WordPressDirectorySyncService {
  constructor() {
    this.imageLookupMap = new Map();
    this.loadImageMap();
    this.isSyncing = false;
  }

  loadImageMap() {
    try {
      const jsonPath = path.resolve(process.cwd(), 'data/wordpress-event-images.json');
      if (fs.existsSync(jsonPath)) {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        for (const [k, url] of Object.entries(raw)) {
          if (url && typeof url === 'string' && url.includes('uploads')) {
            this.imageLookupMap.set(k, url);
            this.imageLookupMap.set(k.toLowerCase(), url);
            const norm = k.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            if (norm) this.imageLookupMap.set(norm, url);
          }
        }
        console.log(`[WP-Sync] Loaded ${this.imageLookupMap.size} precomputed image mappings.`);
      }
    } catch (err) {
      console.warn('[WP-Sync] Could not load image map:', err.message);
    }
  }

  findImage(slug, id, wpPostId, title, category) {
    if (slug && this.imageLookupMap.has(slug)) return this.imageLookupMap.get(slug);
    if (id && this.imageLookupMap.has(String(id))) return this.imageLookupMap.get(String(id));
    if (wpPostId && this.imageLookupMap.has(String(wpPostId))) return this.imageLookupMap.get(String(wpPostId));
    if (slug) {
      const norm = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (this.imageLookupMap.has(norm)) return this.imageLookupMap.get(norm);
    }
    if (title) {
      const titleSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (this.imageLookupMap.has(titleSlug)) return this.imageLookupMap.get(titleSlug);
    }
    return getCategoryFallback(category, title);
  }

  parsePhpSerializedArray(str) {
    if (!str || typeof str !== 'string') return [];
    const results = [];
    const regex = /s:\d+:"((?:\\.|[^"\\])*)";/g;
    let match;
    while ((match = regex.exec(str)) !== null) {
      results.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    }
    return results;
  }

  parsePhpSchedule(str) {
    if (!str || typeof str !== 'string') return [];
    const items = [];
    const parts = str.split(/i:\d+;a:\d+:\{/);
    for (const part of parts) {
      if (!part.trim()) continue;
      const nameMatch = part.match(/s:4:"name";s:\d+:"([^"]*)";/);
      const dateMatch = part.match(/s:4:"date";s:\d+:"([^"]*)";/);
      if (nameMatch || dateMatch) {
        items.push({
          name: nameMatch ? nameMatch[1] : 'Event Session',
          date: dateMatch ? dateMatch[1].trim() : ''
        });
      }
    }
    return items;
  }

  parsePhpSponsors(str) {
    if (!str || typeof str !== 'string') return [];
    const items = [];
    const regex = /s:4:"link";s:\d+:"([^"]*)";s:4:"logo";s:\d+:"([^"]*)";/g;
    let match;
    while ((match = regex.exec(str)) !== null) {
      const link = match[1];
      let name = '';
      if (link) {
        try {
          const u = new URL(link.startsWith('http') ? link : `https://${link}`);
          const host = u.hostname.replace(/^www\./, '').split('.')[0];
          if (host) {
            name = host.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }
        } catch (_) {}
      }
      items.push({
        name: name || 'Corporate Sponsor Partner',
        link: match[1],
        logo: match[2] ? `https://visitexpo.in/wp-content/uploads/${match[2]}` : ''
      });
    }
    return items;
  }

  decodeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&#038;/g, '&')
      .replace(/&amp;/g, '&')
      .replace(/&#8217;/g, "'")
      .replace(/&#8216;/g, "'")
      .replace(/&#8220;/g, '"')
      .replace(/&#8221;/g, '"')
      .replace(/&#8211;/g, '–')
      .replace(/&#8212;/g, '—')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  /**
   * Main synchronization routine:
   * 1. Fetches all events from WordPress REST API (visitexpo.in)
   * 2. Parses and enriches each record
   * 3. Upserts all records into MongoDB in high-performance batches
   * 4. Updates in-memory cache for instant responses
   */
  async syncWordPressEventsToMongoDB({ force = false } = {}) {
    if (this.isSyncing) {
      console.log('[WP-Sync] Sync already in progress, skipping concurrent call.');
      return { success: true, message: 'Sync already running' };
    }

    this.isSyncing = true;
    const startTime = Date.now();

    try {
      console.log(`[WP-Sync] Starting WordPress sync from ${WORDPRESS_URL}...`);

      const wpRes = await fetch(`${WORDPRESS_URL}/wp-json/visitexpo/v1/inspect-event-meta`, {
        headers: { 'X-VisitExpo-Key': WORDPRESS_API_KEY },
        signal: AbortSignal.timeout(30000)
      });

      if (!wpRes.ok) {
        throw new Error(`WordPress API returned status ${wpRes.status}`);
      }

      const wpData = await wpRes.json();
      const docs = wpData.data?.docs || [];

      if (!Array.isArray(docs) || docs.length === 0) {
        console.warn('[WP-Sync] No docs returned from WordPress API.');
        this.isSyncing = false;
        return { success: false, message: 'No documents returned from WordPress' };
      }

      console.log(`[WP-Sync] Successfully fetched ${docs.length} events from WordPress in ${Date.now() - startTime}ms. Ingesting into MongoDB...`);

      // Load deleted events to avoid resurrecting deleted records
      const deletedEvents = await DeletedEvent.find().lean();
      const deletedSlugs = new Set((deletedEvents || []).map(d => String(d.slug || '').trim().toLowerCase()));
      const deletedPostIds = new Set((deletedEvents || []).map(d => String(d.wpPostId || '').trim().toLowerCase()));
      const deletedTitles = new Set((deletedEvents || []).map(d => (d.title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')));

      // Find existing claimed events so we don't overwrite user ownership
      const existingEvents = await Event.find({ isClaimed: true }).select('slug wpPostId isClaimed claimedBy organizer banner').lean();
      const claimedMap = new Map();
      existingEvents.forEach(e => {
        if (e.slug) claimedMap.set(e.slug.toLowerCase(), e);
        if (e.wpPostId) claimedMap.set(String(e.wpPostId), e);
      });

      const bulkOps = [];
      let skippedCount = 0;

      for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        const rawSlug = (d.slug || '').toLowerCase().trim();
        const rawTitle = (d.title || '').trim();
        const normTitle = rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
        const postId = String(d.id || '');

        // Check if admin explicitly deleted this event
        if (
          (rawSlug && deletedSlugs.has(rawSlug)) ||
          (postId && deletedPostIds.has(postId)) ||
          (normTitle && deletedTitles.has(normTitle))
        ) {
          skippedCount++;
          continue;
        }

        const m = d.meta || {};
        const startTs = m.ovaem_date_start_time?.[0];
        const endTs = m.ovaem_date_end_time?.[0];
        const rawVenue = m.ovaem_address_event?.[0] || m.ovaem_event_map_address?.[0] || m.ovaem_event_map_name?.[0] || m.ovaem_address?.[0] || m.ovaem_venue?.[0] || 'Exhibition Center';
        const loc = parseWpLocation(rawVenue, m.ovaem_city?.[0]);

        const startDate = startTs && parseInt(startTs) > 0 ? new Date(parseInt(startTs) * 1000) : new Date();
        const endDate = endTs && parseInt(endTs) > 0 ? new Date(parseInt(endTs) * 1000) : new Date(startDate.getTime() + 86400000 * 2);

        const rawDesc = m.content?.[0] || m.yoast_wpseo_metadesc?.[0] || m.ovaem_desc_event?.[0] || m.ovaem_org_desc?.[0] || '';
        const cleanDesc = this.decodeHtml(
          rawDesc
            .replace(/<[^>]*>/g, '')
            .replace(/&hellip;/g, '...')
            .trim()
        ) || `${rawTitle} — Leading exhibition and business tradeshow hosted at ${loc.venue || loc.city}.`;

        const category = inferCategory(rawTitle, cleanDesc);
        const slug = rawSlug || (rawTitle ? rawTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : `event-${postId}`);
        const banner = this.findImage(slug, d.id, postId, rawTitle, category);

        // Parse FAQs
        const rawFaqTitles = m.ovaem_faq_title?.[0];
        const rawFaqDescs = m.ovaem_faq_desc?.[0];
        const faqTitles = this.parsePhpSerializedArray(rawFaqTitles);
        const faqDescs = this.parsePhpSerializedArray(rawFaqDescs);
        const faqsList = faqTitles.map((q, idx) => ({
          question: this.decodeHtml(q),
          answer: this.decodeHtml(faqDescs[idx] || '')
        })).filter(f => f.question && f.answer);

        // Parse schedules & sponsors
        const schedules = this.parsePhpSchedule(m.ovaem_schedule_date?.[0]);
        const sponsorsList = this.parsePhpSponsors(m.ovaem_sponsor_info?.[0]);

        // Organizer fields
        const orgName = (m.ovaem_org_name?.[0] || '').trim();
        const orgEmail = (m.ovaem_org_email?.[0] || '').trim();
        const orgPhone = (m.ovaem_org_phone?.[0] || '').trim();
        const orgWebsite = (m.ovaem_org_website?.[0] || '').trim();
        const orgDesc = (m.ovaem_org_desc?.[0] || '').trim();
        const orgLogo = (m.ovaem_org_logo?.[0] || '').trim();

        const isClaimedMatch = claimedMap.get(slug) || claimedMap.get(postId);

        // Upsert operation
        if (isClaimedMatch) {
          // If already claimed in MongoDB, preserve ownership while updating event timing and meta
          bulkOps.push({
            updateOne: {
              filter: { slug },
              update: {
                $set: {
                  wpPostId: postId,
                  wpUrl: `${WORDPRESS_URL}/event/${slug}/`,
                  startDate,
                  endDate,
                  venue: loc.venue,
                  city: loc.city,
                  country: loc.country || 'India',
                  categories: [category],
                  faqsList: faqsList.length > 0 ? faqsList : undefined,
                  schedules: schedules.length > 0 ? schedules : undefined,
                  sponsorsList: sponsorsList.length > 0 ? sponsorsList : undefined,
                  status: 'published'
                }
              }
            }
          });
        } else {
          // Unclaimed or new event: complete upsert
          bulkOps.push({
            updateOne: {
              filter: { slug },
              update: {
                $set: {
                  title: rawTitle || 'Exhibition Event',
                  slug,
                  description: cleanDesc,
                  banner,
                  venue: loc.venue,
                  city: loc.city,
                  country: loc.country || 'India',
                  startDate,
                  endDate,
                  categories: [category],
                  wpPostId: postId,
                  wpUrl: `${WORDPRESS_URL}/event/${slug}/`,
                  isClaimed: false,
                  orgName: orgName || 'VisitExpo Verified Organizer',
                  orgEmail: orgEmail || '',
                  orgPhone: orgPhone || '',
                  orgWebsite: orgWebsite || '',
                  orgDesc: orgDesc || '',
                  orgLogo: orgLogo || '',
                  faqsList,
                  schedules,
                  sponsorsList,
                  status: 'published'
                },
                $setOnInsert: {
                  isFreeEvent: true,
                  paidTicketPrice: 0,
                  currency: 'INR'
                }
              },
              upsert: true
            }
          });
        }
      }

      console.log(`[WP-Sync] Executing ${bulkOps.length} bulk write operations in MongoDB...`);

      // Execute bulkWrite in batches of 400 for optimal throughput & memory safety
      const BATCH_SIZE = 400;
      let totalUpserted = 0;
      let totalModified = 0;

      for (let b = 0; b < bulkOps.length; b += BATCH_SIZE) {
        const chunk = bulkOps.slice(b, b + BATCH_SIZE);
        const result = await Event.bulkWrite(chunk, { ordered: false });
        totalUpserted += (result.upsertedCount || 0);
        totalModified += (result.modifiedCount || 0);
      }

      const totalTimeMs = Date.now() - startTime;
      console.log(`[WP-Sync] Done! Processed ${bulkOps.length} events (Upserted: ${totalUpserted}, Modified: ${totalModified}, Skipped deleted: ${skippedCount}) in ${totalTimeMs}ms.`);

      // Invalidate memory cache so next read gets fresh data
      memoryCache.events = null;
      memoryCache.timestamp = 0;

      this.isSyncing = false;
      return {
        success: true,
        count: bulkOps.length,
        upserted: totalUpserted,
        modified: totalModified,
        skipped: skippedCount,
        durationMs: totalTimeMs,
        syncedAt: new Date()
      };
    } catch (err) {
      console.error('[WP-Sync] Sync failed:', err);
      this.isSyncing = false;
      return { success: false, error: err.message };
    }
  }

  /**
   * Fast event fetcher from MongoDB (served in < 20ms)
   */
  async getFastStoredEvents({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && memoryCache.events && (now - memoryCache.timestamp < memoryCache.ttl)) {
      return memoryCache.events;
    }

    // Query directly from indexed MongoDB
    const events = await Event.find({ status: { $ne: 'cancelled' } })
      .select('title slug description banner venue city country startDate endDate categories organizer wpPostId wpUrl isClaimed status')
      .sort({ startDate: 1 })
      .lean();

    if (events && events.length > 0) {
      memoryCache = {
        events,
        timestamp: now,
        ttl: 5 * 60 * 1000
      };
    }

    return events;
  }
}

const syncService = new WordPressDirectorySyncService();
export default syncService;
