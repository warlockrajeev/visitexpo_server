/**
 * @file WordPressDirectorySyncService.js
 * @description Background synchronization & ingestion service to fetch WordPress events from visitexpo.in
 * and store them directly in MongoDB so all platform pages, search, and directory views load instantly.
 */

import fs from 'fs';
import path from 'path';
import Event from '../models/Event.js';
import DeletedEvent from '../models/DeletedEvent.js';
import EventEngagement from '../models/EventEngagement.js';
import Visitor from '../models/Visitor.js';
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
  const cleanTitle = String(title || '').toLowerCase().replace(/state-of-the-art|state of the art/g, ' ');
  const cleanDesc = String(desc || '').toLowerCase().replace(/state-of-the-art|state of the art/g, ' ');

  const matchRules = [
    { label: 'Healthcare & Pharma', regex: /\b(health|healthcare|medicall|medical|pharma\w*|cancer|doctor|hospital|surgical|dental|biotech\w*|clinical|nurse|diagnostic\w*|ayurved\w*|medtech|cphi)\b/i },
    { label: 'Automotive & EV', regex: /\b(automotive|automobile|automechanika|auto\s+expo|motor\s+show|electric\s+vehicle|ev\s+expo|ev\s+india|e-mobility|bharat\s+mobility|tyre|tire|two-wheeler|busworld)\b/i },
    { label: 'Construction & Infra', regex: /\b(build|building|buildcon|construction|conmach|cement|concrete|infrastructure|municipal|architecture|foaid|real\s+estate|property|housing|flooring|roofing|glasspex|glasspro|ceramics|elevator|hvac|bauma)\b/i },
    { label: 'Manufacturing & Machinery', regex: /\b(manufacturing|machinery|machine\s+tools?|imtex|engimach|engiexpo|automation|robotics|welding|foundry|packaging|pack\s+expo|plastindia|plasto|plastics|recycling|chemical|printpack|wire\s+and\s+cable|cable\s*&\s*wire)\b/i },
    { label: 'Textile & Fashion', regex: /\b(textile\w*|garment\w*|fabric\w*|yarn|fashion|apparel|denim|clothing|leather|sewing|knit\w*|hometextile|handloom|footwear)\b/i },
    { label: 'Agri & Food Tech', regex: /\b(rice|food\w*|agriculture|agricultural|bakery|crop|biofuel|grain|beverage\w*|confectionery|agritech|dairy|ice\s+cream|seafood|agro\w*|farming|spice\w*|organic|sugar|aahar|horeca|hospitality|horti\w*)\b/i },
    { label: 'Energy & Environment', regex: /\b(renewable\s+energy|solar|powergen|power\s+generation|elecrama|water\s+expo|clean\s+energy|battery\s+show|oil\s+and\s+gas|wind\s+energy|refining|petrochemical\w*|hydrogen)\b/i },
    { label: 'Finance & FinTech', regex: /\b(finance|financial|fintech|money\s+expo|banking|ibex|insurance|investment|wealth|crypto|bfsi)\b/i },
    { label: 'Aerospace & Aviation', regex: /\b(airport|aviation|rotorcraft|airlines?|airways?|aerospace|drone|aircraft)\b/i },
    { label: 'Logistics & Cargo', regex: /\b(cargo|logistics|freight|supply\s+chain|warehousing|innotrans|shipping|maritime|cold\s+chain)\b/i },
    { label: 'Travel & Tourism', regex: /\b(travel|tourism|tourist|destination|resort|leisure|cruise|mice|iftm|ttf|satte|otm)\b/i },
    { label: 'Technology & AI', regex: /\b(technology|artificial\s+intelligence|gitex|software|cyber\w*|iot\b|cloud\s+computing|broadcast\w*|electronics|semiconductor\w*|semicon|telecom\w*|infocomm|et\s+tech|tech\s+expo|tech\s+summit)\b/i },
    { label: 'Art & Lifestyle', regex: /\b(jewel\w*|jewelry|handicraft|madridjoya|wedding|bridal|marriage|gifts?\s+fair|luxury|pet\s+trade|interzoo|anido|iiptf|cosmetics|beauty|salon)\b/i }
  ];

  for (const rule of matchRules) {
    if (rule.regex.test(cleanTitle)) return rule.label;
  }
  for (const rule of matchRules) {
    if (rule.regex.test(cleanDesc)) return rule.label;
  }
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
   * Fast event fetcher from MongoDB with dynamic live engagement & turnout counts
   */
  async getFastStoredEvents({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && memoryCache.events && (now - memoryCache.timestamp < memoryCache.ttl)) {
      return memoryCache.events;
    }

    // Query directly from indexed MongoDB along with real engagement and visitor turnout counts
    const [rawEvents, engagementAgg, visitorAgg] = await Promise.all([
      Event.find({ status: { $ne: 'cancelled' } })
        .select('title slug description banner venue address city country startDate endDate timings categories organizer orgName wpPostId wpUrl isClaimed status isFreeEvent paidTicketPrice createdAt')
        .populate('organizer', 'name email logo website')
        .sort({ startDate: -1 })
        .lean(),
      EventEngagement.aggregate([
        {
          $match: {
            status: 'active',
            $or: [
              { isInterested: true },
              { type: { $in: ['interested', 'both'] } }
            ]
          }
        },
        {
          $group: {
            _id: '$eventSlug',
            count: { $sum: 1 },
            eventIds: { $addToSet: '$eventId' }
          }
        }
      ]).catch(() => []),
      Visitor.aggregate([
        {
          $match: {
            registrationStatus: { $ne: 'cancelled' }
          }
        },
        {
          $group: {
            _id: '$event',
            count: { $sum: 1 }
          }
        }
      ]).catch(() => [])
    ]);

    // Build engagement map by slug and by eventId
    const engagementMap = new Map();
    (engagementAgg || []).forEach((e) => {
      const slugKey = (e._id || '').toLowerCase().trim();
      if (slugKey) {
        engagementMap.set(slugKey, (engagementMap.get(slugKey) || 0) + e.count);
      }
      if (Array.isArray(e.eventIds)) {
        e.eventIds.forEach((id) => {
          const idKey = String(id || '').trim();
          if (idKey) {
            engagementMap.set(idKey, (engagementMap.get(idKey) || 0) + e.count);
          }
        });
      }
    });

    // Build visitor map by event ObjectId string
    const visitorMap = new Map();
    (visitorAgg || []).forEach((v) => {
      const vKey = String(v._id || '').trim();
      if (vKey) {
        visitorMap.set(vKey, v.count);
      }
    });

    const events = (rawEvents || []).map((doc) => {
      const populatedOrgName =
        doc.organizer && typeof doc.organizer === 'object' ? doc.organizer.name : '';
      const rawOrgName = (doc.orgName || '').trim();
      const isHostnameOrId =
        /^[0-9a-fA-F]{24}$/.test(rawOrgName) ||
        /\b(onrender\.com|vercel\.app|localhost|http:\/\/|https:\/\/)\b/i.test(rawOrgName);
      const cleanOrganizer =
        populatedOrgName ||
        (!isHostnameOrId && rawOrgName ? rawOrgName : '') ||
        'VisitExpo Verified Organizer';

      const resolvedCategory = inferCategory(doc.title, doc.description);

      const slugKey = (doc.slug || '').toLowerCase().trim();
      const idKey = String(doc._id || '').trim();
      const wpKey = String(doc.wpPostId || '').trim();

      const engCount =
        (slugKey && engagementMap.get(slugKey)) ||
        (idKey && engagementMap.get(idKey)) ||
        (wpKey && engagementMap.get(wpKey)) ||
        0;
      const visCount =
        (idKey && visitorMap.get(idKey)) ||
        (wpKey && visitorMap.get(wpKey)) ||
        0;

      // Genuine dynamic count of users interested or attending from MongoDB
      const dynamicInterestedCount = engCount + visCount;

      return {
        ...doc,
        organizer: cleanOrganizer,
        organizerName: cleanOrganizer,
        orgName: cleanOrganizer,
        category: resolvedCategory,
        categories: [resolvedCategory],
        interestedCount: dynamicInterestedCount,
        attendeesCount: dynamicInterestedCount
      };
    });

    if (events && events.length > 0) {
      memoryCache = {
        events,
        timestamp: now,
        ttl: 5 * 60 * 1000
      };
    }

    return events;
  }

  /**
   * Immediately update specific event's participation count in warm memory cache
   */
  updateEventInterestedCount(slugOrId, delta = 0, explicitCount = null) {
    if (!memoryCache.events || !Array.isArray(memoryCache.events)) return;
    const cleanKey = String(slugOrId || '').toLowerCase().trim();
    if (!cleanKey) return;
    const event = memoryCache.events.find(
      (e) =>
        (e.slug || '').toLowerCase().trim() === cleanKey ||
        String(e._id || '').toLowerCase().trim() === cleanKey ||
        String(e.wpPostId || '').toLowerCase().trim() === cleanKey
    );
    if (event) {
      if (typeof explicitCount === 'number') {
        event.interestedCount = Math.max(0, explicitCount);
        event.attendeesCount = Math.max(0, explicitCount);
      } else {
        event.interestedCount = Math.max(0, (event.interestedCount || 0) + delta);
        event.attendeesCount = event.interestedCount;
      }
    }
  }

  /**
   * Immediately clear memory cache so new user engagements are reflected dynamically
   */
  clearCache() {
    if (memoryCache.events) {
      memoryCache.timestamp = 0; // Mark stale for background refresh
    } else {
      memoryCache = {
        events: null,
        timestamp: 0,
        ttl: 5 * 60 * 1000
      };
    }
  }
}

const syncService = new WordPressDirectorySyncService();
export default syncService;
