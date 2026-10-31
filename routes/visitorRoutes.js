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
import { protect, authorize } from '../middlewares/auth.js';
import { notifyOrganizerOnVisitor } from '../services/oneSignalService.js';

const router = express.Router();

function getSafeHttpUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const parsedUrl = new URL(value);
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.toString() : '';
  } catch {
    return '';
  }
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
router.post('/register', async (req, res, next) => {
  try {
    const { eventId, name, email, phone, company, designation, country, notes, attendanceType } = req.body;

    if (!eventId || !name || !email || !phone) {
      return res.status(400).json({ success: false, error: 'Event ID, Name, Email, and Phone are required' });
    }

    // 1. Verify event exists and is open
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Target event not found' });
    }

    if (!event.registrationSettings.isOpen) {
      return res.status(400).json({ success: false, error: 'Registrations are currently closed for this event' });
    }

    // 2. Check if already registered
    const existing = await Visitor.findOne({ event: eventId, email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, error: 'You are already registered for this event' });
    }

    // 3. Create Visitor
    const mockQRCode = `visitexpo-${eventId}-${email.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const visitor = await Visitor.create({
      name,
      email: email.toLowerCase(),
      phone,
      company,
      designation,
      country: country || 'India',
      qrCode: mockQRCode,
      event: eventId,
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
      event: eventId,
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
        name: visitor.name,
        email: visitor.email,
        qrCode: visitor.qrCode,
        registrationStatus: visitor.registrationStatus,
        attendanceType: visitor.attendanceType
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get logged-in visitor's registered passes & badges
router.get('/my-passes', protect, async (req, res, next) => {
  try {
    const userEmail = req.user.email ? req.user.email.toLowerCase().trim() : '';
    if (!userEmail) {
      return res.status(400).json({ success: false, error: 'User email not found' });
    }

    const passes = await Visitor.find({ email: userEmail })
      .populate({
        path: 'event',
        select: 'title slug startDate endDate venue city banner logo shortDescription organizer timings'
      })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        docs: passes,
        totalDocs: passes.length
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

    const [total, checkedIn, notCheckedIn, virtual, confirmed, pending] = await Promise.all([
      Visitor.countDocuments(query),
      Visitor.countDocuments({ ...query, checkInStatus: 'checked_in' }),
      Visitor.countDocuments({ ...query, checkInStatus: 'not_checked_in' }),
      Visitor.countDocuments({ ...query, attendanceType: 'virtual' }),
      Visitor.countDocuments({ ...query, registrationStatus: 'confirmed' }),
      Visitor.countDocuments({ ...query, registrationStatus: 'pending' })
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        checkedIn,
        notCheckedIn,
        virtual,
        confirmed,
        pending
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
        .populate('event', 'title city startDate venue slug banner logo')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pgLimit),
      Visitor.countDocuments(query)
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

    const visitor = await Visitor.findOne(visitorQuery);
    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor not found with matching badge token' });
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
      event: visitor.event,
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
        eventTitle: (await Event.findById(visitor.event).select('title'))?.title || ''
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
    const visitorEvent = await Event.findById(visitor.event).select('eventType');
    if (!visitorEvent || !['virtual', 'hybrid'].includes(visitorEvent.eventType)) {
      return res.status(403).json({
        success: false,
        error: 'This event does not provide virtual access.'
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

    if (registrationStatus && ['confirmed', 'pending', 'cancelled'].includes(registrationStatus)) {
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
