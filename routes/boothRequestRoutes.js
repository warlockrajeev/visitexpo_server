/**
 * @file boothRequestRoutes.js
 * @description API endpoints for Expo Booth Requests (submitted directly to VisitExpo Admin,
 * synced user company name, live request counts per expo, and Admin management queries).
 */

import express from 'express';
import mongoose from 'mongoose';
import BoothRequest from '../models/BoothRequest.js';
import Event from '../models/Event.js';
import { protect, authorize } from '../middlewares/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { syncUserCompanyName } from '../services/companyProfileHelper.js';
import { notifyFollowersOnActivity } from '../services/followNotificationService.js';

const router = express.Router();

function buildEventConditions({ eventSlug, eventId }) {
  const conditions = [];
  const cleanSlug = String(eventSlug || '').trim().toLowerCase();
  if (cleanSlug) {
    const escapedSlug = cleanSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    conditions.push({ eventSlug: new RegExp(`^${escapedSlug}$`, 'i') });
  }
  if (eventId && mongoose.isValidObjectId(eventId)) {
    conditions.push({ event: new mongoose.Types.ObjectId(eventId) });
  }
  return conditions;
}

function buildEventCountFilter({ eventSlug, eventId }) {
  const conditions = buildEventConditions({ eventSlug, eventId });
  if (conditions.length === 0) return null;
  return {
    $or: conditions,
    requestCategory: 'stall',
    status: { $ne: 'rejected' }
  };
}

/**
 * GET /api/booth-requests/count
 * Public endpoint returning live count of booth requests for a specific expo,
 * and (when Authorization Bearer token is present) whether the current user has already requested a booth.
 */
router.get('/count', async (req, res) => {
  try {
    const eventConditions = buildEventConditions({
      eventSlug: req.query.eventSlug,
      eventId: req.query.eventId
    });
    if (eventConditions.length === 0) {
      return res.status(200).json({ success: true, count: 0, hasRequested: false });
    }

    const filter = {
      $or: eventConditions,
      requestCategory: 'stall',
      status: { $ne: 'rejected' }
    };
    const count = await BoothRequest.countDocuments(filter);

    let hasRequested = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);
      if (decoded) {
        const userConditions = [];
        if (decoded.id && mongoose.isValidObjectId(decoded.id)) {
          userConditions.push({ userId: new mongoose.Types.ObjectId(decoded.id) });
        }
        if (decoded.email) {
          userConditions.push({ email: String(decoded.email).trim().toLowerCase() });
        }
        if (userConditions.length > 0) {
          const existing = await BoothRequest.exists({
            $and: [
              { $or: eventConditions },
              { requestCategory: 'stall' },
              { status: { $ne: 'rejected' } },
              { $or: userConditions }
            ]
          });
          hasRequested = Boolean(existing);
        }
      }
    }

    res.status(200).json({ success: true, count, hasRequested });
  } catch (err) {
    console.error('Error counting booth requests:', err);
    res.status(500).json({ success: false, error: 'Failed to load booth request count.' });
  }
});

/**
 * GET /api/booth-requests/my
 * Authenticated endpoint returning the current user's booth request history (all statuses & categories).
 */
router.get('/my', protect, async (req, res) => {
  try {
    const userConditions = [];
    if (req.user?.id && mongoose.isValidObjectId(req.user.id)) {
      userConditions.push({ userId: new mongoose.Types.ObjectId(req.user.id) });
    }
    if (req.user?.email) {
      userConditions.push({ email: String(req.user.email).trim().toLowerCase() });
    }
    if (userConditions.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        stats: { total: 0, new: 0, in_progress: 0, responded: 0, approved: 0 }
      });
    }

    const requests = await BoothRequest.find({ $or: userConditions })
      .sort({ createdAt: -1 })
      .lean();

    const stats = requests.reduce(
      (acc, r) => {
        acc.total += 1;
        if (acc[r.status] !== undefined) acc[r.status] += 1;
        return acc;
      },
      { total: 0, new: 0, in_progress: 0, responded: 0, approved: 0 }
    );

    res.status(200).json({ success: true, data: requests, stats });
  } catch (err) {
    console.error('Error loading user booth requests:', err);
    res.status(500).json({ success: false, error: 'Failed to load your booth request history.' });
  }
});

/**
 * POST /api/booth-requests
 * Submit a Booth / Event inquiry request directly to VisitExpo Admin.
 * Synchronizes user company name in backend if entered/changed.
 */
router.post('/', protect, async (req, res) => {
  try {
    const {
      eventId,
      eventSlug,
      eventTitle,
      eventVenue,
      eventCity,
      name,
      email,
      phone,
      company,
      designation,
      requestCategory,
      inquiryType,
      message
    } = req.body;

    const cleanSlug = String(eventSlug || '').trim().toLowerCase();
    const cleanTitle = String(eventTitle || cleanSlug || 'Exhibition').trim();
    if (!cleanSlug && !eventId) {
      return res.status(400).json({ success: false, error: 'Event identifier is required.' });
    }

    const requesterName = String(name || req.user?.name || '').trim();
    const requesterEmail = String(email || req.user?.email || '').trim().toLowerCase();
    const requesterPhone = String(phone || '').trim();
    const requesterCompany = String(company || '').trim();
    const requesterDesignation = String(designation || '').trim();
    const requesterMessage = String(message || '').trim();

    if (!requesterName || requesterName.length < 2) {
      return res.status(400).json({ success: false, error: 'Full name is required.' });
    }
    if (!requesterEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
      return res.status(400).json({ success: false, error: 'Valid work email is required.' });
    }

    const isGibberishOrSymbols = (str) => {
      if (!str || typeof str !== 'string') return false;
      const s = str.trim();
      if (!s) return false;
      const alphaNum = (s.match(/[a-zA-Z0-9]/g) || []).length;
      return alphaNum < 2 || /^[^a-zA-Z0-9]+$/.test(s);
    };

    const allowedCategory = ['stall', 'visitor_pass', 'general'].includes(requestCategory)
      ? requestCategory
      : 'stall';

    if (allowedCategory === 'stall' && !requesterCompany) {
      return res.status(400).json({ success: false, error: 'Company / Organization name is required for stall booking.' });
    }
    if (requesterCompany && isGibberishOrSymbols(requesterCompany)) {
      return res.status(400).json({ success: false, error: 'Please provide a valid company name (at least 2 letters or numbers).' });
    }
    if (requesterDesignation && isGibberishOrSymbols(requesterDesignation)) {
      return res.status(400).json({ success: false, error: 'Please provide a valid designation / role.' });
    }
    if (requesterMessage && isGibberishOrSymbols(requesterMessage)) {
      return res.status(400).json({ success: false, error: 'Please provide a meaningful message (avoid pure symbols).' });
    }

    // Resolve MongoDB event ref if present (optional for WordPress/directory expos)
    let matchedEvent = null;
    if (eventId && mongoose.isValidObjectId(eventId)) {
      matchedEvent = await Event.findById(eventId).select('_id slug title city venue').lean();
    }
    if (!matchedEvent && cleanSlug) {
      matchedEvent = await Event.findOne({ slug: cleanSlug }).select('_id slug title city venue').lean();
    }

    const resolvedSlug = matchedEvent?.slug || cleanSlug || cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const createdRequest = await BoothRequest.create({
      event: matchedEvent?._id || null,
      eventSlug: resolvedSlug,
      eventTitle: matchedEvent?.title || cleanTitle,
      eventCity: String(eventCity || matchedEvent?.city || '').trim(),
      eventVenue: String(eventVenue || matchedEvent?.venue || '').trim(),
      userId: req.user?.id || null,
      name: requesterName,
      email: requesterEmail,
      phone: requesterPhone,
      company: requesterCompany,
      designation: requesterDesignation,
      requestCategory: allowedCategory,
      inquiryType: String(
        inquiryType ||
          (allowedCategory === 'stall'
            ? 'Book Stall Space'
            : allowedCategory === 'visitor_pass'
            ? 'Visitor Entry Pass'
            : 'General Inquiry')
      ).trim(),
      message: requesterMessage,
      status: 'new'
    });

    // Replace/sync the user's company name in backend if entered
    let updatedCompany = requesterCompany;
    if (req.user?.id && requesterCompany.length >= 2) {
      const syncRes = await syncUserCompanyName(req.user.id, requesterCompany);
      if (syncRes?.company) updatedCompany = syncRes.company;
    }

    const countFilter = buildEventCountFilter({
      eventSlug: resolvedSlug,
      eventId: matchedEvent?._id || eventId
    });
    const count = countFilter ? await BoothRequest.countDocuments(countFilter) : 1;

    // Notify followers of the requester about this activity
    try {
      notifyFollowersOnActivity({
        actorUserId: req.user?.id || null,
        actorEmail: requesterEmail,
        actorName: requesterName,
        eventId: matchedEvent?._id || null,
        eventSlug: resolvedSlug,
        eventTitle: matchedEvent?.title || cleanTitle,
        activityType: 'booth_requested',
        title: `Booth Activity by ${requesterName}`,
        message: `${requesterName}${updatedCompany ? ` (${updatedCompany})` : ''} submitted a booth request for "${matchedEvent?.title || cleanTitle}".`,
        url: `/expo/${resolvedSlug}`
      });
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: 'Booth request submitted directly to VisitExpo Admin.',
      data: createdRequest,
      updatedCompany,
      count
    });
  } catch (err) {
    console.error('Error submitting booth request:', err);
    res.status(500).json({ success: false, error: 'Failed to submit booth request.' });
  }
});

// ============================================================================
// ADMIN-PROTECTED BOOTH REQUEST QUERIES MANAGEMENT
// ============================================================================

/**
 * GET /api/booth-requests/admin/all
 * List all booth request queries for the Admin Panel with search, status/type filters, and KPI stats.
 */
router.get('/admin/all', protect, authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const { status, requestCategory, search, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }
    if (requestCategory && requestCategory !== 'all') {
      filter.requestCategory = requestCategory;
    }
    if (search && String(search).trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { name: regex },
        { email: regex },
        { company: regex },
        { eventTitle: regex },
        { eventCity: regex },
        { message: regex }
      ];
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

    const [requests, filteredTotal, totalAll, newCount, inProgressCount, respondedCount, approvedCount] =
      await Promise.all([
        BoothRequest.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        BoothRequest.countDocuments(filter),
        BoothRequest.countDocuments(),
        BoothRequest.countDocuments({ status: 'new' }),
        BoothRequest.countDocuments({ status: 'in_progress' }),
        BoothRequest.countDocuments({ status: 'responded' }),
        BoothRequest.countDocuments({ status: 'approved' })
      ]);

    res.status(200).json({
      success: true,
      total: filteredTotal,
      page: Number(page),
      totalPages: Math.max(1, Math.ceil(filteredTotal / Number(limit))),
      stats: {
        total: totalAll,
        new: newCount,
        in_progress: inProgressCount,
        responded: respondedCount,
        approved: approvedCount
      },
      data: requests
    });
  } catch (err) {
    console.error('Error fetching admin booth requests:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch booth requests.' });
  }
});

/**
 * PUT /api/booth-requests/admin/:id
 * Update booth request status or admin notes.
 */
router.put('/admin/:id', protect, authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const validStatuses = ['new', 'in_progress', 'responded', 'approved', 'rejected', 'archived'];

    const existing = await BoothRequest.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Booth request not found.' });
    }

    if (status) {
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status value.' });
      }
      existing.status = status;
      if (status !== 'new' && !existing.respondedAt) {
        existing.respondedAt = new Date();
      }
    }
    if (adminNotes !== undefined) {
      existing.adminNotes = String(adminNotes);
    }
    existing.reviewedByAdmin = req.user?.email || 'admin';
    await existing.save();

    res.status(200).json({
      success: true,
      message: 'Booth request updated successfully.',
      data: existing
    });
  } catch (err) {
    console.error('Error updating booth request:', err);
    res.status(500).json({ success: false, error: 'Failed to update booth request.' });
  }
});

/**
 * DELETE /api/booth-requests/admin/:id
 * Permanently delete a booth request query from Admin Panel.
 */
router.delete('/admin/:id', protect, authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const deleted = await BoothRequest.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Booth request not found.' });
    }
    res.status(200).json({
      success: true,
      message: 'Booth request deleted permanently.'
    });
  } catch (err) {
    console.error('Error deleting booth request:', err);
    res.status(500).json({ success: false, error: 'Failed to delete booth request.' });
  }
});

export default router;
