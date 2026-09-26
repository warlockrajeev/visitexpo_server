/**
 * @file eventRoutes.js
 * @description Event management and WordPress consumption endpoints.
 */

import express from 'express';
import EventService from '../services/EventService.js';
import Ticket from '../models/Ticket.js';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import DeletedOrganizer from '../models/DeletedOrganizer.js';
import DeletedEvent from '../models/DeletedEvent.js';
import { getAggregatedOrganizers } from './adminRoutes.js';
import { protect, authorize } from '../middlewares/auth.js';
import { wordpressLimiter } from '../middlewares/rateLimiter.js';
import { syncEventToWordPress } from '../services/WordPressSyncService.js';
import { fetchLiveWpDirectoryEvents, normalizeTitle } from '../utils/directoryEventsHelper.js';

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
    const { search, category, city, page, limit, sort, organizerId, status, all } = req.query;
    
    const filters = { search, category, city, organizerId, status, all };
    
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

    // 2. Query MongoDB Event collection
    const exactQuery = {
      title: { $regex: new RegExp(`^${escapedTitle}$`, 'i') }
    };
    if (excludeId && mongoose.isValidObjectId(excludeId)) {
      exactQuery._id = { $ne: excludeId };
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
        if (excludeId && (String(doc.id) === String(excludeId) || doc.slug === String(excludeId))) {
          return false;
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
        similarQuery._id = { $ne: excludeId };
      }

      const matches = await Event.find(similarQuery)
        .select('title slug city venue startDate endDate status banner orgName isClaimed')
        .limit(3)
        .lean();

      similarEvents = (matches || []).filter(m => !deletedTitles.has(normalizeTitle(m.title)));

      if (similarEvents.length < 3 && Array.isArray(wpDocs)) {
        const lowerClean = cleanTitle.toLowerCase();
        const wpMatches = wpDocs.filter(d => 
          d.title.toLowerCase().includes(lowerClean) &&
          !deletedTitles.has(normalizeTitle(d.title)) &&
          !similarEvents.some(se => normalizeTitle(se.title) === normalizeTitle(d.title))
        ).slice(0, 3 - similarEvents.length);

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
router.delete('/:id', protect, authorize('super_admin', 'organizer'), async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const isSuperAdmin = req.user.role === 'super_admin';
    const callerOrg = req.user.organization;

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
      if (!isSuperAdmin && String(event.organizer) !== String(callerOrg)) {
        return res.status(403).json({ success: false, error: 'Unauthorized to delete this event' });
      }
      await Event.findByIdAndDelete(event._id);
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
