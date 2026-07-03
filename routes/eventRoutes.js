/**
 * @file eventRoutes.js
 * @description Event management and WordPress consumption endpoints.
 */

import express from 'express';
import EventService from '../services/EventService.js';
import { protect, authorize } from '../middlewares/auth.js';
import { wordpressLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

// ==========================================
// PUBLIC WORDPRESS / FRONTEND CONSUMPTION APIS
// ==========================================

// Get events list with pagination, search, sorting and filtering
router.get('/', wordpressLimiter, async (req, res, next) => {
  try {
    const { search, category, city, page, limit, sort, organizerId } = req.query;
    
    const filters = { search, category, city, organizerId };
    
    // Default options
    const options = {
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 10,
      sort: sort ? JSON.parse(sort) : { startDate: 1 }, // Default sort chronologically
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
    if (!req.user.organization) {
      return res.status(400).json({ success: false, error: 'User does not belong to any organization' });
    }

    const event = await EventService.createEvent(req.body, req.user.organization);
    res.status(201).json({ success: true, message: 'Event created successfully', event });
  } catch (error) {
    next(error);
  }
});

// Update event
router.put('/:id', protect, authorize('super_admin', 'organizer', 'event_manager'), async (req, res, next) => {
  try {
    const event = await EventService.updateEvent(req.params.id, req.body, req.user.organization);
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
