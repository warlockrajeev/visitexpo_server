/**
 * @file venueController.js
 * @description Controller for venue profiles, gallery media management, and event aggregations.
 */

import Venue from '../models/Venue.js';
import Event from '../models/Event.js';
import Review from '../models/Review.js';
import EventEngagement from '../models/EventEngagement.js';
import { DEFAULT_VENUES } from '../data/defaultVenues.js';
import { getNearbyHotelsForVenue } from '../data/defaultHotels.js';

// Helper to escape special regex characters safely
function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper to normalize strings into URL-safe slugs
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Strip sub-hall, entrance, gate, or floor suffixes so variants map to their canonical parent venue
// e.g. "ExCeL London (Hall N22" -> "ExCeL London", "Excel London West Entrance" -> "Excel London"
export function stripVenueSubLocation(rawName) {
  let cleaned = String(rawName || '')
    .replace(/^[:\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove parenthetical hall/entrance/gate/pavilion/floor notes (even if unclosed parenthesis)
  cleaned = cleaned
    .replace(/\s*\(\s*(?:halls?|pavilion|gate|entrance|west\s+entrance|east\s+entrance|north\s+entrance|south\s+entrance|floor|level|room|booth|stand|wing|block)[^)]*\)?\s*$/i, '')
    .replace(/\s*[-–—,]\s*(?:halls?\s*(?:no\.?\s*)?[a-z0-9\s&–-]+|pavilion\s*[a-z0-9\s&–-]+|gate\s*[a-z0-9]+|(?:north|south|east|west)\s+entrance)\s*$/i, '')
    .replace(/\s+(?:halls?\s+(?:no\.?\s*)?[a-z]?\d+[a-z0-9\s&–-]*|(?:north|south|east|west)\s+entrance|gate\s*\d+)\s*$/i, '')
    .replace(/^hall\s+[a-z0-9]+\s+at\s+/i, '')
    .replace(/\s*\(\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

// Reject noisy/garbage/spam non-venue strings (URLs, %20 encoded slugs, standalone halls/pavilions, pure numbers, hashtags, generic placeholders)
export function isValidRealVenueName(rawName, rawSlug = '') {
  const rawStr = String(rawName || '').trim();
  const slugStr = String(rawSlug || '').trim();

  // Reject URL-encoded garbage or whitespace inside slugs
  if (/%[0-9a-f]{2}/i.test(rawStr) || /%[0-9a-f]{2}/i.test(slugStr) || /\s/.test(slugStr)) {
    return false;
  }

  const cleaned = rawStr
    .replace(/^[:\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length <= 3) return false;

  // Reject URLs, protocols, www domains, and mangled URL names like "Https Www Excel London"
  if (
    /https?:\/\//i.test(cleaned) ||
    /\bhttps?\b/i.test(cleaned) ||
    /\bwww\b/i.test(cleaned) ||
    /^(?:https?|www)-/i.test(slugStr) ||
    /(?:^|\s|\.)[a-z0-9-]+\.(?:com|in|co\.uk|org|net|io|london|eu|de|ae|sg|gov|edu)\b/i.test(cleaned)
  ) {
    return false;
  }

  // Reject pure numbers, hashtags, and standalone floor/hall/pavilion/gate/booth labels
  if (/^(?:\d+|#.*|\d+(?:st|nd|rd|th)\s*\(?.*\)?\s*floor.*)$/i.test(cleaned)) return false;
  if (
    /^(?:halls?|pavilions?|gates?|entrances?|booths?|stands?|rooms?|floors?|levels?)\s*(?:no\.?\s*)?[a-z0-9\s&–,\-/().]*$/i.test(
      cleaned
    )
  ) {
    return false;
  }
  if (/^(?:hall|pavilion)\s*\d+\s*(?:&|and)\s*(?:convention|exhibition)\s*cent(?:er|re)$/i.test(cleaned)) {
    return false;
  }

  if ((cleaned.match(/#\w+/g) || []).length >= 2) return false;
  if (
    /^(?:exhibition\s+cent(?:er|re)|convention\s+cent(?:er|re)|conference\s+facility\s*\/?\s*convention\s+cent(?:er|re)|premier\s+academic\s+convention\s+cent(?:er|re)\s*\/?\s*virtual|tba|tbd|online|virtual|n\/a|india|unknown)$/i.test(
      cleaned
    )
  ) {
    return false;
  }
  return true;
}

// Known canonical alias phrases (strict multi-word / unique identifiers ONLY — never generic single city words)
function getCanonicalVenueAliases(slug, name, shortName) {
  const hay = `${String(slug || '')} ${String(name || '')} ${String(shortName || '')}`.toLowerCase();
  const aliases = [];

  if (/\bexcel\s*london\b|excel-london/.test(hay)) {
    aliases.push('excel london', 'excel, london');
  }
  if (hay.includes('mandapam') || hay.includes('pragati')) {
    aliases.push('pragati maidan', 'bharat mandapam');
  }
  if (hay.includes('yashobhoomi') || /\biicc\b/.test(hay)) {
    aliases.push('yashobhoomi', 'iicc');
  }
  if (/\bnsic\b/.test(hay)) {
    aliases.push('nsic exhibition', 'nsic ground', 'nsic okhla');
  }
  if (hay.includes('bombay exhibition') || /\bnesco\b/.test(hay) || slug === 'bec-mumbai') {
    aliases.push('bombay exhibition', 'nesco');
  }
  if (/\bbiec\b/.test(hay) || hay.includes('bangalore international exhibition') || hay.includes('bengaluru international exhibition')) {
    aliases.push('biec', 'bangalore international exhibition', 'bengaluru international exhibition');
  }
  if (hay.includes('jio world')) {
    aliases.push('jio world convention', 'jio world centre', 'jio world center');
  }
  if (/\bieml\b/.test(hay) || hay.includes('india expo centre') || hay.includes('india expo mart')) {
    aliases.push('india expo centre', 'india expo mart', 'ieml');
  }
  if (/\bhitex\b/.test(hay)) {
    aliases.push('hitex');
  }
  if (hay.includes('codissia')) {
    aliases.push('codissia');
  }
  if (hay.includes('chennai trade centre') || hay.includes('chennai trade center')) {
    aliases.push('chennai trade centre', 'chennai trade center');
  }
  if (hay.includes('biswa bangla')) {
    aliases.push('biswa bangla');
  }
  if (hay.includes('helipad exhibition')) {
    aliases.push('helipad exhibition');
  }

  return [...new Set(aliases)];
}

// Build strict, accurate MongoDB Event query for a venue (NO loose single-word token splitting!)
function buildVenueEventQuery(venue) {
  const vShort = stripVenueSubLocation(venue?.shortName || venue?.name || '').trim();
  const vName = stripVenueSubLocation(venue?.name || '').trim();
  const rawShort = String(venue?.shortName || '').trim();
  const rawName = String(venue?.name || '').trim();
  const vSlug = String(venue?.slug || '').toLowerCase().trim();

  const phrases = [...new Set([vShort, vName, rawShort, rawName].filter((p) => p && p.length >= 4))];
  const aliases = getCanonicalVenueAliases(vSlug, rawName, rawShort);

  const conditions = [];
  for (const phrase of phrases) {
    const escaped = escapeRegex(phrase);
    conditions.push({ venue: { $regex: escaped, $options: 'i' } });
    conditions.push({ address: { $regex: escaped, $options: 'i' } });
  }
  for (const alias of aliases) {
    const escaped = escapeRegex(alias);
    conditions.push({ venue: { $regex: escaped, $options: 'i' } });
    conditions.push({ address: { $regex: escaped, $options: 'i' } });
  }

  return conditions;
}

// Match an aggregated event venue key (lowercased) against a venue using the exact same canonical rules
function venueMatchesEventKey(venue, eventVenueKey) {
  const vKey = String(eventVenueKey || '').toLowerCase().trim();
  if (!vKey) return false;

  const vShort = stripVenueSubLocation(venue?.shortName || venue?.name || '').toLowerCase().trim();
  const vName = stripVenueSubLocation(venue?.name || '').toLowerCase().trim();
  const rawShort = String(venue?.shortName || '').toLowerCase().trim();
  const rawName = String(venue?.name || '').toLowerCase().trim();

  if (
    (vShort && vKey === vShort) ||
    (vName && vKey === vName) ||
    (rawShort && vKey === rawShort) ||
    (rawName && vKey === rawName) ||
    (vShort.length > 4 && vKey.includes(vShort)) ||
    (vName.length > 5 && vKey.includes(vName))
  ) {
    return true;
  }

  const aliases = getCanonicalVenueAliases(venue?.slug, rawName, rawShort);
  for (const alias of aliases) {
    if (alias && vKey.includes(alias.toLowerCase())) {
      return true;
    }
  }

  return false;
}

let defaultVenuesSynced = false;

/**
 * Cleans noisy/spam non-venue records and reconciles ratings in background.
 */
async function ensureDefaultVenuesSeeded() {
  if (defaultVenuesSynced) return;
  defaultVenuesSynced = true;

  void (async () => {
    try {
      // Remove noisy/garbage/URL/encoded-slug records and normalize dummy '12+' upcoming counts in DB
      await Venue.deleteMany({
        $or: [
          { name: { $regex: /^(?:\d+|#.*|\d+(?:st|nd|rd|th)\s*\(?.*\)?\s*floor.*)$/i } },
          { name: { $regex: /^(?:exhibition\s+cent(?:er|re)|jio|tba|tbd|online|virtual)$/i } },
          { name: { $regex: /\bhttps?\b|\bwww\b|https?:\/\//i } },
          { slug: { $regex: /^(?:https?|www)-|%[0-9a-f]{2}|\s/i } },
          { name: { $regex: /^(?:halls?|pavilions?|gates?)\s*(?:no\.?\s*)?[a-z0-9\s&–,\-/().]*$/i } }
        ]
      });
      await Venue.updateMany(
        { upcomingEventsCount: '12+' },
        { $set: { upcomingEventsCount: '0' } }
      );
    } catch (_) {}
  })();
}

/**
 * Discover any custom venues present in the Event collection and create records if missing.
 */
async function syncDiscoveredVenuesFromEvents() {
  try {
    const eventVenues = await Event.aggregate([
      {
        $match: {
          venue: { $exists: true, $ne: '' }
        }
      },
      {
        $group: {
          _id: '$venue',
          city: { $first: '$city' },
          country: { $first: '$country' },
          address: { $first: '$address' },
          sampleImage: { $first: '$image' },
          eventCount: { $sum: 1 }
        }
      }
    ]);

    for (const ev of eventVenues) {
      const normalizedName = stripVenueSubLocation(ev._id);
      if (!isValidRealVenueName(normalizedName)) continue;

      const slug = slugify(normalizedName);
      if (!slug) continue;

      const existing = await Venue.findOne({
        $or: [
          { slug },
          { name: { $regex: `^${escapeRegex(normalizedName)}$`, $options: 'i' } },
          { shortName: { $regex: `^${escapeRegex(normalizedName)}$`, $options: 'i' } }
        ]
      });

      if (!existing && !DEFAULT_VENUES.some((d) => d.slug === slug)) {
        await Venue.create({
          slug,
          name: normalizedName,
          shortName: normalizedName.split(',')[0],
          tagline: `Convention & Exhibition Facility in ${ev.city || 'India'}`,
          city: ev.city || 'India',
          country: ev.country || 'India',
          address: ev.address || `${normalizedName}, ${ev.city || ''}, ${ev.country || 'India'}`,
          heroBanner:
            ev.sampleImage ||
            'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=1600&auto=format&fit=crop',
          logoThumbnail:
            'https://images.unsplash.com/photo-1541971875076-8f970d573be6?q=80&w=300&auto=format&fit=crop',
          gallery: ev.sampleImage ? [ev.sampleImage] : [],
          eventsHosted: `${ev.eventCount}`,
          rating: 0,
          ratingsCount: 0,
          ratingSource: 'No reviews yet',
          overviewDescription: `${normalizedName} is a prominent venue host for conferences, exhibitions, and trade shows.`
        });
      }
    }
  } catch (err) {
    console.warn('[Venues] Discovery from events error:', err.message);
  }
}

let venuesCache = {
  data: null,
  timestamp: 0,
  ttl: 15 * 60 * 1000 // 15 mins cache
};
let venuesInFlight = null;

export function invalidateVenuesCache() {
  venuesCache.data = null;
  venuesCache.timestamp = 0;
}

async function _computeAllVenuesPayload() {
  await ensureDefaultVenuesSeeded();

  const now = new Date();
    const [venues, countsAgg, reviewAgg, followerAgg] = await Promise.all([
    Venue.find().sort({ isFeatured: -1, name: 1 }).lean(),
    Event.aggregate([
      { $match: { venue: { $exists: true, $ne: '' } } },
      {
        $group: {
          _id: { $toLower: { $trim: { input: '$venue' } } },
          total: { $sum: 1 },
          upcoming: {
            $sum: {
              $cond: [
                { $or: [{ $gte: ['$endDate', now] }, { $gte: ['$startDate', now] }] },
                1,
                0
              ]
            }
          }
        }
      }
    ]).catch((aggErr) => {
      console.warn('[Venues] Count aggregation warning:', aggErr.message);
      return [];
    }),
    Review.aggregate([
      {
        $match: {
          venueSlug: { $exists: true, $ne: '' },
          status: { $in: ['approved', 'featured'] }
        }
      },
      {
        $group: {
          _id: { $toLower: { $trim: { input: '$venueSlug' } } },
          count: { $sum: 1 },
          averageRating: { $avg: '$rating' }
        }
      }
    ]).catch((reviewErr) => {
      console.warn('[Venues] Review aggregation warning:', reviewErr.message);
      return [];
    }),
    EventEngagement.aggregate([
      {
        $match: {
          actionType: 'follower',
          eventSlug: { $exists: true, $ne: '' }
        }
      },
      {
        $group: {
          _id: { $toLower: { $trim: { input: '$eventSlug' } } },
          count: { $sum: 1 }
        }
      }
    ]).catch(() => [])
  ]);

  // Build fast lookup map
  const countMap = new Map();
  countsAgg.forEach((c) => {
    if (c._id) {
      countMap.set(c._id, { total: c.total, upcoming: c.upcoming });
    }
  });

  const reviewMap = new Map();
  reviewAgg.forEach((r) => {
    if (r._id) {
      reviewMap.set(r._id, {
        count: r.count,
        averageRating: Math.round((r.averageRating || 0) * 10) / 10
      });
    }
  });

  const followerMap = new Map();
  followerAgg.forEach((f) => {
    if (f._id) {
      followerMap.set(f._id, f.count || 0);
    }
  });

  const enrichedVenues = venues
    .filter((v) => isValidRealVenueName(v.name, v.slug))
    .map((v) => {
      let liveTotal = 0;
      let liveUpcoming = 0;

      // Fast in-memory lookup using the exact same canonical matching rules as venue detail page
      for (const [vKey, stat] of countMap.entries()) {
        if (venueMatchesEventKey(v, vKey)) {
          liveTotal += stat.total;
          liveUpcoming += stat.upcoming;
        }
      }

      // Resolve genuine rating from live user reviews, verified external source, or unrated
      const slugKey = (v.slug || '').toLowerCase().trim();
      const liveReview = reviewMap.get(slugKey);

      let finalRating = 0;
      let finalCount = 0;
      let finalSource = '';

      if (liveReview && liveReview.count > 0) {
        finalRating = liveReview.averageRating;
        finalCount = liveReview.count;
        finalSource = 'VisitExpo Verified Reviews';
      } else if (v.ratingSource && v.ratingsCount > 0 && v.rating > 0 && v.ratingSource !== 'No reviews yet') {
        finalRating = v.rating;
        finalCount = v.ratingsCount;
        finalSource = v.ratingSource;
      } else {
        finalRating = 0;
        finalCount = 0;
        finalSource = 'No reviews yet';
      }

      return {
        ...v,
        rating: finalRating,
        ratingsCount: finalCount,
        ratingSource: finalSource,
        followersCount: String(followerMap.get(slugKey) || 0),
        liveFollowersCount: followerMap.get(slugKey) || 0,
        liveTotalEvents: liveTotal,
        liveUpcomingEvents: liveUpcoming,
        eventsHosted: String(liveTotal),
        upcomingEventsCount: String(liveUpcoming)
      };
    })
    .filter((v) => {
      // Hide unfeatured auto-generated 0-event dummy venues (e.g. legacy getVenueBySlug auto-creations)
      const isAutoDummy =
        v.liveTotalEvents === 0 &&
        !v.isFeatured &&
        /^Premier Convention & Exhibition Facility in India$/i.test(String(v.tagline || '').trim()) &&
        String(v.city || '').trim().toLowerCase() === 'india' &&
        String(v.country || '').trim().toLowerCase() === 'india';
      return !isAutoDummy;
    })
    .sort((a, b) => {
      if (Boolean(a.isFeatured) !== Boolean(b.isFeatured)) {
        return a.isFeatured ? -1 : 1;
      }
      const aStartsLetter = /^[a-zA-Z]/.test(String(a.name || '').trim());
      const bStartsLetter = /^[a-zA-Z]/.test(String(b.name || '').trim());
      if (aStartsLetter !== bStartsLetter) {
        return aStartsLetter ? -1 : 1;
      }
      if ((b.liveTotalEvents || 0) !== (a.liveTotalEvents || 0)) {
        return (b.liveTotalEvents || 0) - (a.liveTotalEvents || 0);
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

  const responsePayload = {
    success: true,
    count: enrichedVenues.length,
    data: enrichedVenues
  };

  venuesCache = {
    data: responsePayload,
    timestamp: Date.now(),
    ttl: 15 * 60 * 1000
  };

  // Run background venue discovery if count is low without blocking request
  if (venues.length < 5) {
    syncDiscoveredVenuesFromEvents().catch(() => {});
  }

  return responsePayload;
}

export async function warmVenuesCache() {
  try {
    if (venuesCache.data && (Date.now() - venuesCache.timestamp < venuesCache.ttl)) {
      return venuesCache.data;
    }
    if (!venuesInFlight) {
      venuesInFlight = _computeAllVenuesPayload().finally(() => {
        venuesInFlight = null;
      });
    }
    return await venuesInFlight;
  } catch (err) {
    console.warn('[Venues] Boot warm cache failed:', err.message);
    return null;
  }
}

/**
 * GET /api/venues
 * Get all venues with live total and upcoming event counts.
 */
export async function getAllVenues(req, res) {
  try {
    const force = req.query.force === 'true';
    const nowMs = Date.now();
    if (!force && venuesCache.data && (nowMs - venuesCache.timestamp < venuesCache.ttl)) {
      return res.status(200).json(venuesCache.data);
    }

    // Serve stale immediately while refreshing in background so UI never stalls
    if (!force && venuesCache.data) {
      if (!venuesInFlight) {
        venuesInFlight = _computeAllVenuesPayload()
          .catch((err) => {
            console.warn('[Venues] Background refresh failed:', err.message);
            return venuesCache.data;
          })
          .finally(() => {
            venuesInFlight = null;
          });
      }
      return res.status(200).json(venuesCache.data);
    }

    if (!venuesInFlight) {
      venuesInFlight = _computeAllVenuesPayload().finally(() => {
        venuesInFlight = null;
      });
    }

    const responsePayload = await venuesInFlight;
    return res.status(200).json(responsePayload);
  } catch (err) {
    console.error('[Venues] Error in getAllVenues:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve venues',
      error: err.message
    });
  }
}

/**
 * GET /api/venues/:slug
 * Get a single venue by slug or ID with its matching live events and dynamic real-time metrics.
 */
export async function getVenueBySlug(req, res) {
  try {
    const { slug } = req.params;
    let decodedRaw = String(slug || '').trim();
    try {
      decodedRaw = decodeURIComponent(decodedRaw);
    } catch {}
    const cleanSlug = slugify(decodedRaw);

    // Reject spam/URL/garbage slugs immediately — NEVER auto-create dummy venues on GET requests
    if (!cleanSlug || !isValidRealVenueName(decodedRaw.replace(/-/g, ' '), cleanSlug)) {
      return res.status(404).json({
        success: false,
        message: `Venue '${slug}' not found`
      });
    }

    let venue = await Venue.findOne({
      $or: [
        { slug: cleanSlug },
        { _id: /^[0-9a-fA-F]{24}$/.test(decodedRaw) ? decodedRaw : null }
      ].filter(Boolean)
    });

    // Fallback to curated default venues if not yet stored
    if (!venue) {
      const defaultVenue = DEFAULT_VENUES.find((d) => d.slug === cleanSlug);
      if (defaultVenue) {
        venue = await Venue.create(defaultVenue);
      }
    }

    // Fallback: resolve sub-hall / entrance variant (e.g. "excel-london-hall-n22") to its canonical parent venue
    if (!venue) {
      const strippedName = stripVenueSubLocation(decodedRaw.replace(/-/g, ' '));
      const parentSlug = slugify(strippedName);
      if (parentSlug && parentSlug !== cleanSlug && isValidRealVenueName(strippedName, parentSlug)) {
        venue = await Venue.findOne({
          $or: [
            { slug: parentSlug },
            { shortName: { $regex: `^${escapeRegex(strippedName)}$`, $options: 'i' } },
            { name: { $regex: `^${escapeRegex(strippedName)}$`, $options: 'i' } }
          ]
        });
      }
    }

    // Strict case-insensitive exact name/shortName lookup (never loose wildcard creation)
    if (!venue) {
      const nameExact = decodedRaw.replace(/-/g, ' ').trim();
      if (nameExact.length >= 4) {
        venue = await Venue.findOne({
          $or: [
            { name: { $regex: `^${escapeRegex(nameExact)}$`, $options: 'i' } },
            { shortName: { $regex: `^${escapeRegex(nameExact)}$`, $options: 'i' } }
          ]
        });
      }
    }

    if (!venue || !isValidRealVenueName(venue.name, venue.slug)) {
      return res.status(404).json({
        success: false,
        message: `Venue '${slug}' not found`
      });
    }

    const eventQueryConditions = buildVenueEventQuery(venue);
    const liveEvents =
      eventQueryConditions.length > 0
        ? await Event.find({
            $or: eventQueryConditions
          })
            .select('_id slug title name startDate endDate dates category categories image banner city venue address attendeesCount expectedAttendees turnout')
            .sort({ startDate: 1 })
            .lean()
        : [];

    const now = new Date();
    const upcomingCount = liveEvents.filter((e) => {
      const end = e.endDate ? new Date(e.endDate) : (e.startDate ? new Date(e.startDate) : null);
      return !end || end >= now;
    }).length;

    // Dynamically calculate dominant category from actual live database events
    const categoryFreq = {};
    liveEvents.forEach((ev) => {
      const cat = ev.category || (Array.isArray(ev.categories) ? ev.categories[0] : ev.categories);
      if (cat && typeof cat === 'string') {
        const trimmed = cat.trim();
        categoryFreq[trimmed] = (categoryFreq[trimmed] || 0) + 1;
      }
    });
    const sortedCats = Object.entries(categoryFreq).sort((a, b) => b[1] - a[1]);
    const dynamicCategory = sortedCats.length > 0 ? sortedCats[0][0] : (venue.bestSuited || 'Industrial & Trade Expos');

    // Dynamically calculate live reviews and ratings aggregate
    let reviewCount = 0;
    let averageRating = 0;
    try {
      const reviewAgg = await Review.aggregate([
        {
          $match: {
            $or: [
              { venueSlug: venue.slug },
              { targetSlug: venue.slug },
              { venue: venue.name }
            ],
            status: { $in: ['approved', 'featured'] }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgRating: { $avg: '$rating' }
          }
        }
      ]);
      if (reviewAgg.length > 0) {
        reviewCount = reviewAgg[0].count;
        averageRating = Math.round(reviewAgg[0].avgRating * 10) / 10;
      }
    } catch (_) {}

    // Dynamically calculate real follower count from EventEngagement
    let liveFollowersCount = 0;
    try {
      liveFollowersCount = await EventEngagement.countDocuments({
        actionType: 'follower',
        $or: [
          { eventSlug: venue.slug },
          { eventVenue: { $regex: `^${venue.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
        ]
      });
    } catch (_) {}

    const resolvedState = venue.state || (venue.city === 'New Delhi' || (venue.slug && (venue.slug.includes('mandapam') || venue.slug.includes('pragati'))) ? 'Delhi' : '') || venue.city || 'India';

    const dynamicVenue = {
      ...(venue.toObject ? venue.toObject() : venue),
      state: resolvedState,
      followersCount: String(liveFollowersCount),
      liveFollowersCount,
      liveTotalEvents: liveEvents.length,
      liveUpcomingEvents: upcomingCount,
      eventsHosted: String(liveEvents.length),
      upcomingEventsCount: String(upcomingCount),
      bestSuited: dynamicCategory,
      rating: reviewCount > 0 ? averageRating : 0,
      ratingsCount: reviewCount,
      ratingSource: reviewCount > 0 ? 'VisitExpo Verified Reviews' : 'No reviews yet'
    };

    res.status(200).json({
      success: true,
      data: dynamicVenue,
      events: liveEvents
    });
  } catch (err) {
    console.error('[Venues] Error in getVenueBySlug:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve venue',
      error: err.message
    });
  }
}

/**
 * POST /api/venues
 * Create a new venue.
 */
export async function createVenue(req, res) {
  try {
    const data = req.body;
    if (!data.name || !isValidRealVenueName(data.name, data.slug || '')) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid exhibition venue name (URLs, standalone hall labels, and placeholder names are not allowed).'
      });
    }

    const slug = data.slug ? slugify(data.slug) : slugify(data.name);

    // Check duplicate
    const existing = await Venue.findOne({ slug });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A venue with slug '${slug}' already exists.`
      });
    }

    const plainDesc = String(data.overviewDescription || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const cityPart = data.city ? ` in ${data.city}` : '';
    const incomingSeo = data.seo && typeof data.seo === 'object' ? data.seo : {};
    const defaultSeoTitle = `${data.name}${cityPart} — Upcoming Expos & Venue Guide | VisitExpo`;
    const defaultMetaDesc =
      plainDesc.slice(0, 155) ||
      `Explore upcoming trade shows, hall capacities, nearby hotels, and transit directions for ${data.name}${cityPart} on VisitExpo.`;

    const newVenue = await Venue.create({
      ...data,
      slug,
      shortName: data.shortName || data.name.split(',')[0],
      gallery: Array.isArray(data.gallery) ? data.gallery : [],
      status: data.status === 'draft' ? 'draft' : 'published',
      visibility: data.visibility === 'private' ? 'private' : 'public',
      venueCategories: Array.isArray(data.venueCategories) ? data.venueCategories : [],
      seo: {
        seoTitle: incomingSeo.seoTitle || defaultSeoTitle,
        metaDescription: incomingSeo.metaDescription || defaultMetaDesc,
        focusKeyword: incomingSeo.focusKeyword || data.name,
        relatedKeyphrases: Array.isArray(incomingSeo.relatedKeyphrases) ? incomingSeo.relatedKeyphrases : [],
        isCornerstone: Boolean(incomingSeo.isCornerstone),
        canonicalUrl: incomingSeo.canonicalUrl || '',
        metaRobotsIndex: incomingSeo.metaRobotsIndex === 'noindex' ? 'noindex' : 'index',
        metaRobotsFollow: incomingSeo.metaRobotsFollow === 'nofollow' ? 'nofollow' : 'follow'
      }
    });

    invalidateVenuesCache();

    res.status(201).json({
      success: true,
      message: 'Venue created successfully',
      data: newVenue
    });
  } catch (err) {
    console.error('[Venues] Error in createVenue:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create venue',
      error: err.message
    });
  }
}

/**
 * PUT /api/venues/:slug
 * Update an existing venue's details and/or images.
 */
export async function updateVenue(req, res) {
  try {
    const { slug } = req.params;
    const updates = req.body;

    let venue = await Venue.findOne({
      $or: [{ slug: slug.toLowerCase() }, { _id: slug.match(/^[0-9a-fA-F]{24}$/) ? slug : null }]
    });

    // If venue only existed in default venues data, create it first
    if (!venue) {
      const defaultVenue = DEFAULT_VENUES.find((d) => d.slug === slug.toLowerCase());
      if (defaultVenue) {
        venue = await Venue.create({ ...defaultVenue, ...updates });
        invalidateVenuesCache();
        return res.status(200).json({
          success: true,
          message: 'Venue customized and saved successfully',
          data: venue
        });
      }
      return res.status(404).json({ success: false, message: `Venue '${slug}' not found` });
    }

    // Handle optional custom slug update if unique
    if (updates.slug && slugify(updates.slug) !== venue.slug) {
      const nextSlug = slugify(updates.slug);
      if (nextSlug) {
        const collision = await Venue.findOne({ slug: nextSlug, _id: { $ne: venue._id } });
        if (!collision) {
          venue.slug = nextSlug;
        }
      }
    }

    // Update fields
    const allowedFields = [
      'name',
      'shortName',
      'tagline',
      'city',
      'state',
      'country',
      'address',
      'metro',
      'airportDistance',
      'heroBanner',
      'logoThumbnail',
      'gallery',
      'overviewDescription',
      'totalArea',
      'builtYear',
      'renovatedYear',
      'meetingRooms',
      'rating',
      'eventsHosted',
      'upcomingEventsCount',
      'isFeatured',
      'status',
      'visibility',
      'venueCategories',
      'seo'
    ];

    allowedFields.forEach((field) => {
      if (updates[field] !== undefined) {
        venue[field] = updates[field];
      }
    });

    await venue.save();
    invalidateVenuesCache();

    res.status(200).json({
      success: true,
      message: 'Venue updated successfully',
      data: venue
    });
  } catch (err) {
    console.error('[Venues] Error in updateVenue:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update venue',
      error: err.message
    });
  }
}

/**
 * POST /api/venues/:slug/images
 * Add image(s) to a venue gallery or update heroBanner / logoThumbnail.
 */
export async function addVenueImages(req, res) {
  try {
    const { slug } = req.params;
    const { imageUrl, imageUrls, type } = req.body;

    let venue = await Venue.findOne({
      $or: [{ slug: slug.toLowerCase() }, { _id: slug.match(/^[0-9a-fA-F]{24}$/) ? slug : null }]
    });

    if (!venue) {
      const defaultVenue = DEFAULT_VENUES.find((d) => d.slug === slug.toLowerCase());
      if (defaultVenue) {
        venue = await Venue.create(defaultVenue);
      } else {
        return res.status(404).json({ success: false, message: 'Venue not found' });
      }
    }

    if (type === 'banner' && imageUrl) {
      venue.heroBanner = imageUrl;
    } else if (type === 'logo' && imageUrl) {
      venue.logoThumbnail = imageUrl;
    } else {
      // Append to gallery
      const toAdd = Array.isArray(imageUrls) ? imageUrls : imageUrl ? [imageUrl] : [];
      const currentGallery = Array.isArray(venue.gallery) ? venue.gallery : [];
      toAdd.forEach((img) => {
        if (img && typeof img === 'string' && !currentGallery.includes(img)) {
          currentGallery.push(img.trim());
        }
      });
      venue.gallery = currentGallery;
    }

    await venue.save();
    invalidateVenuesCache();

    res.status(200).json({
      success: true,
      message: 'Venue images updated successfully',
      data: venue
    });
  } catch (err) {
    console.error('[Venues] Error in addVenueImages:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to add venue images',
      error: err.message
    });
  }
}

/**
 * DELETE /api/venues/:slug/images
 * Remove a specific image URL from the venue's gallery.
 */
export async function removeVenueImage(req, res) {
  try {
    const { slug } = req.params;
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ success: false, message: 'Image URL is required' });
    }

    const venue = await Venue.findOne({
      $or: [{ slug: slug.toLowerCase() }, { _id: slug.match(/^[0-9a-fA-F]{24}$/) ? slug : null }]
    });

    if (!venue) {
      return res.status(404).json({ success: false, message: 'Venue not found' });
    }

    venue.gallery = (venue.gallery || []).filter((img) => img !== imageUrl);
    await venue.save();
    invalidateVenuesCache();

    res.status(200).json({
      success: true,
      message: 'Image removed from gallery',
      data: venue
    });
  } catch (err) {
    console.error('[Venues] Error in removeVenueImage:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to remove venue image',
      error: err.message
    });
  }
}

/**
 * @desc Get nearby hotels for a specific venue
 * @route GET /api/venues/:slug/hotels
 * @access Public
 */
export const getVenueHotels = async (req, res) => {
  try {
    const { slug } = req.params;
    const cleanSlug = (slug || '').toLowerCase().trim();
    let venue = await Venue.findOne({ slug: cleanSlug });
    if (!venue) {
      venue = {
        slug: cleanSlug,
        name: cleanSlug.replace(/-/g, ' '),
        shortName: cleanSlug.replace(/-/g, ' '),
        city: 'India',
        address: cleanSlug.replace(/-/g, ' ')
      };
    }
    const hotels = getNearbyHotelsForVenue(venue);
    return res.status(200).json({
      success: true,
      count: hotels.length,
      data: hotels
    });
  } catch (err) {
    console.error('[Venues] Error in getVenueHotels:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve nearby hotels'
    });
  }
};

/**
 * @desc Get real dynamic exhibition events hosted at a specific venue
 * @route GET /api/venues/:slug/events
 * @access Public
 */
export const getVenueEvents = async (req, res) => {
  try {
    const { slug } = req.params;
    let decodedRaw = String(slug || '').trim();
    try {
      decodedRaw = decodeURIComponent(decodedRaw);
    } catch {}
    const cleanSlug = slugify(decodedRaw);

    if (!cleanSlug || !isValidRealVenueName(decodedRaw.replace(/-/g, ' '), cleanSlug)) {
      return res.status(404).json({
        success: false,
        count: 0,
        data: [],
        events: [],
        message: `Venue '${slug}' not found`
      });
    }

    let venue = await Venue.findOne({
      $or: [
        { slug: cleanSlug },
        { _id: /^[0-9a-fA-F]{24}$/.test(decodedRaw) ? decodedRaw : null }
      ].filter(Boolean)
    });

    if (!venue) {
      const strippedName = stripVenueSubLocation(decodedRaw.replace(/-/g, ' '));
      const parentSlug = slugify(strippedName);
      if (parentSlug && parentSlug !== cleanSlug && isValidRealVenueName(strippedName, parentSlug)) {
        venue = await Venue.findOne({
          $or: [
            { slug: parentSlug },
            { shortName: { $regex: `^${escapeRegex(strippedName)}$`, $options: 'i' } },
            { name: { $regex: `^${escapeRegex(strippedName)}$`, $options: 'i' } }
          ]
        });
      }
    }

    if (!venue) {
      const nameExact = decodedRaw.replace(/-/g, ' ').trim();
      if (nameExact.length >= 4) {
        venue = await Venue.findOne({
          $or: [
            { name: { $regex: `^${escapeRegex(nameExact)}$`, $options: 'i' } },
            { shortName: { $regex: `^${escapeRegex(nameExact)}$`, $options: 'i' } }
          ]
        });
      }
    }

    if (!venue || !isValidRealVenueName(venue.name, venue.slug)) {
      return res.status(404).json({
        success: false,
        count: 0,
        data: [],
        events: [],
        message: `Venue '${slug}' not found`
      });
    }

    const eventQueryConditions = buildVenueEventQuery(venue);
    const liveEvents =
      eventQueryConditions.length > 0
        ? await Event.find({
            $or: eventQueryConditions
          })
            .select('_id slug title name startDate endDate dates category categories image banner city venue address attendeesCount expectedAttendees turnout')
            .sort({ startDate: 1 })
            .lean()
        : [];

    return res.status(200).json({
      success: true,
      count: liveEvents.length,
      data: liveEvents,
      events: liveEvents
    });
  } catch (err) {
    console.error('[Venues] Error in getVenueEvents:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve venue events',
      error: err.message
    });
  }
};
