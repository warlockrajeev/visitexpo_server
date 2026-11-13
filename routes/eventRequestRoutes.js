/**
 * @file eventRequestRoutes.js
 * @description API endpoints for Speaker Applications, Corporate Group & VIP Delegation requests,
 * and Partner Hotel & Flight Discount requests submitted directly to Admin, plus real expo speakers feed.
 */

import express from 'express';
import mongoose from 'mongoose';
import EventRequest from '../models/EventRequest.js';
import Event from '../models/Event.js';
import { protect, authorize } from '../middlewares/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { syncUserCompanyName } from '../services/companyProfileHelper.js';
import { notifyFollowersOnActivity } from '../services/followNotificationService.js';

const router = express.Router();

const VALID_REQUEST_TYPES = ['speaker', 'delegation', 'travel_discount'];
const VALID_STATUSES = ['new', 'in_progress', 'approved', 'rejected', 'archived'];

const DUMMY_SPEAKER_NAMES = new Set([
  'dr. michael vance',
  'elena rostova',
  'rajesh k. mehta',
  'sarah lin'
]);

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

function isGibberishOrSymbols(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (!s) return false;
  const alphaNum = (s.match(/[a-zA-Z0-9]/g) || []).length;
  return alphaNum < 2 || /^[^a-zA-Z0-9]+$/.test(s);
}

function normalizeSpeakerRecord(raw, source = 'organizer') {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  if (!name || DUMMY_SPEAKER_NAMES.has(name.toLowerCase())) return null;

  return {
    id: String(raw._id || raw.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
    name,
    role: String(raw.role || raw.designation || 'Keynote Speaker').trim(),
    org: String(raw.org || raw.company || '').trim(),
    topic: String(raw.topic || raw.sessionTopic || raw.bio || '').trim(),
    format: String(raw.sessionFormat || raw.format || '').trim(),
    bio: String(raw.speakerBio || raw.bio || '').trim(),
    linkedinUrl: String(raw.linkedinUrl || '').trim(),
    avatar: String(raw.avatar || raw.photo || '').trim(),
    source
  };
}

/**
 * GET /api/event-requests/speakers
 * Public endpoint returning real confirmed speakers for an event (from Event.speakers + Admin-approved speaker requests).
 */
router.get('/speakers', async (req, res) => {
  try {
    const { eventSlug, eventId } = req.query;
    const cleanSlug = String(eventSlug || '').trim().toLowerCase();
    const eventConditions = buildEventConditions({ eventSlug: cleanSlug, eventId });

    let matchedEvent = null;
    if (eventId && mongoose.isValidObjectId(eventId)) {
      matchedEvent = await Event.findById(eventId).select('_id slug speakers').lean();
    }
    if (!matchedEvent && cleanSlug) {
      matchedEvent = await Event.findOne({ slug: cleanSlug }).select('_id slug speakers').lean();
    }

    const approvedFilter =
      eventConditions.length > 0
        ? { $or: eventConditions, requestType: 'speaker', status: 'approved' }
        : null;

    const approvedRequests = approvedFilter
      ? await EventRequest.find(approvedFilter).sort({ respondedAt: -1, updatedAt: -1 }).lean()
      : [];

    const seen = new Set();
    const realSpeakers = [];

    const addIfUnique = (normalized) => {
      if (!normalized) return;
      const key = `${normalized.name.toLowerCase()}|${normalized.org.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      realSpeakers.push(normalized);
    };

    if (Array.isArray(matchedEvent?.speakers)) {
      matchedEvent.speakers.forEach((spk) => addIfUnique(normalizeSpeakerRecord(spk, 'organizer')));
    }
    approvedRequests.forEach((reqDoc) => addIfUnique(normalizeSpeakerRecord(reqDoc, 'admin_approved')));

    res.status(200).json({
      success: true,
      count: realSpeakers.length,
      data: realSpeakers
    });
  } catch (err) {
    console.error('Error fetching real speakers:', err);
    res.status(500).json({ success: false, error: 'Failed to load speakers.' });
  }
});

/**
 * GET /api/event-requests/my-status
 * Returns whether the logged-in user has active requests for speaker, delegation, and travel_discount on a given event.
 */
router.get('/my-status', async (req, res) => {
  try {
    const eventConditions = buildEventConditions({
      eventSlug: req.query.eventSlug,
      eventId: req.query.eventId
    });
    const emptyStatus = {
      speaker: null,
      delegation: null,
      travel_discount: null
    };

    if (eventConditions.length === 0) {
      return res.status(200).json({ success: true, data: emptyStatus });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(200).json({ success: true, data: emptyStatus });
    }

    const decoded = verifyAccessToken(authHeader.split(' ')[1]);
    if (!decoded) {
      return res.status(200).json({ success: true, data: emptyStatus });
    }

    const userConditions = [];
    if (decoded.id && mongoose.isValidObjectId(decoded.id)) {
      userConditions.push({ userId: new mongoose.Types.ObjectId(decoded.id) });
    }
    if (decoded.email) {
      userConditions.push({ email: String(decoded.email).trim().toLowerCase() });
    }
    if (userConditions.length === 0) {
      return res.status(200).json({ success: true, data: emptyStatus });
    }

    const records = await EventRequest.find({
      $and: [
        { $or: eventConditions },
        { $or: userConditions },
        { status: { $ne: 'rejected' } }
      ]
    })
      .sort({ createdAt: -1 })
      .select('requestType status sessionTopic teamSize travelPreference createdAt')
      .lean();

    const statusMap = { ...emptyStatus };
    for (const r of records) {
      if (!statusMap[r.requestType]) {
        statusMap[r.requestType] = {
          id: r._id,
          status: r.status,
          sessionTopic: r.sessionTopic || '',
          teamSize: r.teamSize || '',
          travelPreference: r.travelPreference || '',
          createdAt: r.createdAt
        };
      }
    }

    res.status(200).json({ success: true, data: statusMap });
  } catch (err) {
    console.error('Error checking event request status:', err);
    res.status(500).json({ success: false, error: 'Failed to check request status.' });
  }
});

/**
 * GET /api/event-requests/my
 * Authenticated user's own submitted speaker, delegation, and travel discount requests.
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
      return res.status(200).json({ success: true, data: [] });
    }

    const filter = { $or: userConditions };
    if (req.query.requestType && VALID_REQUEST_TYPES.includes(req.query.requestType)) {
      filter.requestType = req.query.requestType;
    }

    const docs = await EventRequest.find(filter).sort({ createdAt: -1 }).lean();
    res.status(200).json({ success: true, data: docs });
  } catch (err) {
    console.error('Error loading my event requests:', err);
    res.status(500).json({ success: false, error: 'Failed to load your requests.' });
  }
});

/**
 * POST /api/event-requests
 * Submit a Speaker Application, Corporate Group & VIP Delegation, or Partner Hotel & Flight Discount request directly to Admin.
 */
router.post('/', protect, async (req, res) => {
  try {
    const {
      eventId,
      eventSlug,
      eventTitle,
      eventCity,
      eventVenue,
      requestType,
      name,
      email,
      phone,
      company,
      designation,
      sessionTopic,
      sessionFormat,
      speakerBio,
      linkedinUrl,
      teamSize,
      delegationInterests,
      preferredDates,
      travelPreference,
      guestsCount,
      checkInDate,
      checkOutDate,
      departureCity,
      message
    } = req.body;

    if (!VALID_REQUEST_TYPES.includes(requestType)) {
      return res.status(400).json({ success: false, error: 'Invalid request type.' });
    }

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

    if (!requesterName || requesterName.length < 2) {
      return res.status(400).json({ success: false, error: 'Full name is required.' });
    }
    if (!requesterEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
      return res.status(400).json({ success: false, error: 'Valid work email is required.' });
    }
    if (requesterCompany && isGibberishOrSymbols(requesterCompany)) {
      return res.status(400).json({ success: false, error: 'Please provide a valid company or organization name.' });
    }

    // Type-specific validation
    const cleanTopic = String(sessionTopic || '').trim();
    const cleanBio = String(speakerBio || '').trim();
    const cleanTeamSize = String(teamSize || '').trim();
    const cleanDelegationInterests = String(delegationInterests || '').trim();
    const cleanTravelPref = String(travelPreference || '').trim();
    const cleanGuestsCount = String(guestsCount || '').trim();
    const cleanMessage = String(message || '').trim();

    if (requestType === 'speaker') {
      if (!cleanTopic || cleanTopic.length < 3 || isGibberishOrSymbols(cleanTopic)) {
        return res.status(400).json({ success: false, error: 'Please provide a valid keynote / session topic.' });
      }
    } else if (requestType === 'delegation') {
      if (!cleanTeamSize) {
        return res.status(400).json({ success: false, error: 'Please select or enter the delegation team size.' });
      }
      if (!cleanDelegationInterests || isGibberishOrSymbols(cleanDelegationInterests)) {
        return res.status(400).json({ success: false, error: 'Please describe your corporate delegation sourcing objectives.' });
      }
    } else if (requestType === 'travel_discount') {
      if (!cleanTravelPref) {
        return res.status(400).json({ success: false, error: 'Please choose Hotel, Flight, or Bundle discount preference.' });
      }
      if (!cleanGuestsCount) {
        return res.status(400).json({ success: false, error: 'Please specify the number of rooms or travelers.' });
      }
    }

    let matchedEvent = null;
    if (eventId && mongoose.isValidObjectId(eventId)) {
      matchedEvent = await Event.findById(eventId).select('_id slug title city venue').lean();
    }
    if (!matchedEvent && cleanSlug) {
      matchedEvent = await Event.findOne({ slug: cleanSlug }).select('_id slug title city venue').lean();
    }

    const resolvedSlug = matchedEvent?.slug || cleanSlug || cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const created = await EventRequest.create({
      event: matchedEvent?._id || null,
      eventSlug: resolvedSlug,
      eventTitle: matchedEvent?.title || cleanTitle,
      eventCity: String(eventCity || matchedEvent?.city || '').trim(),
      eventVenue: String(eventVenue || matchedEvent?.venue || '').trim(),
      userId: req.user?.id || null,
      requestType,
      name: requesterName,
      email: requesterEmail,
      phone: requesterPhone,
      company: requesterCompany,
      designation: requesterDesignation,
      sessionTopic: cleanTopic,
      sessionFormat: String(sessionFormat || '').trim(),
      speakerBio: cleanBio,
      linkedinUrl: String(linkedinUrl || '').trim(),
      teamSize: cleanTeamSize,
      delegationInterests: cleanDelegationInterests,
      preferredDates: String(preferredDates || '').trim(),
      travelPreference: cleanTravelPref,
      guestsCount: cleanGuestsCount,
      checkInDate: String(checkInDate || '').trim(),
      checkOutDate: String(checkOutDate || '').trim(),
      departureCity: String(departureCity || '').trim(),
      message: cleanMessage,
      status: 'new'
    });

    // Keep user's company profile synced when entered/changed
    let updatedCompany = requesterCompany;
    if (req.user?.id && requesterCompany.length >= 2) {
      const syncRes = await syncUserCompanyName(req.user.id, requesterCompany);
      if (syncRes?.company) updatedCompany = syncRes.company;
    }

    try {
      const activityLabels = {
        speaker: 'Keynote Speaker Application',
        delegation: 'VIP Delegation Request',
        travel_discount: 'Hotel & Flight Discount Request'
      };
      notifyFollowersOnActivity({
        actorUserId: req.user?.id || null,
        actorEmail: requesterEmail,
        actorName: requesterName,
        eventId: matchedEvent?._id || null,
        eventSlug: resolvedSlug,
        eventTitle: matchedEvent?.title || cleanTitle,
        activityType: `event_request_${requestType}`,
        title: `${activityLabels[requestType]} by ${requesterName}`,
        message: `${requesterName}${updatedCompany ? ` (${updatedCompany})` : ''} submitted a ${activityLabels[requestType].toLowerCase()} for "${matchedEvent?.title || cleanTitle}".`,
        url: `/expo/${resolvedSlug}`
      });
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: 'Your request has been sent directly to VisitExpo Admin.',
      data: created,
      updatedCompany
    });
  } catch (err) {
    console.error('Error submitting event request:', err);
    res.status(500).json({ success: false, error: 'Failed to submit request.' });
  }
});

// ============================================================================
// ADMIN-PROTECTED EVENT REQUESTS MANAGEMENT (SPEAKER / DELEGATION / TRAVEL)
// ============================================================================

/**
 * GET /api/event-requests/admin/all
 */
router.get('/admin/all', protect, authorize('super_admin', 'admin', 'sub_admin'), async (req, res) => {
  try {
    const { status, requestType, search, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (status && status !== 'all' && VALID_STATUSES.includes(status)) {
      filter.status = status;
    }
    if (requestType && requestType !== 'all' && VALID_REQUEST_TYPES.includes(requestType)) {
      filter.requestType = requestType;
    }
    if (search && String(search).trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { name: regex },
        { email: regex },
        { company: regex },
        { eventTitle: regex },
        { sessionTopic: regex },
        { delegationInterests: regex },
        { departureCity: regex },
        { message: regex }
      ];
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

    const [
      requests,
      filteredTotal,
      totalAll,
      newCount,
      speakerCount,
      delegationCount,
      travelCount,
      approvedCount
    ] = await Promise.all([
      EventRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      EventRequest.countDocuments(filter),
      EventRequest.countDocuments(),
      EventRequest.countDocuments({ status: 'new' }),
      EventRequest.countDocuments({ requestType: 'speaker' }),
      EventRequest.countDocuments({ requestType: 'delegation' }),
      EventRequest.countDocuments({ requestType: 'travel_discount' }),
      EventRequest.countDocuments({ status: 'approved' })
    ]);

    res.status(200).json({
      success: true,
      total: filteredTotal,
      page: Number(page),
      totalPages: Math.max(1, Math.ceil(filteredTotal / Number(limit))),
      stats: {
        total: totalAll,
        new: newCount,
        speaker: speakerCount,
        delegation: delegationCount,
        travel_discount: travelCount,
        approved: approvedCount
      },
      data: requests
    });
  } catch (err) {
    console.error('Error fetching admin event requests:', err);
    res.status(500).json({ success: false, error: 'Failed to load requests.' });
  }
});

/**
 * PUT /api/event-requests/admin/:id
 */
router.put('/admin/:id', protect, authorize('super_admin', 'admin', 'sub_admin'), async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const existing = await EventRequest.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Request not found.' });
    }

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
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
      message: 'Request updated successfully.',
      data: existing
    });
  } catch (err) {
    console.error('Error updating event request:', err);
    res.status(500).json({ success: false, error: 'Failed to update request.' });
  }
});

/**
 * DELETE /api/event-requests/admin/:id
 */
router.delete('/admin/:id', protect, authorize('super_admin', 'admin', 'sub_admin'), async (req, res) => {
  try {
    const deleted = await EventRequest.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Request not found.' });
    }
    res.status(200).json({
      success: true,
      message: 'Request deleted permanently.'
    });
  } catch (err) {
    console.error('Error deleting event request:', err);
    res.status(500).json({ success: false, error: 'Failed to delete request.' });
  }
});

export default router;

