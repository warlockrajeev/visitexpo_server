/**
 * @file ticketRoutes.js
 * @description Pricing tiers and ticketing options management.
 */

import express from 'express';
import Ticket from '../models/Ticket.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// @desc    Get all ticket tiers for an event (public access allowed for registration pages)
// @route   GET /api/tickets
router.get('/', async (req, res, next) => {
  try {
    const { eventId } = req.query;

    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Event ID parameter is required' });
    }

    const tickets = await Ticket.find({ event: eventId, status: { $ne: 'paused' } });

    res.status(200).json({
      success: true,
      data: tickets
    });
  } catch (error) {
    next(error);
  }
});

// Private organizer/admin endpoints
router.use(protect);
router.use(authorize('super_admin', 'organizer', 'event_manager'));

// @desc    Create a new ticket pricing tier
// @route   POST /api/tickets
router.post('/', async (req, res, next) => {
  try {
    const { eventId, title, description, type, price, currency, capacity } = req.body;

    if (!eventId || !title || capacity === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Event ID, Ticket Name, and Capacity are required'
      });
    }

    const ticket = await Ticket.create({
      title,
      description: description || '',
      type: type || 'free',
      price: type === 'free' ? 0 : (price || 0),
      currency: currency || 'INR',
      capacity,
      event: eventId
    });

    res.status(201).json({
      success: true,
      message: 'Ticket tier created successfully',
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update ticket tier details
// @route   PUT /api/tickets/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { title, description, type, price, currency, capacity, status } = req.body;

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket tier not found' });
    }

    if (title) ticket.title = title;
    if (description !== undefined) ticket.description = description;
    if (type) ticket.type = type;
    if (price !== undefined) ticket.price = type === 'free' ? 0 : price;
    if (currency) ticket.currency = currency;
    if (capacity !== undefined) ticket.capacity = capacity;
    if (status) ticket.status = status;

    await ticket.save();

    res.status(200).json({
      success: true,
      message: 'Ticket tier updated successfully',
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete ticket tier
// @route   DELETE /api/tickets/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket tier not found' });
    }

    await Ticket.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Ticket tier deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
