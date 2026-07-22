/**
 * @file eventRoutes.js
 * @description Event management and WordPress consumption endpoints.
 */

import express from 'express';
import EventService from '../services/EventService.js';
import Ticket from '../models/Ticket.js';
import { protect, authorize } from '../middlewares/auth.js';
import { wordpressLimiter } from '../middlewares/rateLimiter.js';

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

  // Look for an existing default ticket for this event
  let ticket = await Ticket.findOne({ event: eventId, title: { $in: ['Default Entry Pass', 'General Admission', 'Visitor Pass'] } });

  if (ticket) {
    // Update existing default tier
    ticket.type = type;
    ticket.price = price;
    ticket.title = isFree ? 'Visitor Pass' : 'General Admission';
    ticket.description = isFree
      ? 'Complimentary visitor registration pass'
      : `Standard paid entry ticket — ₹${price}`;
    await ticket.save();
  } else {
    // Create new default tier
    await Ticket.create({
      title: isFree ? 'Visitor Pass' : 'General Admission',
      description: isFree
        ? 'Complimentary visitor registration pass'
        : `Standard paid entry ticket — ₹${price}`,
      type,
      price,
      currency: body.currency || 'INR',
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

    res.status(201).json({ success: true, message: 'Event created successfully', event });
  } catch (error) {
    next(error);
  }
});

// Update event
router.put('/:id', protect, authorize('super_admin', 'organizer', 'event_manager'), async (req, res, next) => {
  try {
    const event = await EventService.updateEvent(req.params.id, req.body, req.user.organization);

    // Sync default ticket tier if ticketing data changed
    await syncDefaultTicketTier(event._id, req.body);

    res.status(200).json({ success: true, message: 'Event updated successfully', event });
  } catch (error) {
    next(error);
  }
});

// Delete event
router.delete('/:id', protect, authorize('super_admin', 'organizer'), async (req, res, next) => {
  try {
    await EventService.deleteEvent(req.params.id, req.user.organization);
    res.status(200).json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
