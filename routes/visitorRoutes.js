/**
 * @file visitorRoutes.js
 * @description Visitor registration and CRM leads pipelines.
 */

import express from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Visitor from '../models/Visitor.js';
import Session from '../models/Session.js';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import { protect, authorize } from '../middlewares/auth.js';
import { notifyOrganizerOnVisitor } from '../services/oneSignalService.js';
import { createVisitorQrCode, ensureVisitorQrCode } from '../services/visitorBadgeService.js';

const router = express.Router();
const FREE_VISITOR_REGISTRATION_LIMIT = 3;

async function getOrganizerEventIds(user) {
  const ownershipQuery = {
    $or: [
      ...(user.organization ? [{ organizer: user.organization }] : []),
      { claimedBy: user._id }
    ]
  };
  return Event.distinct('_id', ownershipQuery);
}

async function getOrganizerBasePlan(user) {
  const subscriptionQuery = {
    $or: [
      ...(user.organization ? [{ organization: user.organization }] : []),
      { user: user._id }
    ],
    plan: { $ne: 'growth' }
  };
  let subscription = await Subscription.findOne({
    ...subscriptionQuery,
    status: 'active'
  }).sort({ createdAt: -1 });
  if (!subscription) {
    subscription = await Subscription.findOne(subscriptionQuery).sort({ createdAt: -1 });
  }
  return subscription?.plan || (user.plan === 'growth' ? 'free' : user.plan || 'free');
}

router.get('/usage', protect, authorize('super_admin', 'organizer'), async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('plan organization');
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const eventIds = await getOrganizerEventIds(user);
    const [used, plan] = await Promise.all([
      Visitor.countDocuments({ event: { $in: eventIds } }),
      getOrganizerBasePlan(user)
    ]);

    res.status(200).json({
      success: true,
      data: {
        used,
        limit: plan === 'free' ? FREE_VISITOR_REGISTRATION_LIMIT : null,
        plan
      }
    });
  } catch (error) {
    next(error);
  }
});

function getSafeHttpUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const parsedUrl = new URL(value);
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.toString() : '';
  } catch {
    return '';
  }
}

function isEventPastEndDate(event, now = Date.now()) {
  if (!event) return false;
  const statusStr = String(event.status || '').toLowerCase();
  if (['completed', 'ended', 'archived'].includes(statusStr)) {
    return true;
  }

  const endDate = event.endDate || event.startDate;
  if (!endDate) return false;

  const dateOnlyMatch =
    typeof endDate === 'string'
      ? endDate.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/)
      : null;
  const parsedEndDate = dateOnlyMatch
    ? new Date(`${dateOnlyMatch[1]}T00:00:00`)
    : new Date(endDate);
  if (Number.isNaN(parsedEndDate.getTime())) return false;

  if (parsedEndDate.getHours() === 0 && parsedEndDate.getMinutes() === 0) {
    parsedEndDate.setHours(23, 59, 59, 999);
  }

  return parsedEndDate.getTime() < now;
}

async function syncVisitorPassExpiration(visitorDoc, eventDoc = null) {
  if (!visitorDoc) return { isExpired: false, passStatus: 'active' };
  const targetEvent =
    eventDoc ||
    (visitorDoc.event && typeof visitorDoc.event === 'object' ? visitorDoc.event : null);
  const eventEnded = isEventPastEndDate(targetEvent);

  if (eventEnded && visitorDoc.registrationStatus === 'confirmed') {
    visitorDoc.registrationStatus = 'expired';
    if (typeof visitorDoc.save === 'function') {
      try {
        await visitorDoc.save();
      } catch (err) {
        console.warn('[VisitorRoutes] Could not persist expired pass status:', err.message);
      }
    }
  }

  const isExpired = visitorDoc.registrationStatus === 'expired' || eventEnded;
  const passStatus =
    visitorDoc.registrationStatus === 'cancelled'
      ? 'cancelled'
      : isExpired
        ? 'expired'
        : visitorDoc.checkInStatus === 'checked_in'
          ? 'checked_in'
          : visitorDoc.registrationStatus === 'pending'
            ? 'pending'
            : 'active';

  return { isExpired, passStatus };
}

router.get('/virtual-access/:visitorId', async (req, res, next) => {
  try {
    const { visitorId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(visitorId)) {
      return res.status(400).json({ success: false, error: 'Invalid visitor link.' });
    }

    const visitor = await Visitor.findById(visitorId).populate(
      'event',
      'title slug startDate endDate eventType status venue city livestream'
    );
    if (!visitor || !visitor.event) {
      return res.status(404).json({ success: false, error: 'Visitor registration was not found.' });
    }
    const { isExpired } = await syncVisitorPassExpiration(visitor, visitor.event);
    if (isExpired || visitor.registrationStatus === 'expired') {
      return res.status(403).json({
        success: false,
        code: 'PASS_EXPIRED',
        error: 'This visitor pass has expired because the event end date has passed and is no longer valid for entry.'
      });
    }
    if (visitor.registrationStatus !== 'confirmed') {
      return res.status(403).json({ success: false, error: 'This visitor registration is not confirmed.' });
    }
    if (!['virtual', 'hybrid'].includes(visitor.attendanceType) ||
        !['virtual', 'hybrid'].includes(visitor.event.eventType)) {
      return res.status(403).json({
        success: false,
        error: 'This registration does not include virtual event access.'
      });
    }

    const sessions = await Session.find({ event: visitor.event._id })
      .select('title description startTime endTime streamProvider streamUrl zoomMeetingId isLiveNow')
      .sort({ startTime: 1 })
      .lean();
    const streamUrl = getSafeHttpUrl(visitor.event.livestream?.streamUrl);

    return res.status(200).json({
      success: true,
      data: {
        visitor: {
          id: String(visitor._id),
          name: visitor.name,
          virtualJoinStatus: visitor.virtualJoinStatus,
          virtualJoinTime: visitor.virtualJoinTime
        },
        event: {
          id: String(visitor.event._id),
          title: visitor.event.title,
          slug: visitor.event.slug,
          startDate: visitor.event.startDate,
          endDate: visitor.event.endDate,
          eventType: visitor.event.eventType,
          status: visitor.event.status,
          venue: visitor.event.venue,
          city: visitor.event.city
        },
        stream: {
          enabled: visitor.event.livestream?.enabled === true,
          provider: visitor.event.livestream?.provider || '',
          status: visitor.event.livestream?.status || 'upcoming',
          streamUrl,
          zoomMeetingId: visitor.event.livestream?.zoomMeetingId || ''
        },
        sessions: sessions.map((session) => ({
          id: String(session._id),
          title: session.title,
          description: session.description || '',
          startTime: session.startTime,
          endTime: session.endTime,
          provider: session.streamProvider || '',
          streamUrl: getSafeHttpUrl(session.streamUrl),
          zoomMeetingId: session.zoomMeetingId || '',
          isLiveNow: session.isLiveNow === true
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// PUBLIC VISITOR REGISTRATION API (WordPress compatible)
// ==========================================
const registerVisitor = async (req, res, next, { enforceFreePlanLimit = false } = {}) => {
  try {
    const {
      eventId,
      eventSlug,
      eventTitle,
      eventVenue,
      eventCity,
      eventStartDate,
      eventEndDate,
      name,
      email,
      phone,
      company,
      designation,
      country,
      notes,
      attendanceType
    } = req.body;

    if (!eventId || !name || !email || !phone) {
      return res.status(400).json({ success: false, error: 'Event ID, Name, Email, and Phone are required' });
    }

    // 1. Verify event exists and is open (supports MongoDB ObjectId, slug, wpPostId, or title)
    let event = null;
    if (mongoose.Types.ObjectId.isValid(eventId) && String(new mongoose.Types.ObjectId(eventId)) === String(eventId)) {
      event = await Event.findById(eventId);
    }
    if (!event) {
      const rawIdStr = String(eventId).trim();
      const orConditions = [
        { slug: rawIdStr.toLowerCase() },
        { slug: rawIdStr },
        { wpPostId: rawIdStr }
      ];
      if (eventSlug) {
        const cleanSlug = String(eventSlug).trim();
        orConditions.push({ slug: cleanSlug.toLowerCase() }, { slug: cleanSlug }, { wpPostId: cleanSlug });
      }
      if (eventTitle) {
        orConditions.push({ title: String(eventTitle).trim() });
      }
      event = await Event.findOne({ $or: orConditions });
    }

    if (!event && (eventSlug || eventTitle)) {
      const regexOr = [];
      if (eventSlug) {
        const escapedSlug = String(eventSlug).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (escapedSlug) regexOr.push({ slug: new RegExp(`^${escapedSlug}$`, 'i') });
      }
      if (eventTitle) {
        const escapedTitle = String(eventTitle).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (escapedTitle) regexOr.push({ title: new RegExp(`^${escapedTitle}$`, 'i') });
      }
      if (regexOr.length > 0) {
        event = await Event.findOne({ $or: regexOr });
      }
    }

    // Auto-provision directory/WordPress event if not yet synced to MongoDB during visitor self-registration
    if (!event && !enforceFreePlanLimit && (eventTitle || eventSlug || eventId)) {
      const fallbackTitle = String(eventTitle || eventSlug || eventId).trim();
      const baseSlug = String(eventSlug || fallbackTitle)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || `expo-${Date.now()}`;
      const startDt = eventStartDate && !isNaN(new Date(eventStartDate).getTime())
        ? new Date(eventStartDate)
        : new Date(Date.now() + 30 * 86400000);
      const endDt = eventEndDate && !isNaN(new Date(eventEndDate).getTime())
        ? new Date(eventEndDate)
        : new Date(startDt.getTime() + 2 * 86400000);

      try {
        event = await Event.create({
          title: fallbackTitle,
          slug: `${baseSlug}-${Date.now().toString(36)}`,
          description: `Official trade exhibition listing for ${fallbackTitle}.`,
          venue: eventVenue || 'Exhibition & Convention Centre',
          city: eventCity || 'India',
          country: country || 'India',
          startDate: startDt,
          endDate: endDt,
          wpPostId: String(eventId).trim(),
          status: 'published',
          registrationSettings: { isOpen: true }
        });
      } catch (_) {
        event = await Event.findOne({ title: fallbackTitle });
      }
    }

    if (!event) {
      return res.status(404).json({ success: false, error: 'Target event could not be found for registration.' });
    }

    const resolvedEventId = event._id;

    if (event.registrationSettings && event.registrationSettings.isOpen === false) {
      return res.status(400).json({ success: false, error: 'Registrations are currently closed for this event' });
    }

    if (enforceFreePlanLimit && req.user.role !== 'super_admin') {
      const eventOwner =
        (event.organizer && req.user.organization &&
          event.organizer.toString() === req.user.organization.toString()) ||
        (event.claimedBy && event.claimedBy.toString() === req.user.id.toString()) ||
        (!event.organizer && !event.claimedBy);

      if (!eventOwner) {
        return res.status(403).json({ success: false, error: 'Not authorized to register visitors for this event' });
      }

      const user = await User.findById(req.user.id).select('plan organization');
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const plan = await getOrganizerBasePlan(user);

      if (plan === 'free') {
        const eventIds = await getOrganizerEventIds(user);
        if (!eventIds.some(id => id.toString() === event._id.toString())) {
          eventIds.push(event._id);
        }
        const registrationCount = await Visitor.countDocuments({ event: { $in: eventIds } });
        if (registrationCount >= FREE_VISITOR_REGISTRATION_LIMIT) {
          return res.status(403).json({
            success: false,
            code: 'FREE_PLAN_VISITOR_LIMIT',
            error: 'Free Plan limit reached. Upgrade your plan to register more visitors.',
            limit: FREE_VISITOR_REGISTRATION_LIMIT,
            used: registrationCount
          });
        }
      }
    }

    // 2. Check if already registered
    const existing = await Visitor.findOne({ event: resolvedEventId, email: email.toLowerCase() });
    if (existing) {
      if (enforceFreePlanLimit) {
        return res.status(400).json({ success: false, error: 'You are already registered for this event' });
      }
      await ensureVisitorQrCode(existing);
      const { isExpired, passStatus } = await syncVisitorPassExpiration(existing, event);
      if (isExpired) {
        return res.status(400).json({
          success: false,
          code: 'PASS_EXPIRED',
          error: 'This event has ended and your visitor pass has expired.'
        });
      }
      return res.status(200).json({
        success: true,
        alreadyRegistered: true,
        message: 'Your visitor registration and pass are confirmed',
        visitor: {
          id: existing._id,
          passId: `VIS-${existing._id.toString().toUpperCase()}`,
          name: existing.name,
          email: existing.email,
          phone: existing.phone,
          company: existing.company,
          designation: existing.designation,
          country: existing.country,
          qrCode: existing.qrCode,
          registrationStatus: existing.registrationStatus,
          isExpired,
          passStatus,
          attendanceType: existing.attendanceType,
          event: {
            id: event._id,
            title: event.title,
            startDate: event.startDate,
            endDate: event.endDate,
            venue: event.venue,
            city: event.city
          }
        }
      });
    }

    if (isEventPastEndDate(event)) {
      return res.status(400).json({
        success: false,
        code: 'EVENT_ENDED',
        error: 'Registrations are closed because this event has already ended.'
      });
    }

    // 3. Create Visitor
    const visitor = await Visitor.create({
      name,
      email: email.toLowerCase(),
      phone,
      company,
      designation,
      country: country || 'India',
      qrCode: createVisitorQrCode(),
      event: resolvedEventId,
      notes,
      attendanceType: attendanceType || 'in_person'
    });

    // 4. Automatically create a Lead in Lead CRM
    await Lead.create({
      name,
      email: email.toLowerCase(),
      phone,
      company,
      designation,
      country: country || 'India',
      leadScore: 30, // Start score for self-registration
      source: 'website',
      status: 'new',
      event: resolvedEventId,
      notes: notes || `Registered online (${attendanceType || 'in_person'}) via WordPress integration.`,
      activityTimeline: [
        {
          type: 'note',
          content: `Lead captured automatically from online event registration (${attendanceType || 'in_person'}).`
        }
      ]
    });

    // 5. Trigger Web Push notification to Organizer (Enterprise plan only)
    notifyOrganizerOnVisitor({
      event,
      visitor,
      type: 'registered'
    }).catch(pushErr => console.warn('[VisitorRoutes] Push notification warning:', pushErr.message));

    res.status(201).json({
      success: true,
      message: 'Registration completed successfully',
      visitor: {
        id: visitor._id,
        passId: `VIS-${visitor._id.toString().toUpperCase()}`,
        name: visitor.name,
        email: visitor.email,
        phone: visitor.phone,
        company: visitor.company,
        designation: visitor.designation,
        country: visitor.country,
        qrCode: visitor.qrCode,
        registrationStatus: visitor.registrationStatus,
        isExpired: false,
        passStatus: 'active',
        attendanceType: visitor.attendanceType,
        event: {
          id: event._id,
          title: event.title,
          startDate: event.startDate,
          endDate: event.endDate,
          venue: event.venue,
          city: event.city
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

router.post('/onboard', protect, authorize('super_admin', 'organizer'), (req, res, next) =>
  registerVisitor(req, res, next, { enforceFreePlanLimit: true })
);

router.post('/register', (req, res, next) => registerVisitor(req, res, next));

// Get logged-in visitor's registered passes & badges
router.post('/my-passes/:id/cancel', protect, async (req, res, next) => {
  try {
    const userEmail = req.user.email ? req.user.email.toLowerCase().trim() : '';
    if (!userEmail) {
      return res.status(400).json({ success: false, error: 'User email not found' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid visitor pass.' });
    }

    const visitor = await Visitor.findOne({ _id: req.params.id, email: userEmail })
      .populate('event', 'endDate status');
    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor pass not found.' });
    }

    const { isExpired } = await syncVisitorPassExpiration(visitor, visitor.event);
    if (isExpired || visitor.registrationStatus === 'expired') {
      return res.status(409).json({ success: false, error: 'Expired passes cannot be cancelled.' });
    }
    if (visitor.registrationStatus !== 'confirmed') {
      return res.status(409).json({ success: false, error: 'Only active visitor passes can be cancelled.' });
    }

    const hasBeenUsed =
      visitor.checkInStatus === 'checked_in' ||
      visitor.virtualJoinStatus === 'checked_in' ||
      visitor.virtualSessionsAttended?.length > 0 ||
      visitor.boothsVisited?.length > 0;
    if (hasBeenUsed) {
      return res.status(409).json({ success: false, error: 'Already-used passes cannot be cancelled.' });
    }

    const cancelledVisitor = await Visitor.findOneAndUpdate(
      {
        _id: visitor._id,
        email: userEmail,
        registrationStatus: 'confirmed',
        checkInStatus: { $ne: 'checked_in' },
        virtualJoinStatus: { $ne: 'checked_in' },
        virtualSessionsAttended: { $not: { $elemMatch: {} } },
        boothsVisited: { $not: { $elemMatch: {} } }
      },
      { $set: { registrationStatus: 'cancelled', qrCode: '' } },
      { new: true, runValidators: true }
    );

    if (!cancelledVisitor) {
      return res.status(409).json({
        success: false,
        error: 'This pass is no longer active or has already been used.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Visitor pass cancelled successfully.',
      data: {
        registrationStatus: 'cancelled',
        passStatus: 'cancelled',
        isExpired: false,
        qrCode: ''
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/my-passes', protect, async (req, res, next) => {
  try {
    const userEmail = req.user.email ? req.user.email.toLowerCase().trim() : '';
    if (!userEmail) {
      return res.status(400).json({ success: false, error: 'User email not found' });
    }

    const passes = await Visitor.find({ email: userEmail })
      .populate({
        path: 'event',
        select: 'title slug startDate endDate status venue city banner logo shortDescription organizer timings'
      })
      .sort({ createdAt: -1 });

    const serializedPasses = [];
    for (const pass of passes) {
      await ensureVisitorQrCode(pass);
      const { isExpired, passStatus } = await syncVisitorPassExpiration(pass);
      const raw = typeof pass.toObject === 'function' ? pass.toObject() : pass;
      serializedPasses.push({
        ...raw,
        passId: raw.passId || `VIS-${String(raw._id).toUpperCase()}`,
        isExpired,
        passStatus
      });
    }

    res.status(200).json({
      success: true,
      data: {
        docs: serializedPasses,
        totalDocs: serializedPasses.length
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get visitor statistics (Super Admin & Organizers)
// @route   GET /api/visitors/stats
router.get('/stats', protect, authorize('super_admin', 'organizer', 'event_manager'), async (req, res, next) => {
  try {
    const { eventId } = req.query;
    const query = {};

    if (eventId) {
      query.event = eventId;
    } else if (req.user.role === 'organizer') {
      const myEvents = await Event.find({
        $or: [
          { organizer: req.user.organization },
          { claimedBy: req.user.id }
        ]
      });
      query.event = { $in: myEvents.map(e => e._id) };
    }

    const [total, checkedIn, notCheckedIn, virtual, confirmed, pending, expired] = await Promise.all([
      Visitor.countDocuments(query),
      Visitor.countDocuments({ ...query, checkInStatus: 'checked_in' }),
      Visitor.countDocuments({ ...query, checkInStatus: 'not_checked_in' }),
      Visitor.countDocuments({ ...query, attendanceType: 'virtual' }),
      Visitor.countDocuments({ ...query, registrationStatus: 'confirmed' }),
      Visitor.countDocuments({ ...query, registrationStatus: 'pending' }),
      Visitor.countDocuments({ ...query, registrationStatus: 'expired' })
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        checkedIn,
        notCheckedIn,
        virtual,
        confirmed,
        pending,
        expired
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get visitors list for organizer dashboard
router.get('/', protect, authorize('super_admin', 'organizer', 'event_manager', 'sales_team', 'support'), async (req, res, next) => {
  try {
    const { eventId, page, limit, search, status, checkInStatus } = req.query;
    
    const query = {};

    if (eventId) {
      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ success: false, error: 'Target event not found' });
      }

      if (req.user.role === 'organizer') {
        const orgId = req.user.organization?._id || req.user.organization;
        const userId = req.user.id || req.user._id;

        const isOwner =
          (event.organizer && orgId && event.organizer.toString() === orgId.toString()) ||
          (event.claimedBy && userId && event.claimedBy.toString() === userId.toString()) ||
          (!event.organizer && !event.claimedBy);

        if (!isOwner) {
          const isUserAssigned = await Event.exists({
            _id: eventId,
            $or: [
              { organizer: orgId },
              { claimedBy: userId }
            ]
          });
          if (!isUserAssigned) {
            return res.status(403).json({ success: false, error: 'Not authorized to access visitors for this event' });
          }
        }
      }
      query.event = eventId;
    } else {
      if (req.user.role === 'organizer') {
        const myEvents = await Event.find({
          $or: [
            { organizer: req.user.organization },
            { claimedBy: req.user.id }
          ]
        });
        const myEventIds = myEvents.map(e => e._id);
        query.event = { $in: myEventIds };
      }
    }

    if (status && status !== 'all') {
      query.registrationStatus = status;
    }

    if (checkInStatus && checkInStatus !== 'all') {
      query.checkInStatus = checkInStatus;
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
      Visitor.find(query)
        .populate('event', 'title city startDate endDate status venue slug banner logo')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pgLimit),
      Visitor.countDocuments(query)
    ]);

    const serializedDocs = [];
    for (const doc of docs) {
      const { isExpired, passStatus } = await syncVisitorPassExpiration(doc);
      const raw = typeof doc.toObject === 'function' ? doc.toObject() : doc;
      serializedDocs.push({
        ...raw,
        isExpired,
        passStatus
      });
    }

    res.status(200).json({
      success: true,
      data: {
        docs: serializedDocs,
        total,
        page: pgNum,
        pages: Math.ceil(total / pgLimit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// Register Event Check-in
router.post('/checkin', protect, authorize('super_admin', 'organizer', 'event_manager', 'support'), async (req, res, next) => {
  try {
    const { qrCode, eventId } = req.body;
    let badgeToken = typeof qrCode === 'string' ? qrCode.trim() : '';
    let badgeEventId = eventId;

    if (badgeToken.startsWith('http://') || badgeToken.startsWith('https://')) {
      try {
        const scannedUrl = new URL(badgeToken);
        badgeToken = scannedUrl.searchParams.get('badgeToken') || badgeToken;
        badgeEventId = badgeEventId || scannedUrl.searchParams.get('eventId');
      } catch {
        return res.status(400).json({ success: false, error: 'The scanned badge URL is invalid.' });
      }
    }

    if (!badgeToken) {
      return res.status(400).json({ success: false, error: 'A valid visitor badge token is required' });
    }

    const visitorQuery = { qrCode: badgeToken };
    if (badgeEventId) {
      visitorQuery.event = badgeEventId;
    }

    const visitor = await Visitor.findOne(visitorQuery).populate('event', 'title startDate endDate status');
    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor not found with matching badge token' });
    }

    const { isExpired } = await syncVisitorPassExpiration(visitor, visitor.event);
    if (isExpired || visitor.registrationStatus === 'expired') {
      return res.status(400).json({
        success: false,
        code: 'PASS_EXPIRED',
        error: 'This visitor pass has expired because the event end date has passed and is no longer valid for entry or QR code verification.'
      });
    }

    if (visitor.registrationStatus !== 'confirmed') {
      return res.status(400).json({
        success: false,
        error: 'This visitor registration is not confirmed and cannot be checked in.'
      });
    }

    if (visitor.attendanceType === 'virtual') {
      return res.status(400).json({
        success: false,
        error: 'This visitor has a virtual pass and cannot use an in-person entry badge.'
      });
    }

    if (visitor.checkInStatus === 'checked_in') {
      return res.status(400).json({
        success: false,
        error: `Visitor already checked in at ${visitor.checkInTime.toLocaleTimeString()}`
      });
    }

    visitor.checkInStatus = 'checked_in';
    visitor.checkInTime = new Date();
    await visitor.save();

    // Trigger Web Push notification to Organizer (Enterprise plan only)
    notifyOrganizerOnVisitor({
      event: visitor.event?._id || visitor.event,
      visitor,
      type: 'checked_in'
    }).catch(pushErr => console.warn('[VisitorRoutes] Check-in push error:', pushErr.message));

    res.status(200).json({
      success: true,
      message: 'Visitor checked in successfully',
      visitor: {
        name: visitor.name,
        email: visitor.email,
        company: visitor.company,
        checkInTime: visitor.checkInTime,
        eventTitle: visitor.event?.title || (await Event.findById(visitor.event).select('title'))?.title || ''
      }
    });
  } catch (error) {
    next(error);
  }
});

// Register Virtual Event Join
router.post('/virtual-join', async (req, res, next) => {
  try {
    const { email, eventId, visitorId, viewerTimezone } = req.body;

    if (!visitorId && (!email || !eventId)) {
      return res.status(400).json({ success: false, error: 'Visitor ID or email and event ID are required' });
    }

    let visitor;
    if (visitorId) {
      if (!mongoose.Types.ObjectId.isValid(visitorId)) {
        return res.status(400).json({ success: false, error: 'Invalid visitor link.' });
      }
      visitor = await Visitor.findById(visitorId);
      if (!visitor) {
        return res.status(404).json({ success: false, error: 'Visitor registration was not found.' });
      }
      if (eventId && String(visitor.event) !== String(eventId)) {
        return res.status(403).json({ success: false, error: 'Visitor registration does not match this event.' });
      }
    } else {
      visitor = await Visitor.findOne({ event: eventId, email: email.toLowerCase().trim() });
    }
    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor registration not found for this email and event' });
    }
    const visitorEvent = await Event.findById(visitor.event).select('eventType startDate endDate status');
    if (!visitorEvent || !['virtual', 'hybrid'].includes(visitorEvent.eventType)) {
      return res.status(403).json({
        success: false,
        error: 'This event does not provide virtual access.'
      });
    }
    const { isExpired } = await syncVisitorPassExpiration(visitor, visitorEvent);
    if (isExpired || visitor.registrationStatus === 'expired') {
      return res.status(403).json({
        success: false,
        code: 'PASS_EXPIRED',
        error: 'This visitor pass has expired because the event end date has passed and is no longer valid for entry.'
      });
    }
    if (visitor.registrationStatus !== 'confirmed' ||
        !['virtual', 'hybrid'].includes(visitor.attendanceType)) {
      return res.status(403).json({
        success: false,
        error: 'A confirmed virtual or hybrid visitor registration is required to join.'
      });
    }

    if (visitor.virtualJoinStatus === 'checked_in') {
      return res.status(200).json({
        success: true,
        message: 'Visitor already joined virtually',
        visitor: {
          name: visitor.name,
          email: visitor.email,
          virtualJoinTime: visitor.virtualJoinTime,
          viewerTimezone: visitor.viewerTimezone
        }
      });
    }

    const targetEventId = visitor.event;
    visitor.virtualJoinStatus = 'checked_in';
    visitor.virtualJoinTime = new Date();
    if (viewerTimezone) {
      visitor.viewerTimezone = viewerTimezone;
    }
    await visitor.save();

    // Increment event virtual attendance stats
    try {
      await Event.findByIdAndUpdate(targetEventId, {
        $inc: {
          'virtualAttendanceStats.totalVirtualVisitors': 1,
          'virtualAttendanceStats.liveStreamViews': 1
        }
      });
    } catch (e) {
      // ignore
    }

    // Trigger Web Push notification to Organizer (Enterprise plan only)
    notifyOrganizerOnVisitor({
      event: targetEventId,
      visitor,
      type: 'virtual'
    }).catch(pushErr => console.warn('[VisitorRoutes] Virtual join push error:', pushErr.message));

    res.status(200).json({
      success: true,
      message: 'Visitor joined virtual event successfully',
      visitor: {
        name: visitor.name,
        email: visitor.email,
        virtualJoinTime: visitor.virtualJoinTime,
        viewerTimezone: visitor.viewerTimezone
      }
    });
  } catch (error) {
    next(error);
  }
});

// Clear all seed/dummy visitors for an event
router.delete('/clear-seed', protect, authorize('super_admin', 'organizer'), async (req, res, next) => {
  try {
    const { eventId } = req.query;
    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Event ID is required' });
    }

    const seedEmails = [
      'ananya@techcorp.com',
      'rajesh@patelsolutions.in',
      'vikram@fintech.org',
      'priya@creativeweb.in',
      'alex.novak@globaltech.cz',
      'meera@nairconsultancy.com'
    ];

    const result = await Visitor.deleteMany({
      event: eventId,
      email: { $in: seedEmails }
    });

    res.status(200).json({
      success: true,
      message: `Cleared ${result.deletedCount} seed dummy visitors successfully`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    next(error);
  }
});

// Update visitor registration status or check-in status
router.put('/:id/status', protect, authorize('super_admin', 'organizer'), async (req, res, next) => {
  try {
    const { registrationStatus, checkInStatus } = req.body;
    const visitor = await Visitor.findById(req.params.id);
    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor not found' });
    }

    if (registrationStatus && ['confirmed', 'pending', 'cancelled', 'expired'].includes(registrationStatus)) {
      visitor.registrationStatus = registrationStatus;
    }

    if (checkInStatus && ['checked_in', 'not_checked_in'].includes(checkInStatus)) {
      visitor.checkInStatus = checkInStatus;
      if (checkInStatus === 'checked_in') {
        visitor.checkInTime = new Date();
      } else {
        visitor.checkInTime = null;
      }
    }

    await visitor.save();

    res.status(200).json({
      success: true,
      message: 'Visitor status updated successfully',
      visitor
    });
  } catch (error) {
    next(error);
  }
});

// Delete individual visitor
router.delete('/:id', protect, authorize('super_admin', 'organizer'), async (req, res, next) => {
  try {
    const visitor = await Visitor.findById(req.params.id);
    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor not found' });
    }

    await Visitor.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Visitor deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
