import express from 'express';
import mongoose from 'mongoose';
import VenueReport from '../models/VenueReport.js';
import { protect, requirePermission } from '../middlewares/auth.js';

const router = express.Router();

const REPORT_CATEGORIES = [
  'venue_name',
  'address_location',
  'coordinates',
  'contact_information',
  'facilities',
  'other'
];

router.post('/', async (req, res, next) => {
  try {
    const {
      venueId,
      venueName,
      venueAddress = '',
      category,
      description,
      imageUrl = '',
      userId = '',
      userEmail = '',
      userName = ''
    } = req.body || {};
    if (
      typeof venueId !== 'string' || !venueId.trim() || venueId.length > 200 ||
      typeof venueName !== 'string' || !venueName.trim() || venueName.length > 200
    ) {
      return res.status(400).json({ success: false, error: 'Venue details are required.' });
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
    if (typeof venueAddress !== 'string' || venueAddress.length > 500) {
      return res.status(400).json({ success: false, error: 'Venue address is too long.' });
    }
    if (
      imageUrl &&
      (typeof imageUrl !== 'string' || imageUrl.length > 2048 || !/^https:\/\//i.test(imageUrl))
    ) {
      return res.status(400).json({ success: false, error: 'The attached image URL is invalid.' });
    }

    const report = await VenueReport.create({
      venueId: venueId.trim(),
      venueName: venueName.trim(),
      venueAddress: venueAddress.trim(),
      category,
      description: description.trim(),
      imageUrl,
      userId: typeof userId === 'string' ? userId.trim() : '',
      userEmail: typeof userEmail === 'string' ? userEmail.trim() : '',
      userName: typeof userName === 'string' ? userName.trim() : ''
    });

    return res.status(201).json({
      success: true,
      message: 'Venue inaccuracy report submitted successfully.',
      data: { id: report._id, status: report.status }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin/all', protect, requirePermission('venues.manage'), async (req, res, next) => {
  try {
    const status = req.query.status;
    const filter = {};
    if (status && status !== 'all') {
      if (!['pending', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid report status.' });
      }
      filter.status = status;
    }

    const reports = await VenueReport.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    return res.status(200).json({ success: true, data: reports });
  } catch (error) {
    return next(error);
  }
});

router.patch('/admin/:id', protect, requirePermission('venues.manage'), async (req, res, next) => {
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
    const report = await VenueReport.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true
    });
    if (!report) {
      return res.status(404).json({ success: false, error: 'Venue report not found.' });
    }

    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    return next(error);
  }
});

export default router;
