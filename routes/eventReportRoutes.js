import express from 'express';
import mongoose from 'mongoose';
import EventReport from '../models/EventReport.js';
import { protect, requirePermission } from '../middlewares/auth.js';

const router = express.Router();

const REPORT_CATEGORIES = [
  'incorrect_dates',
  'wrong_venue_or_location',
  'cancelled_or_postponed',
  'misleading_or_spam',
  'broken_links_or_media',
  'other'
];

router.post('/', protect, async (req, res, next) => {
  try {
    const {
      eventId,
      eventSlug = '',
      eventTitle,
      eventLocation = '',
      category,
      description,
      userId = '',
      userEmail = '',
      userName = ''
    } = req.body || {};

    if (
      typeof eventId !== 'string' || !eventId.trim() || eventId.length > 200 ||
      typeof eventTitle !== 'string' || !eventTitle.trim() || eventTitle.length > 300
    ) {
      return res.status(400).json({ success: false, error: 'Event details are required.' });
    }

    if (!REPORT_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: 'Select a valid issue category.' });
    }

    if (typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'Description must be between 10 and 2,000 characters.'
      });
    }

    if (typeof eventSlug !== 'string' || eventSlug.length > 300) {
      return res.status(400).json({ success: false, error: 'Invalid event slug.' });
    }

    if (typeof eventLocation !== 'string' || eventLocation.length > 500) {
      return res.status(400).json({ success: false, error: 'Event location is too long.' });
    }

    const report = await EventReport.create({
      eventId: eventId.trim(),
      eventSlug: eventSlug.trim(),
      eventTitle: eventTitle.trim(),
      eventLocation: eventLocation.trim(),
      category,
      description: description.trim(),
      userId: String(req.user?.id || req.user?._id || userId || '').trim().slice(0, 100),
      userEmail: String(req.user?.email || userEmail || '').trim().slice(0, 200),
      userName: typeof userName === 'string' ? userName.trim().slice(0, 200) : ''
    });

    return res.status(201).json({
      success: true,
      message: 'Event report submitted to admin for review.',
      data: { id: report._id, status: report.status }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin/all', protect, requirePermission('events.view'), async (req, res, next) => {
  try {
    const status = req.query.status;
    const filter = {};
    if (status && status !== 'all') {
      if (!['pending', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid report status.' });
      }
      filter.status = status;
    }

    const reports = await EventReport.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    return res.status(200).json({ success: true, data: reports });
  } catch (error) {
    return next(error);
  }
});

router.patch('/admin/:id', protect, requirePermission('events.view'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid report ID.' });
    }

    const { status, adminNotes } = req.body || {};
    if (status !== undefined && !['pending', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid report status.' });
    }
    if (adminNotes !== undefined && (typeof adminNotes !== 'string' || adminNotes.length > 2000)) {
      return res.status(400).json({ success: false, error: 'Admin notes must be 2,000 characters or fewer.' });
    }

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (adminNotes !== undefined) updates.adminNotes = adminNotes.trim();

    const report = await EventReport.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true
    });
    if (!report) {
      return res.status(404).json({ success: false, error: 'Event report not found.' });
    }

    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    return next(error);
  }
});

export default router;
