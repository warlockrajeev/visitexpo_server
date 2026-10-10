/**
 * @file leadRoutes.js
 * @description CRM lead management routing and pipeline controls.
 */

import express from 'express';
import mongoose from 'mongoose';
import Lead from '../models/Lead.js';
import Event from '../models/Event.js';
import User from '../models/User.js';
import { protect, authorize } from '../middlewares/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';

const router = express.Router();

// Optional JWT authentication helper for visitor-facing endpoints
const optionalAuth = (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      if (decoded) {
        req.user = {
          id: decoded.id,
          _id: decoded.id,
          email: decoded.email,
          role: decoded.role,
          organization: decoded.organization
        };
      }
    } catch (_) {}
  }
  next();
};

// =========================================================================
// 1. PUBLIC VISITOR LEAD CAPTURE ENDPOINTS (Runs before protect)
// =========================================================================

// @desc    Track visitor click / view on an event and automatically capture as a CRM Lead
// @route   POST /api/leads/track-click
// @access  Public / Optional Auth
router.post('/track-click', optionalAuth, async (req, res, next) => {
  try {
    const { eventId, eventSlug, visitor, user: bodyUser } = req.body;
    let currentUser = req.user || bodyUser || visitor;

    if (!eventId && !eventSlug) {
      return res.status(400).json({ success: false, error: 'Event identifier is required' });
    }

    // Resolve target event in MongoDB
    let targetEvent = null;
    if (eventId && mongoose.isValidObjectId(eventId)) {
      targetEvent = await Event.findById(eventId);
    }
    if (!targetEvent && eventSlug) {
      targetEvent = await Event.findOne({ slug: eventSlug.toLowerCase().trim() });
    }
    if (!targetEvent && eventId) {
      targetEvent = await Event.findOne({
        $or: [
          { slug: String(eventId).toLowerCase().trim() },
          { wpPostId: String(eventId) }
        ]
      });
    }

    if (!targetEvent) {
      return res.status(200).json({ success: true, message: 'Event not found in DB, skipping lead capture' });
    }

    // Fetch full profile if user ID exists
    let resolvedUser = currentUser;
    if (currentUser?.id || currentUser?._id) {
      const uId = currentUser.id || currentUser._id;
      if (mongoose.isValidObjectId(uId)) {
        const dbUser = await User.findById(uId).lean();
        if (dbUser) {
          resolvedUser = { ...dbUser, ...currentUser };
        }
      }
    }

    // If visitor has no identity yet (anonymous browsing)
    if (!resolvedUser || (!resolvedUser.email && !resolvedUser.phone)) {
      return res.status(200).json({
        success: true,
        message: 'Anonymous visitor interaction noted. Requires identity for CRM lead capture.',
        isAnonymous: true
      });
    }

    const email = (resolvedUser.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(200).json({ success: true, message: 'No email found for lead capture' });
    }

    // Check if the viewer is the organizer themselves
    const orgId = targetEvent.organizer ? String(targetEvent.organizer) : '';
    const claimedBy = targetEvent.claimedBy ? String(targetEvent.claimedBy) : '';
    const orgEmail = (targetEvent.organizerEmail || targetEvent.orgEmail || '').toLowerCase().trim();
    const currentUserId = String(resolvedUser.id || resolvedUser._id || '');

    if (
      (orgEmail && orgEmail === email) ||
      (orgId && orgId === currentUserId) ||
      (claimedBy && claimedBy === currentUserId)
    ) {
      // Avoid creating a lead when an organizer views their own event
      return res.status(200).json({ success: true, message: 'Organizer self-view ignored' });
    }

    const name = (resolvedUser.name || email.split('@')[0]).trim();
    const phone = resolvedUser.phone || '';
    const company = resolvedUser.company || resolvedUser.organization?.name || 'Prospective Attendee';
    const designation = resolvedUser.designation || 'Trade Visitor';
    const country = resolvedUser.country || targetEvent.country || 'India';

    // Check if lead already exists for this event + email
    let existingLead = await Lead.findOne({ event: targetEvent._id, email });

    if (existingLead) {
      // Increment intent score (+5 points per view, capped at 95)
      existingLead.leadScore = Math.min(95, (existingLead.leadScore || 25) + 5);
      if (phone && !existingLead.phone) existingLead.phone = phone;
      if (company && (!existingLead.company || existingLead.company === 'Prospective Attendee' || existingLead.company === 'Individual')) {
        existingLead.company = company;
      }
      if (designation && existingLead.designation === 'Trade Visitor') {
        existingLead.designation = designation;
      }

      existingLead.activityTimeline.push({
        type: 'note',
        content: `Clicked and explored event "${targetEvent.title}" on VisitExpo (${new Date().toLocaleDateString()}).`
      });
      await existingLead.save();

      return res.status(200).json({
        success: true,
        message: 'Lead interaction recorded & intent score boosted',
        lead: existingLead
      });
    }

    // Create new Lead for the organizer
    const newLead = await Lead.create({
      name,
      email,
      phone,
      company,
      designation,
      country,
      leadScore: 35, // Initial interest score for viewing event
      source: 'event_click',
      status: 'new',
      event: targetEvent._id,
      notes: `Captured when user clicked and explored event "${targetEvent.title}" on VisitExpo directory.`,
      activityTimeline: [
        {
          type: 'note',
          content: `Clicked and viewed event details page on VisitExpo directory.`
        }
      ]
    });

    return res.status(201).json({
      success: true,
      message: 'New lead successfully captured from event click',
      lead: newLead
    });
  } catch (error) {
    console.error('Error tracking event click lead:', error);
    next(error);
  }
});

// @desc    Direct attendee inquiry to organizer (e.g. Stall booking inquiry, delegate questions)
// @route   POST /api/leads/inquire
// @access  Public / Optional Auth
router.post('/inquire', optionalAuth, async (req, res, next) => {
  try {
    const { eventId, eventSlug, name, email, phone, company, designation, country, message, inquiryType } = req.body;
    const currentUser = req.user;

    if (!eventId && !eventSlug) {
      return res.status(400).json({ success: false, error: 'Event identifier is required' });
    }

    const leadEmail = (email || currentUser?.email || '').toLowerCase().trim();
    if (!leadEmail) {
      return res.status(400).json({ success: false, error: 'Work email is required' });
    }

    const leadName = (name || currentUser?.name || leadEmail.split('@')[0]).trim();

    // Resolve event
    let targetEvent = null;
    if (eventId && mongoose.isValidObjectId(eventId)) {
      targetEvent = await Event.findById(eventId);
    }
    if (!targetEvent && eventSlug) {
      targetEvent = await Event.findOne({ slug: eventSlug.toLowerCase().trim() });
    }
    if (!targetEvent && eventId) {
      targetEvent = await Event.findOne({
        $or: [
          { slug: String(eventId).toLowerCase().trim() },
          { wpPostId: String(eventId) }
        ]
      });
    }

    if (!targetEvent) {
      return res.status(404).json({ success: false, error: 'Target event not found' });
    }

    const leadPhone = phone || currentUser?.phone || '';
    const leadCompany = company || currentUser?.company || 'Interested Attendee';
    const leadDesignation = designation || currentUser?.designation || 'Trade Buyer';
    const leadCountry = country || currentUser?.country || targetEvent.country || 'India';
    const noteText = message ? `Inquiry (${inquiryType || 'General'}): ${message.trim()}` : `Direct attendee inquiry for "${targetEvent.title}".`;

    let existingLead = await Lead.findOne({ event: targetEvent._id, email: leadEmail });

    if (existingLead) {
      existingLead.leadScore = Math.max(existingLead.leadScore || 50, 80);
      existingLead.status = 'qualified';
      existingLead.notes = `${existingLead.notes ? existingLead.notes + ' | ' : ''}${noteText}`;
      existingLead.activityTimeline.push({
        type: 'email',
        content: `Submitted inquiry: ${message || 'Inquired about event details.'}`
      });
      await existingLead.save();

      return res.status(200).json({
        success: true,
        message: 'Inquiry received. The organizer has been notified.',
        lead: existingLead
      });
    }

    const newLead = await Lead.create({
      name: leadName,
      email: leadEmail,
      phone: leadPhone,
      company: leadCompany,
      designation: leadDesignation,
      country: leadCountry,
      leadScore: 80, // High-intent lead from direct inquiry
      source: 'inquiry',
      status: 'qualified',
      event: targetEvent._id,
      notes: noteText,
      activityTimeline: [
        {
          type: 'email',
          content: `Inquiry submitted via event page: ${message || 'Inquired about event details.'}`
        }
      ]
    });

    return res.status(201).json({
      success: true,
      message: 'Inquiry submitted successfully. Organizer has received your inquiry.',
      lead: newLead
    });
  } catch (error) {
    console.error('Error in lead inquiry:', error);
    next(error);
  }
});

// =========================================================================
// 2. PROTECTED ORGANIZER & ADMIN CRM ROUTES
// =========================================================================

// All organizer lead routes require authentication and organizer roles
router.use(protect);
router.use(authorize('super_admin', 'organizer', 'event_manager', 'sales_team', 'marketing_manager'));

// @desc    Get all leads for a specific event
// @route   GET /api/leads
router.get('/', async (req, res, next) => {
  try {
    const { eventId, status, search, page, limit } = req.query;

    const query = {};

    if (eventId && eventId !== 'all') {
      let event = null;
      if (mongoose.isValidObjectId(eventId)) {
        event = await Event.findById(eventId);
      } else {
        event = await Event.findOne({ slug: eventId.toLowerCase().trim() });
      }

      if (req.user.role === 'organizer') {
        const orgId = req.user.organization;
        const userId = req.user.id;
        const userEmail = (req.user.email || '').toLowerCase().trim();
        const eventOrgEmail = (event?.organizerEmail || event?.orgEmail || '').toLowerCase().trim();

        const isOwner = (event?.organizer && orgId && event.organizer.toString() === orgId.toString()) ||
                        (event?.organizer && userId && event.organizer.toString() === userId.toString()) ||
                        (event?.claimedBy && userId && event.claimedBy.toString() === userId.toString()) ||
                        (event?.claimedBy && orgId && event.claimedBy.toString() === orgId.toString()) ||
                        (eventOrgEmail && userEmail && eventOrgEmail === userEmail);
        if (!event || !isOwner) {
          return res.status(403).json({ success: false, error: 'Not authorized to access leads for this event' });
        }
      }
      query.event = event?._id || eventId;
    } else {
      if (req.user.role === 'organizer') {
        const orgId = req.user.organization;
        const userId = req.user.id;
        const userEmail = (req.user.email || '').toLowerCase().trim();

        const orConditions = [];
        if (orgId) {
          orConditions.push({ organizer: orgId });
          orConditions.push({ claimedBy: orgId });
        }
        if (userId) {
          orConditions.push({ organizer: userId });
          orConditions.push({ claimedBy: userId });
        }
        if (userEmail) {
          orConditions.push({ orgEmail: userEmail });
          orConditions.push({ organizerEmail: userEmail });
        }

        const myEvents = await Event.find(orConditions.length > 0 ? { $or: orConditions } : {});
        const myEventIds = myEvents.map(e => e._id);
        query.event = { $in: myEventIds };
      }
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (req.query.source && req.query.source !== 'all') {
      query.source = req.query.source;
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
        .populate('event', 'title slug city dates venue')
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

// @desc    Create a new lead manually
// @route   POST /api/leads
router.post('/', async (req, res, next) => {
  try {
    const { name, email, phone, company, designation, country, leadScore, status, source, eventId, notes } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Full name is required' });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Work email is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, error: 'Invalid email address format' });
    }

    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Target event ID is required' });
    }

    if (phone && /[a-zA-Z]/.test(phone)) {
      return res.status(400).json({ success: false, error: 'Phone number cannot contain alphabetic characters. Only numbers and valid phone symbols (+, -, space) are allowed.' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Target event not found' });
    }

    if (req.user.role === 'organizer') {
      const orgId = req.user.organization;
      const userId = req.user.id;
      const userEmail = (req.user.email || '').toLowerCase().trim();
      const eventOrgEmail = (event.organizerEmail || event.orgEmail || '').toLowerCase().trim();

      const isOwner = (event.organizer && orgId && event.organizer.toString() === orgId.toString()) ||
                      (event.organizer && userId && event.organizer.toString() === userId.toString()) ||
                      (event.claimedBy && userId && event.claimedBy.toString() === userId.toString()) ||
                      (event.claimedBy && orgId && event.claimedBy.toString() === orgId.toString()) ||
                      (eventOrgEmail && userEmail && eventOrgEmail === userEmail);

      if (!isOwner) {
        return res.status(403).json({ success: false, error: 'You can only add leads to events you organize or manage.' });
      }
    }

    const newLead = await Lead.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone ? phone.trim() : '',
      company: company ? company.trim() : '',
      designation: designation ? designation.trim() : '',
      country: country ? country.trim() : 'India',
      leadScore: leadScore !== undefined ? Number(leadScore) : 50,
      status: status || 'new',
      source: source || 'website',
      event: eventId,
      notes: notes || '',
      activityTimeline: [
        {
          type: 'note',
          content: 'Lead registered or added to the CRM hub.',
          performedBy: req.user.id
        }
      ]
    });

    res.status(201).json({
      success: true,
      message: 'Lead created successfully',
      lead: newLead
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Bulk import leads
// @route   POST /api/leads/bulk
router.post('/bulk', async (req, res, next) => {
  try {
    const { eventId, leads } = req.body;

    if (!eventId || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ success: false, error: 'Valid eventId and leads array are required' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Target event not found' });
    }

    if (req.user.role === 'organizer') {
      const orgId = req.user.organization;
      const userId = req.user.id;
      const userEmail = (req.user.email || '').toLowerCase().trim();
      const eventOrgEmail = (event.organizerEmail || event.orgEmail || '').toLowerCase().trim();

      const isOwner = (event.organizer && orgId && event.organizer.toString() === orgId.toString()) ||
                      (event.organizer && userId && event.organizer.toString() === userId.toString()) ||
                      (event.claimedBy && userId && event.claimedBy.toString() === userId.toString()) ||
                      (event.claimedBy && orgId && event.claimedBy.toString() === orgId.toString()) ||
                      (eventOrgEmail && userEmail && eventOrgEmail === userEmail);

      if (!isOwner) {
        return res.status(403).json({ success: false, error: 'You can only import leads to events you organize or manage.' });
      }
    }

    const preparedLeads = leads
      .filter(l => l.name && l.email)
      .map(l => ({
        name: l.name.trim(),
        email: l.email.toLowerCase().trim(),
        phone: l.phone ? String(l.phone).replace(/[a-zA-Z]/g, '').trim() : '',
        company: l.company ? l.company.trim() : '',
        designation: l.designation ? l.designation.trim() : '',
        country: l.country ? l.country.trim() : 'India',
        leadScore: l.leadScore !== undefined ? Number(l.leadScore) : 40,
        status: l.status || 'new',
        source: l.source || 'walk_in',
        event: eventId,
        notes: l.notes || 'Bulk imported into CRM',
        activityTimeline: [
          {
            type: 'note',
            content: 'Bulk imported attendee record',
            performedBy: req.user.id
          }
        ]
      }));

    if (preparedLeads.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid leads with name and email found' });
    }

    const inserted = await Lead.insertMany(preparedLeads);

    res.status(201).json({
      success: true,
      message: `Successfully imported ${inserted.length} leads`,
      count: inserted.length
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
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ success: false, error: 'Full name cannot be empty' });
      }
      lead.name = name.trim();
    }
    if (email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ success: false, error: 'Invalid email address format' });
      }
      lead.email = email.toLowerCase().trim();
    }
    if (phone !== undefined) {
      if (phone && /[a-zA-Z]/.test(phone)) {
        return res.status(400).json({ success: false, error: 'Phone number cannot contain alphabetic characters. Only numbers and valid phone symbols (+, -, space) are allowed.' });
      }
      lead.phone = phone ? phone.trim() : '';
    }
    if (company !== undefined) lead.company = company.trim();
    if (designation !== undefined) lead.designation = designation.trim();
    if (country !== undefined) lead.country = country.trim();
    if (leadScore !== undefined) lead.leadScore = Number(leadScore);
    if (status) lead.status = status;
    if (assignedSales !== undefined) lead.assignedSales = assignedSales || null;
    if (notes !== undefined) lead.notes = notes.trim();

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
