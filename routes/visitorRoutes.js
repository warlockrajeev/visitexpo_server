/**
 * @file visitorRoutes.js
 * @description Visitor registration and CRM leads pipelines.
 */

import express from 'express';
import Event from '../models/Event.js';
import Visitor from '../models/Visitor.js';
import Lead from '../models/Lead.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

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

// ==========================================
// PRIVATE MANAGEMENT APIS
// ==========================================

// Get visitors list for organizer dashboard
router.get('/', protect, authorize('super_admin', 'organizer', 'event_manager', 'sales_team', 'support'), async (req, res, next) => {
  try {
    const { eventId, page, limit, search } = req.query;
    
    const query = {};

    if (eventId) {
      if (req.user.role === 'organizer') {
        const event = await Event.findById(eventId);
        const orgId = req.user.organization;
        const userId = req.user.id;
        const isOwner = (event?.organizer && orgId && event.organizer.toString() === orgId.toString()) ||
                        (event?.claimedBy && userId && event.claimedBy.toString() === userId.toString());
        if (!event || !isOwner) {
          return res.status(403).json({ success: false, error: 'Not authorized to access visitors for this event' });
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
      Visitor.find(query).sort({ createdAt: -1 }).skip(skip).limit(pgLimit),
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

    if (!qrCode || !eventId) {
      return res.status(400).json({ success: false, error: 'QR Code and Event ID are required' });
    }

    const visitor = await Visitor.findOne({ event: eventId, qrCode });
    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor not found with matching QR Code' });
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

    res.status(200).json({
      success: true,
      message: 'Visitor checked in successfully',
      visitor: {
        name: visitor.name,
        email: visitor.email,
        company: visitor.company,
        checkInTime: visitor.checkInTime
      }
    });
  } catch (error) {
    next(error);
  }
});

// Register Virtual Event Join
router.post('/virtual-join', async (req, res, next) => {
  try {
    const { email, eventId } = req.body;

    if (!email || !eventId) {
      return res.status(400).json({ success: false, error: 'Email and Event ID are required' });
    }

    const visitor = await Visitor.findOne({ event: eventId, email: email.toLowerCase() });
    if (!visitor) {
      return res.status(404).json({ success: false, error: 'Visitor registration not found for this email and event' });
    }

    if (visitor.attendanceType !== 'virtual') {
      return res.status(400).json({ success: false, error: 'Visitor is registered for in-person attendance. Use physical check-in.' });
    }

    if (visitor.virtualJoinStatus === 'checked_in') {
      return res.status(200).json({
        success: true,
        message: 'Visitor already joined virtually',
        visitor: {
          name: visitor.name,
          email: visitor.email,
          virtualJoinTime: visitor.virtualJoinTime
        }
      });
    }

    visitor.virtualJoinStatus = 'checked_in';
    visitor.virtualJoinTime = new Date();
    await visitor.save();

    res.status(200).json({
      success: true,
      message: 'Visitor joined virtual event successfully',
      visitor: {
        name: visitor.name,
        email: visitor.email,
        virtualJoinTime: visitor.virtualJoinTime
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
