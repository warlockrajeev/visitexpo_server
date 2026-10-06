/**
 * @file eventRoutes.js
 * @description Event management and WordPress consumption endpoints.
 */

import express from 'express';
import EventService from '../services/EventService.js';
import Ticket from '../models/Ticket.js';
import Visitor from '../models/Visitor.js';
import Exhibitor from '../models/Exhibitor.js';
import Lead from '../models/Lead.js';
import Campaign from '../models/Campaign.js';
import Session from '../models/Session.js';
import EventEngagement from '../models/EventEngagement.js';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import DeletedOrganizer from '../models/DeletedOrganizer.js';
import DeletedEvent from '../models/DeletedEvent.js';
import { getAggregatedOrganizers } from './adminRoutes.js';
import { protect, authorize } from '../middlewares/auth.js';
import { wordpressLimiter } from '../middlewares/rateLimiter.js';
import { syncEventToWordPress } from '../services/WordPressSyncService.js';
import { fetchLiveWpDirectoryEvents, normalizeTitle } from '../utils/directoryEventsHelper.js';
import RecommendationService from '../services/RecommendationService.js';
import WordPressDirectorySyncService from '../services/WordPressDirectorySyncService.js';
import { verifyAccessToken } from '../utils/jwt.js';

const router = express.Router();

/**
 * Helper: Auto-create or update the default ticket tier for an event
 * based on the isFreeEvent / paidTicketPrice fields from the wizard or edit form.
 */
async function syncDefaultTicketTier(eventId, body) {
  // Only process if ticketing data is explicitly provided
  if (body.isFreeEvent === undefined && body.paidTicketPrice === undefined) return;

  const isFree = body.isFreeEvent === true || body.isFreeEvent === 'true';
  const price = isFree ? 0 : (parseInt(body.paidTicketPrice, 10) || 0);
  const type = isFree ? 'free' : (price > 0 ? 'paid' : 'free');
  const currency = body.currency || 'INR';

  // Look for an existing default ticket for this event
  let ticket = await Ticket.findOne({ event: eventId, title: { $in: ['Default Entry Pass', 'General Admission', 'Visitor Pass'] } });

  if (ticket) {
    // Update existing default tier
    ticket.type = type;
    ticket.price = price;
    ticket.currency = currency;
    ticket.title = isFree ? 'Visitor Pass' : 'General Admission';
    ticket.description = isFree
      ? 'Complimentary visitor registration pass'
      : `Standard paid entry ticket — ${currency} ${price}`;
    await ticket.save();
  } else {
    // Create new default tier
    await Ticket.create({
      title: isFree ? 'Visitor Pass' : 'General Admission',
      description: isFree
        ? 'Complimentary visitor registration pass'
        : `Standard paid entry ticket — ${currency} ${price}`,
      type,
      price,
      currency,
      capacity: body.ticketCapacity || 1000,
      event: eventId
    });
  }
}

// ==========================================
// PUBLIC WORDPRESS / FRONTEND CONSUMPTION APIS
// ==========================================

// Get events list with pagination, search, sorting and filtering
router.get('/', wordpressLimiter, async (req, res, next) => {
  try {
    const { search, category, city, venue, page, limit, sort, organizerId, status, all } = req.query;
    
    const filters = { search, category, city, venue, organizerId, status, all };
    
    // Default options
    const options = {
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 1000,
      sort: sort ? (typeof sort === 'string' ? (sort.startsWith('{') ? JSON.parse(sort) : { [sort]: 1 }) : sort) : { startDate: 1 },
      populate: 'organizer'
    };

    const data = await EventService.queryEvents(filters, options);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// Distinct list of categories
router.get('/categories', wordpressLimiter, async (req, res, next) => {
  try {
    const categories = await EventService.getCategories();
    res.status(200).json({ success: true, categories });
  } catch (error) {
    next(error);
  }
});

// Distinct list of cities
router.get('/cities', wordpressLimiter, async (req, res, next) => {
  try {
    const cities = await EventService.getCities();
    res.status(200).json({ success: true, cities });
  } catch (error) {
    next(error);
  }
});

// Distinct list of organizers with event counts
router.get('/organizers', wordpressLimiter, async (req, res, next) => {
  try {
    const organizers = await EventService.getOrganizers();
    res.status(200).json({ success: true, organizers });
  } catch (error) {
    next(error);
  }
});

// Distinct list of venues with total and upcoming event counts
router.get('/venues', wordpressLimiter, async (req, res, next) => {
  try {
    const venues = await EventService.getVenues();
    res.status(200).json({ success: true, venues });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// RECOMMENDATION ENGINE ENDPOINTS
// ==========================================

// Get personalized or criteria-based event recommendations
router.get('/recommendations', async (req, res, next) => {
  try {
    const { location, interests, lat, lng, exclude, limit, timeframe } = req.query;

    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const decoded = verifyAccessToken(authHeader.split(' ')[1]);
      if (decoded?.id) userId = decoded.id;
    }

    const result = await RecommendationService.getRecommendations({
      location,
      interests,
      lat,
      lng,
      userId,
      excludeEventId: exclude,
      limit: parseInt(limit, 10) || 10,
      timeframe: timeframe || 'upcoming'
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// Metadata endpoint for recommendation filters (cities, categories, curated interest sectors)
router.get('/recommendations/meta', async (req, res, next) => {
  try {
    const meta = await RecommendationService.getRecommendationMeta();
    res.status(200).json(meta);
  } catch (error) {
    next(error);
  }
});

// Save user recommendation preferences (cities & interests)
router.post('/recommendations/preferences', protect, async (req, res, next) => {
  try {
    const { interests, preferredLocations } = req.body;
    const updated = await RecommendationService.saveUserPreferences(req.user._id, {
      interests,
      preferredLocations
    });
    res.status(200).json({ success: true, message: 'Recommendation preferences updated', data: updated });
  } catch (error) {
    next(error);
  }
});

// List of deleted organizers (excluded from aggregations)
router.get('/deleted-organizers', async (req, res, next) => {
  try {
    const deleted = await DeletedOrganizer.find().lean();
    res.status(200).json({
      success: true,
      data: (deleted || []).map(d => ({ name: d.name, slugId: d.slugId }))
    });
  } catch (error) {
    next(error);
  }
});

// List of deleted events (excluded from aggregations and frontend listings)
router.get('/deleted-events', async (req, res, next) => {
  try {
    const deleted = await DeletedEvent.find().lean();
    res.status(200).json({
      success: true,
      data: (deleted || []).map(d => ({
        eventId: d.eventId,
        slug: d.slug,
        title: d.title,
        wpPostId: d.wpPostId
      }))
    });
  } catch (error) {
    next(error);
  }
});

// Unified exhibitions directory endpoint (aggregates all live WordPress and platform events)
router.get('/directory', async (req, res, next) => {
  try {
    const forceRefresh = req.query.refresh === 'true' || !!req.query.t;
    const data = await getAggregatedOrganizers(forceRefresh);
    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
});

// High-speed unified events directory endpoint (served directly from indexed MongoDB)
router.get('/all-directory', async (req, res, next) => {
  try {
    const forceRefresh = req.query.refresh === 'true' || !!req.query.t;
    const events = await WordPressDirectorySyncService.getFastStoredEvents({ forceRefresh });
    res.status(200).json({
      success: true,
      count: events.length,
      source: 'mongodb_atlas',
      events
    });
  } catch (error) {
    next(error);
  }
});

// Trigger immediate background sync of WordPress events into MongoDB
router.post('/sync-wordpress', async (req, res, next) => {
  try {
    const result = await WordPressDirectorySyncService.syncWordPressEventsToMongoDB({ force: true });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// Featured events
router.get('/featured-events', wordpressLimiter, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 5;
    const events = await EventService.getFeaturedEvents(limit);
    res.status(200).json({ success: true, events });
  } catch (error) {
    next(error);
  }
});

// Upcoming events
router.get('/upcoming-events', wordpressLimiter, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 5;
    const events = await EventService.getUpcomingEvents(limit);
    res.status(200).json({ success: true, events });
  } catch (error) {
    next(error);
  }
});

// Check if event title already exists across MongoDB and live WordPress directory
router.get('/check-duplicate', async (req, res, next) => {
  try {
    const { title, excludeId } = req.query;
    if (!title || !title.trim()) {
      return res.status(200).json({
        success: true,
        isDuplicate: false,
        existingEvent: null,
        similarEvents: []
      });
    }

    const cleanTitle = title.trim();
    const queryNorm = normalizeTitle(cleanTitle);
    const escapedTitle = cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. Exclude permanently deleted events if any
    let deletedTitles = new Set();
    let deletedSlugs = new Set();
    let deletedIds = new Set();
    try {
      const deleted = await DeletedEvent.find().select('slug title eventId').lean();
      deleted.forEach(d => {
        if (d.title) deletedTitles.add(normalizeTitle(d.title));
        if (d.slug) deletedSlugs.add(d.slug.toLowerCase().trim());
        if (d.eventId) deletedIds.add(String(d.eventId).toLowerCase().trim());
      });
    } catch {}

    // Look up the event being excluded to also exclude its WordPress mirror
    let excludedEvent = null;
    if (excludeId && mongoose.isValidObjectId(excludeId)) {
      try {
        excludedEvent = await Event.findById(excludeId).select('title slug wpPostId').lean();
      } catch (err) {
        console.warn('Error fetching excluded event for duplicate check:', err);
      }
    }

    // 2. Query MongoDB Event collection
    const exactQuery = {
      title: { $regex: new RegExp(`^${escapedTitle}$`, 'i') }
    };
    if (excludeId && mongoose.isValidObjectId(excludeId)) {
      exactQuery._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
    }

    let exactMatch = await Event.findOne(exactQuery)
      .populate('organizer', 'name logo website email')
      .lean();

    if (exactMatch && (deletedTitles.has(normalizeTitle(exactMatch.title)) || deletedSlugs.has(exactMatch.slug))) {
      exactMatch = null;
    }

    if (exactMatch) {
      return res.status(200).json({
        success: true,
        isDuplicate: true,
        existingEvent: {
          _id: exactMatch._id,
          title: exactMatch.title,
          slug: exactMatch.slug,
          city: exactMatch.city,
          venue: exactMatch.venue,
          startDate: exactMatch.startDate,
          endDate: exactMatch.endDate,
          status: exactMatch.status,
          banner: exactMatch.banner,
          organizer: exactMatch.organizer,
          orgName: exactMatch.orgName || exactMatch.organizer?.name || 'VisitExpo Organizer',
          isClaimed: exactMatch.isClaimed,
          source: 'platform'
        },
        similarEvents: []
      });
    }

    // 3. Query Live WordPress Directory (2000+ events including Impressions Expo)
    const wpDocs = await fetchLiveWpDirectoryEvents();
    if (Array.isArray(wpDocs) && wpDocs.length > 0) {
      const wpExact = wpDocs.find(doc => {
        if (deletedTitles.has(normalizeTitle(doc.title)) || deletedSlugs.has(doc.slug) || deletedIds.has(String(doc.id))) {
          return false;
        }
        if (excludeId) {
          if (String(doc.id) === String(excludeId) || doc.slug === String(excludeId)) {
            return false;
          }
          if (excludedEvent) {
            if (excludedEvent.wpPostId && String(doc.id) === String(excludedEvent.wpPostId)) {
              return false;
            }
            if (excludedEvent.slug && (doc.slug || '').toLowerCase().trim() === excludedEvent.slug.toLowerCase().trim()) {
              return false;
            }
            if (excludedEvent.title && normalizeTitle(doc.title) === normalizeTitle(excludedEvent.title)) {
              return false;
            }
          }
        }
        const docNorm = normalizeTitle(doc.title);
        const docSlug = (doc.slug || '').toLowerCase().trim();
        const generatedSlug = cleanTitle.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
        
        return docNorm === queryNorm || docSlug === generatedSlug || doc.title.toLowerCase().trim() === cleanTitle.toLowerCase();
      });

      if (wpExact) {
        return res.status(200).json({
          success: true,
          isDuplicate: true,
          existingEvent: {
            _id: String(wpExact.id || wpExact._id),
            title: wpExact.title,
            slug: wpExact.slug,
            city: wpExact.city || 'India',
            venue: wpExact.venue || 'Exhibition Center',
            startDate: wpExact.startDate,
            endDate: wpExact.endDate,
            status: 'published',
            banner: wpExact.banner || null,
            organizer: null,
            orgName: 'VisitExpo Live Directory',
            isClaimed: false,
            source: 'wordpress'
          },
          similarEvents: []
        });
      }
    }

    // 4. Find Similar Events (partial matches from MongoDB and WordPress)
    let similarEvents = [];
    if (cleanTitle.length >= 3) {
      const similarQuery = {
        title: { $regex: escapedTitle, $options: 'i' }
      };
      if (excludeId && mongoose.isValidObjectId(excludeId)) {
        similarQuery._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
      }

      const matches = await Event.find(similarQuery)
        .select('title slug city venue startDate endDate status banner orgName isClaimed')
        .limit(3)
        .lean();

      similarEvents = (matches || []).filter(m => !deletedTitles.has(normalizeTitle(m.title)));

      if (similarEvents.length < 3 && Array.isArray(wpDocs)) {
        const lowerClean = cleanTitle.toLowerCase();
        const wpMatches = wpDocs.filter(d => {
          if (deletedTitles.has(normalizeTitle(d.title)) || deletedSlugs.has(d.slug) || deletedIds.has(String(d.id))) {
            return false;
          }
          if (excludeId) {
            if (String(d.id) === String(excludeId) || d.slug === String(excludeId)) {
              return false;
            }
            if (excludedEvent) {
              if (excludedEvent.wpPostId && String(d.id) === String(excludedEvent.wpPostId)) {
                return false;
              }
              if (excludedEvent.slug && (d.slug || '').toLowerCase().trim() === excludedEvent.slug.toLowerCase().trim()) {
                return false;
              }
              if (excludedEvent.title && normalizeTitle(d.title) === normalizeTitle(excludedEvent.title)) {
                return false;
              }
            }
          }
          return (
            d.title.toLowerCase().includes(lowerClean) &&
            !similarEvents.some(se => normalizeTitle(se.title) === normalizeTitle(d.title))
          );
        }).slice(0, 3 - similarEvents.length);

        similarEvents = [...similarEvents, ...wpMatches];
      }
    }

    return res.status(200).json({
      success: true,
      isDuplicate: false,
      existingEvent: null,
      similarEvents
    });
  } catch (error) {
    next(error);
  }
});

// Get single event by slug
router.get('/:slug', wordpressLimiter, async (req, res, next) => {
  try {
    const event = await EventService.getEventBySlug(req.params.slug);
    res.status(200).json({ success: true, event });
  } catch (error) {
    next(error);
  }
});

/**
 * Helper to find event by either its MongoDB _id or URL slug
 */
async function findEventBySlugOrId(identifier) {
  if (mongoose.isValidObjectId(identifier)) {
    const byId = await Event.findById(identifier);
    if (byId) return byId;
  }
  return await Event.findOne({ slug: identifier });
}

// ==========================================
// VIRTUAL & HYBRID EVENT SUPPORT APIS
// ==========================================

// 1. Get complete Virtual Hub payload for an event (livestream, sessions, booths, stats)
router.get('/:slug/virtual-hub', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const event = await findEventBySlugOrId(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Fetch associated sessions
    let sessions = await Session.find({ event: event._id }).sort({ startTime: 1 }).lean();

    // Default mock virtual booths if none exist yet for demonstration
    let virtualBooths = (event.virtualBooths && event.virtualBooths.length > 0)
      ? event.virtualBooths
      : [
          {
            exhibitorName: 'Apex Robotics & Industrial Automation',
            boothNumber: 'VB-101',
            logo: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=200&q=80',
            banner: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&q=80',
            tagline: 'Next-Gen Autonomous Mobile Robots & Industrial Cobots',
            description: 'Apex Robotics is a global pioneer in automated guided vehicles, collaborative robotics, and AI-driven precision manufacturing solutions.',
            videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
            website: 'https://apexrobotics.example.com',
            contactEmail: 'booth@apexrobotics.example.com',
            contactPhone: '+1 (555) 382-9901',
            liveChatEnabled: true,
            products: [
              {
                name: 'Apex-Titan 500 Autonomous Pallet Mover',
                description: 'Heavy payload AMR featuring LiDAR SLAM navigation, 500kg lifting capacity, and 12-hour continuous battery life.',
                price: '$24,500',
                category: 'AMR & Material Handling',
                image: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=600&q=80',
                brochureUrl: 'https://example.com/spec-sheet-titan500.pdf'
              },
              {
                name: 'Synapse-7 Collaborative Robot Arm',
                description: '6-axis precision cobot with integrated force torque sensing, 0.02mm repeatability, and intuitive drag-to-teach programming.',
                price: '$18,900',
                category: 'Cobots',
                image: 'https://images.unsplash.com/photo-1563770660941-20978e870e26?w=600&q=80',
                brochureUrl: 'https://example.com/spec-sheet-synapse7.pdf'
              },
              {
                name: 'OmniVision 3D Vision Quality Inspector',
                description: 'High-speed AI computer vision scanner detecting microscopic surface defects down to 5 microns in real-time conveyor flow.',
                price: '$9,200',
                category: 'Quality Inspection',
                image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&q=80',
                brochureUrl: 'https://example.com/spec-sheet-omnivision.pdf'
              }
            ],
            boothVisits: 142
          },
          {
            exhibitorName: 'GreenPower EV Charging Solutions',
            boothNumber: 'VB-102',
            logo: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=200&q=80',
            banner: 'https://images.unsplash.com/photo-1558441719-8b489c63f732?w=1200&q=80',
            tagline: 'Ultra-Fast DC Fast Chargers & Smart Grid Energy Storage',
            description: 'Leading provider of turnkey commercial EV charging plazas, OCPP-compliant fleet charging management, and solar-coupled energy storage systems.',
            videoUrl: 'https://www.youtube.com/embed/ScMzIvxBSi4',
            website: 'https://greenpower.example.com',
            contactEmail: 'contact@greenpower.example.com',
            contactPhone: '+44 20 7946 0991',
            liveChatEnabled: true,
            products: [
              {
                name: 'HyperCharge 350kW Ultra-Fast DC Dispenser',
                description: 'Liquid-cooled dual-connector CCS2/CHAdeMO charging station capable of adding 300km range in under 12 minutes.',
                price: '$45,000',
                category: 'DC Fast Charging',
                image: 'https://images.unsplash.com/photo-1558441719-8b489c63f732?w=600&q=80',
                brochureUrl: 'https://example.com/hypercharge-brochure.pdf'
              },
              {
                name: 'FleetVolt Smart Energy Hub (1MWh BESS)',
                description: 'Modular containerized battery energy storage with dynamic peak shaving, grid backup, and solar integration.',
                price: '$180,000',
                category: 'Commercial Storage',
                image: 'https://images.unsplash.com/photo-1497435334941-8c899ee9e8e9?w=600&q=80',
                brochureUrl: 'https://example.com/fleetvolt-specs.pdf'
              }
            ],
            boothVisits: 98
          },
          {
            exhibitorName: 'CyberShield Cloud & Zero Trust Security',
            boothNumber: 'VB-103',
            logo: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=200&q=80',
            banner: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&q=80',
            tagline: 'AI-Native SASE & Cloud Security Infrastructure',
            description: 'Protecting enterprise hybrid workforces with unified Zero Trust Network Access (ZTNA), cloud firewall, and automated incident response.',
            videoUrl: '',
            website: 'https://cybershield.example.com',
            contactEmail: 'info@cybershield.example.com',
            contactPhone: '+1 (800) 555-0199',
            liveChatEnabled: true,
            products: [
              {
                name: 'CyberShield SASE Gateway 4.0',
                description: 'All-in-one Zero Trust Cloud Gateway replacing legacy VPNs with granular contextual access and microsegmentation.',
                price: '$15 / user / mo',
                category: 'Cloud Security',
                image: 'https://images.unsplash.com/photo-1563986768494-4dee2763ff3f?w=600&q=80',
                brochureUrl: 'https://example.com/cybershield-sase.pdf'
              }
            ],
            boothVisits: 76
          }
        ];

    // Default virtual sessions if none populated yet
    if (!sessions || sessions.length === 0) {
      const baseDate = event.startDate ? new Date(event.startDate) : new Date();
      sessions = [
        {
          _id: 'session-demo-1',
          title: 'Opening Global Keynote: The Future of Hybrid Expos & AI Industry Trends',
          description: 'Visionary leadership address exploring how virtual immersion, digital twins, and AI-driven match-making are redefining global trade exhibitions.',
          speakers: [
            {
              name: 'Dr. Alistair Vance',
              designation: 'Chief Technology Strategist',
              company: 'Global Exhibition Alliance'
            },
            {
              name: 'Sunita Mehra',
              designation: 'VP of Digital Transformation',
              company: 'ExpoInnovate Worldwide'
            }
          ],
          startTime: new Date(baseDate.getTime() + 10 * 60 * 60 * 1000), // 10:00 AM
          endTime: new Date(baseDate.getTime() + 11 * 60 * 60 * 1000 + 30 * 60 * 1000), // 11:30 AM
          hallName: 'Virtual Main Stage / Hall A',
          sessionType: 'hybrid',
          streamProvider: 'zoom',
          streamUrl: 'https://zoom.us/j/82049182048',
          zoomMeetingId: '820 4918 2048',
          zoomPasscode: 'EXPO2026',
          timezone: 'Asia/Kolkata',
          isLiveNow: true,
          virtualAttendeesCount: 248
        },
        {
          _id: 'session-demo-2',
          title: 'Deep-Dive Panel: Sustainable Manufacturing, Clean Tech & Supply Chain Resilience',
          description: 'International panel discussion with industry pioneers sharing zero-carbon manufacturing blueprints and next-gen material innovations.',
          speakers: [
            {
              name: 'Elena Rostova',
              designation: 'Head of Circular Economy',
              company: 'Nordic Clean Industries'
            },
            {
              name: 'Karan Singhania',
              designation: 'Director of Green Energy Operations',
              company: 'Tata Renewables'
            }
          ],
          startTime: new Date(baseDate.getTime() + 14 * 60 * 60 * 1000), // 2:00 PM
          endTime: new Date(baseDate.getTime() + 15 * 60 * 60 * 1000 + 15 * 60 * 1000), // 3:15 PM
          hallName: 'Interactive Virtual Breakout Room B',
          sessionType: 'virtual',
          streamProvider: 'agora',
          agoraChannel: 'visitexpo-sustainability-panel',
          streamUrl: 'https://meet.jit.si/visitexpo-sustainability-panel',
          timezone: 'Asia/Kolkata',
          isLiveNow: false,
          virtualAttendeesCount: 164
        },
        {
          _id: 'session-demo-3',
          title: 'Live Product Showcase & Virtual Pitch Competition',
          description: 'Live interactive demonstrations by 6 shortlisted startups presenting breakthrough robotics, IoT hardware, and SaaS architectures.',
          speakers: [
            {
              name: 'Marcus Chen',
              designation: 'Managing Partner',
              company: 'Vanguard Hardware Ventures'
            }
          ],
          startTime: new Date(baseDate.getTime() + 16 * 60 * 60 * 1000), // 4:00 PM
          endTime: new Date(baseDate.getTime() + 17 * 60 * 60 * 1000 + 30 * 60 * 1000), // 5:30 PM
          hallName: 'Virtual Demo Amphitheatre',
          sessionType: 'virtual',
          streamProvider: 'youtube',
          streamUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          timezone: 'Asia/Kolkata',
          isLiveNow: false,
          virtualAttendeesCount: 89
        }
      ];
    }

    res.status(200).json({
      success: true,
      data: {
        eventId: event._id,
        title: event.title,
        slug: event.slug,
        eventType: event.eventType || 'hybrid',
        livestream: event.livestream || {
          enabled: true,
          provider: 'youtube',
          streamUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          status: 'live',
          liveViewerCount: 184
        },
        virtualAttendanceStats: event.virtualAttendanceStats || {
          totalVirtualVisitors: 312,
          liveStreamViews: 540,
          sessionAttendeesCount: 501,
          boothVisitsCount: 316
        },
        virtualBooths,
        virtualSessions: sessions,
        sessions
      }
    });
  } catch (error) {
    next(error);
  }
});

// 2. Track Virtual Attendance for Event Livestream / Hub
router.post('/:slug/virtual-attend', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { email, name, phone, company, designation, country, viewerTimezone } = req.body;

    const event = await findEventBySlugOrId(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanName = (name || '').trim() || (cleanEmail ? cleanEmail.split('@')[0] : 'Virtual Attendee');
    const userTimezone = viewerTimezone || 'UTC';

    let visitor = null;
    if (cleanEmail) {
      visitor = await Visitor.findOne({ event: event._id, email: cleanEmail });
      if (visitor) {
        visitor.attendanceType = 'virtual';
        visitor.virtualJoinStatus = 'checked_in';
        visitor.virtualJoinTime = new Date();
        visitor.viewerTimezone = userTimezone;
        await visitor.save();
      } else {
        const mockQRCode = `visitexpo-${event._id}-${cleanEmail.replace(/[^a-z0-9]/g, '')}`;
        visitor = await Visitor.create({
          name: cleanName,
          email: cleanEmail,
          phone: phone || '+1-000-0000',
          company: company || 'Virtual Participant',
          designation: designation || 'Trade Visitor',
          country: country || 'International',
          qrCode: mockQRCode,
          event: event._id,
          attendanceType: 'virtual',
          registrationStatus: 'confirmed',
          checkInStatus: 'not_checked_in',
          virtualJoinStatus: 'checked_in',
          virtualJoinTime: new Date(),
          viewerTimezone: userTimezone,
          notes: `Joined virtual livestream from ${userTimezone}`
        });

        // Also create lead in CRM
        try {
          await Lead.create({
            name: cleanName,
            email: cleanEmail,
            phone: phone || '',
            company: company || '',
            designation: designation || 'Trade Visitor',
            country: country || 'International',
            leadScore: 40,
            source: 'virtual_event',
            status: 'new',
            event: event._id,
            notes: `Captured from Virtual Livestream check-in (${userTimezone}).`,
            activityTimeline: [
              {
                type: 'note',
                content: `Checked into virtual livestream in timezone ${userTimezone}.`
              }
            ]
          });
        } catch (leadErr) {
          // ignore duplicate lead error
        }
      }
    }

    // Update Event virtual attendance statistics
    if (!event.virtualAttendanceStats) {
      event.virtualAttendanceStats = {
        totalVirtualVisitors: 0,
        liveStreamViews: 0,
        sessionAttendeesCount: 0,
        boothVisitsCount: 0
      };
    }
    event.virtualAttendanceStats.totalVirtualVisitors = (event.virtualAttendanceStats.totalVirtualVisitors || 0) + 1;
    event.virtualAttendanceStats.liveStreamViews = (event.virtualAttendanceStats.liveStreamViews || 0) + 1;
    await event.save();

    res.status(200).json({
      success: true,
      message: 'Virtual attendance tracked successfully',
      data: {
        checkedIn: true,
        stats: event.virtualAttendanceStats,
        visitor: visitor ? {
          id: visitor._id,
          name: visitor.name,
          email: visitor.email,
          virtualJoinTime: visitor.virtualJoinTime,
          viewerTimezone: visitor.viewerTimezone
        } : null
      },
      stats: event.virtualAttendanceStats,
      visitor: visitor
    });
  } catch (error) {
    next(error);
  }
});

// 3. Track Virtual Attendance for a Specific Session
router.post('/:slug/sessions/:sessionId/attend', async (req, res, next) => {
  try {
    const { slug, sessionId } = req.params;
    const { email, name, viewerTimezone } = req.body;

    const event = await findEventBySlugOrId(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    let session = null;
    if (mongoose.isValidObjectId(sessionId)) {
      session = await Session.findById(sessionId);
    }

    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanName = (name || '').trim() || (cleanEmail ? cleanEmail.split('@')[0] : 'Session Attendee');
    const userTimezone = viewerTimezone || 'UTC';

    if (session) {
      session.virtualAttendeesCount = (session.virtualAttendeesCount || 0) + 1;
      session.virtualAttendees.push({
        name: cleanName,
        email: cleanEmail,
        joinedAt: new Date(),
        viewerTimezone: userTimezone
      });
      await session.save();
    }

    // If visitor exists or clean email provided, link to visitor record
    if (cleanEmail) {
      let visitor = await Visitor.findOne({ event: event._id, email: cleanEmail });
      if (!visitor) {
        visitor = await Visitor.create({
          name: cleanName,
          email: cleanEmail,
          phone: '+1-000-0000',
          company: 'Virtual Participant',
          designation: 'Session Attendee',
          country: 'International',
          qrCode: `visitexpo-${event._id}-${cleanEmail.replace(/[^a-z0-9]/g, '')}`,
          event: event._id,
          attendanceType: 'virtual',
          virtualJoinStatus: 'checked_in',
          virtualJoinTime: new Date(),
          viewerTimezone: userTimezone
        });
      }
      visitor.virtualSessionsAttended.push({
        sessionId: session ? session._id : null,
        sessionTitle: session ? session.title : (req.body.sessionTitle || 'Virtual Session'),
        joinedAt: new Date(),
        viewerTimezone: userTimezone
      });
      await visitor.save();
    }

    // Update event virtual attendance stats
    if (!event.virtualAttendanceStats) {
      event.virtualAttendanceStats = {
        totalVirtualVisitors: 0,
        liveStreamViews: 0,
        sessionAttendeesCount: 0,
        boothVisitsCount: 0
      };
    }
    event.virtualAttendanceStats.sessionAttendeesCount = (event.virtualAttendanceStats.sessionAttendeesCount || 0) + 1;
    await event.save();

    res.status(200).json({
      success: true,
      message: 'Session attendance tracked successfully',
      virtualAttendeesCount: session ? session.virtualAttendeesCount : 1
    });
  } catch (error) {
    next(error);
  }
});

// 4. Track Virtual Booth Visit
router.post('/:slug/booths/:boothIndex/visit', async (req, res, next) => {
  try {
    const { slug, boothIndex } = req.params;
    const { email, boothNumber, boothName } = req.body;

    const event = await findEventBySlugOrId(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const idx = parseInt(boothIndex, 10);
    if (event.virtualBooths && event.virtualBooths[idx]) {
      event.virtualBooths[idx].boothVisits = (event.virtualBooths[idx].boothVisits || 0) + 1;
    }

    if (!event.virtualAttendanceStats) {
      event.virtualAttendanceStats = {
        totalVirtualVisitors: 0,
        liveStreamViews: 0,
        sessionAttendeesCount: 0,
        boothVisitsCount: 0
      };
    }
    event.virtualAttendanceStats.boothVisitsCount = (event.virtualAttendanceStats.boothVisitsCount || 0) + 1;
    await event.save();

    if (email) {
      const visitor = await Visitor.findOne({ event: event._id, email: email.toLowerCase().trim() });
      if (visitor) {
        visitor.boothsVisited.push({
          boothNumber: boothNumber || `B-${idx + 1}`,
          boothName: boothName || event.virtualBooths?.[idx]?.exhibitorName || 'Virtual Booth',
          visitedAt: new Date()
        });
        await visitor.save();
      }
    }

    res.status(200).json({
      success: true,
      boothVisits: event.virtualBooths?.[idx]?.boothVisits || 1,
      totalBoothVisits: event.virtualAttendanceStats.boothVisitsCount
    });
  } catch (error) {
    next(error);
  }
});

// 5. Send Direct Message / Inquiry to a Virtual Booth Exhibitor
router.post('/:slug/virtual-booth-message', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { boothNumber, senderName, senderEmail, senderPhone, senderCompany, message } = req.body;

    const event = await findEventBySlugOrId(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message cannot be empty' });
    }

    // Capture as lead
    try {
      await Lead.create({
        name: senderName || 'Virtual Booth Inquirer',
        email: senderEmail || 'visitor@visitexpo.in',
        phone: senderPhone || '+1-000-0000',
        company: senderCompany || '',
        source: 'virtual_booth_chat',
        status: 'new',
        event: event._id,
        notes: `Booth: ${boothNumber || 'General'}. Inquiry: ${message.trim()}`
      });
    } catch (err) {
      // ignore duplicate or non-critical error
    }

    res.status(200).json({
      success: true,
      message: 'Message delivered to booth representative successfully'
    });
  } catch (error) {
    next(error);
  }
});

// 6. Check Chat Status for Event Organizer
router.get('/:slug/chat/status', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const event = await findEventBySlugOrId(slug);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const chatEnabled = event.chatEnabled !== false && event.chatSettings?.enabled !== false;

    res.status(200).json({
      success: true,
      chatEnabled,
      organizer: event.claimedBy || event.organizer || null,
      message: chatEnabled ? 'Chat is enabled' : 'Chat is disabled by organizer'
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// ORGANIZER PRIVATE MANAGEMENT APIS
// ==========================================

// Create a new event
router.post('/', protect, authorize('super_admin', 'organizer', 'event_manager'), async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin' && !req.user.organization) {
      return res.status(400).json({ success: false, error: 'User does not belong to any organization' });
    }

    const event = await EventService.createEvent(req.body, req.user.organization);

    // Auto-create default ticket tier if ticketing data is provided
    await syncDefaultTicketTier(event._id, req.body);

    // Automatically sync event to WordPress
    await syncEventToWordPress(event._id);

    res.status(201).json({ success: true, message: 'Event created successfully', event });
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({
        success: false,
        error: error.message,
        existingEvent: error.existingEvent
      });
    }
    next(error);
  }
});

// Update event
router.put('/:id', protect, authorize('super_admin', 'organizer', 'event_manager'), async (req, res, next) => {
  try {
    const event = await EventService.updateEvent(req.params.id, req.body, req.user.organization);

    // Sync default ticket tier if ticketing data changed
    await syncDefaultTicketTier(event._id, req.body);

    // Automatically sync event to WordPress
    await syncEventToWordPress(event._id);

    res.status(200).json({ success: true, message: 'Event updated successfully', event });
  } catch (error) {
    next(error);
  }
});

// Delete event
router.delete('/:id', protect, authorize('super_admin', 'organizer', 'event_manager'), async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const callerOrg = req.user.organization?._id || req.user.organization;
    const callerId = req.user.id;

    let event = null;
    try {
      event = await Event.findOne({
        $or: [
          { _id: mongoose.isValidObjectId(targetId) ? targetId : null },
          { slug: targetId },
          { slug: req.body?.slug || null },
          { wpPostId: targetId }
        ].filter(Boolean)
      });
    } catch (e) {
      // ignore
    }

    if (event) {
      const userEmail = (req.user.email || '').toLowerCase().trim();
      const eventOrgEmail = (event.organizerEmail || event.orgEmail || '').toLowerCase().trim();

      const isOwner =
        isSuperAdmin ||
        (event.organizer && callerOrg && String(event.organizer) === String(callerOrg)) ||
        (event.organizer && callerId && String(event.organizer) === String(callerId)) ||
        (event.claimedBy && callerId && String(event.claimedBy) === String(callerId)) ||
        (event.claimedBy && callerOrg && String(event.claimedBy) === String(callerOrg)) ||
        (userEmail && eventOrgEmail && userEmail === eventOrgEmail);

      if (!isOwner) {
        return res.status(403).json({ success: false, error: 'Unauthorized to delete this event' });
      }

      const eventIdentifiers = [String(event._id), event.wpPostId].filter(Boolean);
      const eventSlugs = [event.slug].filter(Boolean);

      await Promise.all([
        Ticket.deleteMany({ event: event._id }),
        Visitor.deleteMany({ event: event._id }),
        Exhibitor.deleteMany({ event: event._id }),
        Lead.deleteMany({ event: event._id }),
        Campaign.deleteMany({ event: event._id }),
        Session.deleteMany({ event: event._id }),
        EventEngagement.deleteMany({
          $or: [
            { eventId: { $in: eventIdentifiers } },
            { eventSlug: { $in: eventSlugs } }
          ]
        }),
        Event.findByIdAndDelete(event._id)
      ]);
    } else if (!isSuperAdmin) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Record in DeletedEvent for permanent exclusion across WordPress and aggregated directory
    await DeletedEvent.findOneAndUpdate(
      {
        $or: [
          { eventId: String(targetId) },
          { slug: String(req.body?.slug || event?.slug || targetId) },
          { wpPostId: String(req.body?.wpPostId || event?.wpPostId || targetId) }
        ]
      },
      {
        eventId: String(targetId),
        slug: String(req.body?.slug || event?.slug || targetId),
        title: req.body?.title || event?.title || 'Exhibition Event',
        wpPostId: String(req.body?.wpPostId || event?.wpPostId || targetId),
        deletedAt: new Date(),
        deletedBy: req.user.id || null,
        reason: req.body?.reason || 'Deleted by Super Admin'
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
