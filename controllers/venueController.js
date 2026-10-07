/**
 * @file venueController.js
 * @description Controller for venue profiles, gallery media management, and event aggregations.
 */

import Venue from '../models/Venue.js';
import Event from '../models/Event.js';
import { DEFAULT_VENUES } from '../data/defaultVenues.js';

// Helper to normalize strings into URL-safe slugs
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Ensures initial default venues are seeded into MongoDB.
 */
async function ensureDefaultVenuesSeeded() {
  const count = await Venue.countDocuments();
  if (count === 0) {
    try {
      await Venue.insertMany(DEFAULT_VENUES);
      console.log(`[Venues] Initialized ${DEFAULT_VENUES.length} default exhibition complexes into MongoDB.`);
    } catch (err) {
      console.warn('[Venues] Seeding initial venues note:', err.message);
    }
  }
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
      const rawName = String(ev._id).trim();
      if (!rawName || rawName.length < 3) continue;

      const slug = slugify(rawName);
      const existing = await Venue.findOne({
        $or: [{ slug }, { name: rawName }]
      });

      if (!existing && !DEFAULT_VENUES.some((d) => d.slug === slug)) {
        await Venue.create({
          slug,
          name: rawName,
          shortName: rawName.split(',')[0],
          tagline: `Convention & Exhibition Facility in ${ev.city || 'India'}`,
          city: ev.city || 'India',
          country: ev.country || 'India',
          address: ev.address || `${rawName}, ${ev.city || ''}, ${ev.country || 'India'}`,
          heroBanner:
            ev.sampleImage ||
            'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=1600&auto=format&fit=crop',
          logoThumbnail:
            'https://images.unsplash.com/photo-1541971875076-8f970d573be6?q=80&w=300&auto=format&fit=crop',
          gallery: ev.sampleImage ? [ev.sampleImage] : [],
          eventsHosted: `${ev.eventCount}+`,
          rating: 4.8,
          overviewDescription: `${rawName} is a prominent venue host for conferences, exhibitions, and trade shows.`
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

export function invalidateVenuesCache() {
  venuesCache.data = null;
  venuesCache.timestamp = 0;
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

    await ensureDefaultVenuesSeeded();

    // Query all venues from MongoDB
    const venues = await Venue.find().sort({ isFeatured: -1, name: 1 }).lean();
    const now = new Date();

    // Compute live event counts for all venues in a single fast aggregation
    let countsAgg = [];
    try {
      countsAgg = await Event.aggregate([
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
      ]);
    } catch (aggErr) {
      console.warn('[Venues] Count aggregation warning:', aggErr.message);
    }

    // Build fast lookup map
    const countMap = new Map();
    countsAgg.forEach((c) => {
      if (c._id) {
        countMap.set(c._id, { total: c.total, upcoming: c.upcoming });
      }
    });

    const enrichedVenues = venues.map((v) => {
      const vShort = (v.shortName || v.name || '').toLowerCase().trim();
      const vName = (v.name || '').toLowerCase().trim();
      
      let liveTotal = 0;
      let liveUpcoming = 0;

      // Fast in-memory lookup
      for (const [vKey, stat] of countMap.entries()) {
        if (vKey === vShort || vKey === vName || (vShort.length > 4 && vKey.includes(vShort)) || (vName.length > 5 && vKey.includes(vName))) {
          liveTotal += stat.total;
          liveUpcoming += stat.upcoming;
        }
      }

      return {
        ...v,
        liveTotalEvents: Math.max(liveTotal, parseInt(v.eventsHosted, 10) || 0),
        liveUpcomingEvents: liveUpcoming > 0 ? liveUpcoming : parseInt(v.upcomingEventsCount, 10) || 0
      };
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
 * Get a single venue by slug or ID with its matching live events.
 */
export async function getVenueBySlug(req, res) {
  try {
    const { slug } = req.params;
    let venue = await Venue.findOne({
      $or: [{ slug: slug.toLowerCase() }, { _id: slug.match(/^[0-9a-fA-F]{24}$/) ? slug : null }]
    });

    // Fallback to default venues if not found
    if (!venue) {
      const defaultVenue = DEFAULT_VENUES.find((d) => d.slug === slug.toLowerCase());
      if (defaultVenue) {
        venue = await Venue.create(defaultVenue);
      }
    }

    if (!venue) {
      return res.status(404).json({
        success: false,
        message: `Venue '${slug}' not found`
      });
    }

    const vShort = (venue.shortName || venue.name).trim();
    const liveEvents = await Event.find({
      $or: [
        { venue: { $regex: vShort, $options: 'i' } },
        { address: { $regex: vShort, $options: 'i' } }
      ]
    }).sort({ startDate: 1 });

    res.status(200).json({
      success: true,
      data: venue,
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
    if (!data.name) {
      return res.status(400).json({ success: false, message: 'Venue name is required' });
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

    const newVenue = await Venue.create({
      ...data,
      slug,
      shortName: data.shortName || data.name.split(',')[0],
      gallery: Array.isArray(data.gallery) ? data.gallery : []
    });

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
        return res.status(200).json({
          success: true,
          message: 'Venue customized and saved successfully',
          data: venue
        });
      }
      return res.status(404).json({ success: false, message: `Venue '${slug}' not found` });
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
      'isFeatured'
    ];

    allowedFields.forEach((field) => {
      if (updates[field] !== undefined) {
        venue[field] = updates[field];
      }
    });

    await venue.save();

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
