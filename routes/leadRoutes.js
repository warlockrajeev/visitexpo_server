/**
 * @file leadRoutes.js
 * @description CRM lead management routing and pipeline controls.
 */

import express from 'express';
import Lead from '../models/Lead.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// All lead routes require authentication and organizer roles
router.use(protect);
router.use(authorize('super_admin', 'organizer', 'event_manager', 'sales_team', 'marketing_manager'));

// @desc    Get all leads for a specific event
// @route   GET /api/leads
router.get('/', async (req, res, next) => {
  try {
    const { eventId, status, search, page, limit } = req.query;

    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Event ID parameter is required' });
    }

    const query = { event: eventId };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } }
      ];
    }

    const pgNum = parseInt(page, 10) || 1;
    const pgLimit = parseInt(limit, 10) || 20;
    const skip = (pgNum - 1) * pgLimit;

    const [docs, total] = await Promise.all([
      Lead.find(query)
        .populate('assignedSales', 'name email')
        .populate('activityTimeline.performedBy', 'name')
        .sort({ leadScore: -1, createdAt: -1 })
        .skip(skip)
        .limit(pgLimit),
      Lead.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        docs,
        total,
        page: pgNum,
        pages: Math.ceil(total / pgLimit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update lead details (score, pipeline status, assigned sales agent)
// @route   PUT /api/leads/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { name, email, phone, company, designation, country, leadScore, status, assignedSales, notes } = req.body;

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    const previousStatus = lead.status;

    // Apply updates
    if (name) lead.name = name;
    if (email) lead.email = email.toLowerCase();
    if (phone !== undefined) lead.phone = phone;
    if (company !== undefined) lead.company = company;
    if (designation !== undefined) lead.designation = designation;
    if (country !== undefined) lead.country = country;
    if (leadScore !== undefined) lead.leadScore = leadScore;
    if (status) lead.status = status;
    if (assignedSales !== undefined) lead.assignedSales = assignedSales || null;
    if (notes !== undefined) lead.notes = notes;

    // Log status change activity
    if (status && status !== previousStatus) {
      lead.activityTimeline.push({
        type: 'note',
        content: `Lead status updated from "${previousStatus}" to "${status}"`,
        performedBy: req.user.id
      });
    }

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedSales', 'name email')
      .populate('activityTimeline.performedBy', 'name');

    res.status(200).json({
      success: true,
      message: 'Lead updated successfully',
      lead: updatedLead
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Add timeline note / activity
// @route   POST /api/leads/:id/activity
router.post('/:id/activity', async (req, res, next) => {
  try {
    const { type, content } = req.body;

    if (!type || !content) {
      return res.status(400).json({ success: false, error: 'Activity type and content are required' });
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    lead.activityTimeline.push({
      type,
      content,
      performedBy: req.user.id
    });

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedSales', 'name email')
      .populate('activityTimeline.performedBy', 'name');

    res.status(200).json({
      success: true,
      message: 'Activity log added successfully',
      lead: updatedLead
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Add follow-up task
// @route   POST /api/leads/:id/followup
router.post('/:id/followup', async (req, res, next) => {
  try {
    const { title, dateTime, notes } = req.body;

    if (!title || !dateTime) {
      return res.status(400).json({ success: false, error: 'Follow-up title and date/time are required' });
    }

    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    lead.followUps.push({
      title,
      dateTime,
      notes: notes || '',
      isCompleted: false
    });

    // Add activity timeline record
    lead.activityTimeline.push({
      type: 'note',
      content: `Scheduled follow-up: "${title}" at ${new Date(dateTime).toLocaleString()}`,
      performedBy: req.user.id
    });

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedSales', 'name email')
      .populate('activityTimeline.performedBy', 'name');

    res.status(200).json({
      success: true,
      message: 'Follow-up scheduled successfully',
      lead: updatedLead
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete lead
// @route   DELETE /api/leads/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    await Lead.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Lead deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
