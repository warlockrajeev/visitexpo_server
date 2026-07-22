/**
 * @file supportTicketRoutes.js
 * @description Support Helpdesk Ticket endpoints for Client Dashboard & Admin Dashboard.
 */

import express from 'express';
import SupportTicket from '../models/SupportTicket.js';
import User from '../models/User.js';
import { protect } from '../middlewares/auth.js';

const router = express.Router();

// All support ticket routes require authentication
router.use(protect);

// @desc    Get support tickets (Super Admin gets all, Clients get their own)
// @route   GET /api/support-tickets
router.get('/', async (req, res, next) => {
  try {
    const { status, priority, category, search } = req.query;
    const userId = req.user.id || req.user._id;

    const filter = {};

    // Scope tickets based on user role
    if (req.user.role !== 'super_admin') {
      filter.$or = [
        { user: userId },
        { reporterEmail: req.user.email }
      ];
      if (req.user.organization) {
        filter.$or.push({ organization: req.user.organization });
      }
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (priority && priority !== 'all') {
      filter.priority = priority;
    }

    if (category && category !== 'all') {
      filter.category = category;
    }

    if (search) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { ticketId: { $regex: search, $options: 'i' } },
          { title: { $regex: search, $options: 'i' } },
          { reporterName: { $regex: search, $options: 'i' } },
          { reporterEmail: { $regex: search, $options: 'i' } }
        ]
      });
    }

    const tickets = await SupportTicket.find(filter)
      .populate('event', 'title city')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Create a new support ticket
// @route   POST /api/support-tickets
router.post('/', async (req, res, next) => {
  try {
    const { title, description, category, priority, eventId } = req.body;

    if (!title || !description) {
      return res.status(400).json({
        success: false,
        error: 'Title and description are required'
      });
    }

    const userId = req.user.id || req.user._id;
    const userDoc = await User.findById(userId).select('name email organization role');

    // Generate unique Ticket ID: e.g. TKT-2458
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const ticketId = `TKT-${randomNum}`;

    const ticket = await SupportTicket.create({
      ticketId,
      user: userId,
      reporterName: userDoc?.name || req.user.email || 'Organizer Client',
      reporterEmail: userDoc?.email || req.user.email || 'client@visitexpo.in',
      organization: userDoc?.organization || req.user.organization || null,
      event: eventId || null,
      title,
      description,
      category: category || 'technical',
      priority: priority || 'medium',
      status: 'open'
    });

    res.status(201).json({
      success: true,
      message: 'Support ticket created successfully',
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get single support ticket by ID
// @route   GET /api/support-tickets/:id
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const ticket = await SupportTicket.findById(req.params.id)
      .populate('event', 'title city')
      .populate('user', 'name email role');

    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Support ticket not found' });
    }

    // Access check: super admin or ticket owner
    if (req.user.role !== 'super_admin' && ticket.user._id.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized to view this ticket' });
    }

    res.status(200).json({
      success: true,
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update support ticket status, priority, or resolution
// @route   PUT /api/support-tickets/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { status, priority, resolutionNotes } = req.body;
    const userId = req.user.id || req.user._id;

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Support ticket not found' });
    }

    // Check authorization
    if (req.user.role !== 'super_admin' && ticket.user.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized to modify this ticket' });
    }

    if (priority) {
      ticket.priority = priority;
    }

    if (resolutionNotes !== undefined) {
      ticket.resolutionNotes = resolutionNotes;
    }

    if (status) {
      ticket.status = status;
      if (status === 'resolved' || status === 'closed') {
        ticket.resolvedAt = new Date();
        ticket.resolvedBy = userId;
      }
    }

    await ticket.save();

    res.status(200).json({
      success: true,
      message: 'Support ticket updated successfully',
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Add response/reply to support ticket thread
// @route   POST /api/support-tickets/:id/responses
router.post('/:id/responses', async (req, res, next) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Response message cannot be empty' });
    }

    const userId = req.user.id || req.user._id;
    const userDoc = await User.findById(userId).select('name role');

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Support ticket not found' });
    }

    // Add response
    ticket.responses.push({
      sender: userId,
      senderName: userDoc?.name || req.user.email || 'User',
      senderRole: userDoc?.role || req.user.role || 'user',
      message: message.trim(),
      createdAt: new Date()
    });

    // If admin responds and ticket was 'open', set status to 'in_progress'
    if (req.user.role === 'super_admin' && ticket.status === 'open') {
      ticket.status = 'in_progress';
    }

    await ticket.save();

    res.status(200).json({
      success: true,
      message: 'Response posted successfully',
      ticket
    });
  } catch (error) {
    next(error);
  }
});

export default router;
