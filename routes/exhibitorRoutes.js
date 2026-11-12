/**
 * @file exhibitorRoutes.js
 * @description Exhibitor registration and dashboard management endpoints.
 */

import express from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Exhibitor from '../models/Exhibitor.js';
import Lead from '../models/Lead.js';
import Visitor from '../models/Visitor.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import ContactMessage from '../models/ContactMessage.js';
import { protect, authorize } from '../middlewares/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';
import TwoFactorService from '../services/twoFactorService.js';
import { CURATED_DISCOVERY_EXHIBITORS } from '../data/curatedDiscoveryExhibitors.js';
import exhibitorEnquiryRoutes, { createExhibitorEnquiry } from './exhibitorEnquiryRoutes.js';

const router = express.Router();
router.use('/enquiries', exhibitorEnquiryRoutes);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getExhibitorOwnershipQuery = (user) => {
  const email = String(user.email || '').trim();
  if (!email) return { _id: null };
  const exactEmail = { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') };
  return {
    $or: [
      { contactEmail: exactEmail },
      { 'staff.email': exactEmail }
    ]
  };
};

const isEventPastEndDate = (event) => {
  if (!event) return false;
  if (['completed', 'ended', 'archived'].includes(String(event.status || '').toLowerCase())) return true;
  const endDate = event.endDate || event.startDate;
  if (!endDate) return false;
  const dateOnlyMatch = typeof endDate === 'string'
    ? endDate.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/)
    : null;
  const parsedEndDate = dateOnlyMatch ? new Date(`${dateOnlyMatch[1]}T00:00:00`) : new Date(endDate);
  if (Number.isNaN(parsedEndDate.getTime())) return false;
  if (parsedEndDate.getHours() === 0 && parsedEndDate.getMinutes() === 0) {
    parsedEndDate.setHours(23, 59, 59, 999);
  }
  return parsedEndDate.getTime() < Date.now();
};

// Optional JWT authentication helper for discovery endpoints
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
        req.user = decoded;
      }
    } catch (_) {}
  }
  next();
};

// ==========================================
// PUBLIC EXHIBITOR REGISTRATION API
// ==========================================
router.post('/register', async (req, res, next) => {
  try {
    const {
      eventId,
      name,
      description,
      logo,
      website,
      contactEmail,
      contactPhone,
      phoneVerificationToken,
      attendanceType,
      staff,
      password
    } = req.body;
    let callerToken;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      callerToken = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      callerToken = req.cookies.token;
    }
    let callerRole = '';
    if (callerToken) {
      try {
        callerRole = verifyAccessToken(callerToken)?.role || '';
      } catch {
        callerRole = '';
      }
    }
    const isManagedRegistration = ['super_admin', 'admin', 'sub_admin', 'subadmin', 'organizer', 'event_manager'].includes(callerRole);
    const cleanPhone = TwoFactorService.cleanPhoneNumber(contactPhone);
    const normalizedEmail = typeof contactEmail === 'string' ? contactEmail.trim().toLowerCase() : '';

    if (!eventId) {
      return res.status(400).json({
        success: false,
        error: 'Event ID is required. Please select an active event before onboarding an exhibitor.'
      });
    }
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) {
      return res.status(400).json({ success: false, error: 'Company name must be between 2 and 120 characters.' });
    }
    const minimumDescriptionLength = isManagedRegistration ? 1 : 20;
    if (typeof description !== 'string' || description.trim().length < minimumDescriptionLength || description.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        error: isManagedRegistration
          ? 'Company overview is required and cannot exceed 2,000 characters.'
          : 'Company overview must be between 20 and 2,000 characters.'
      });
    }
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, error: 'A valid contact email address is required.' });
    }
    const phoneIsValid = isManagedRegistration
      ? /^\d{8,15}$/.test(String(contactPhone || '').replace(/\D/g, ''))
      : /^[6-9]\d{9}$/.test(cleanPhone);
    if (!phoneIsValid) {
      return res.status(400).json({
        success: false,
        error: isManagedRegistration
          ? 'Enter a valid contact phone number with 8 to 15 digits.'
          : 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.'
      });
    }
    if (!isManagedRegistration && !TwoFactorService.validateVerificationToken(phoneVerificationToken, cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Verify your mobile number with OTP before submitting the exhibitor application.' });
    }
    if (website) {
      try {
        const parsedWebsite = new URL(website);
        if (!['http:', 'https:'].includes(parsedWebsite.protocol)) throw new Error('Invalid protocol');
      } catch {
        return res.status(400).json({ success: false, error: 'Enter a valid website URL beginning with http:// or https://.' });
      }
    }
    if (!isManagedRegistration && (
      typeof password !== 'string' ||
      password.length < 8 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password) ||
      !/[^A-Za-z0-9\s]/.test(password)
    )) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters and include uppercase and lowercase letters, a number, and a special character.'
      });
    }
    if (staff !== undefined && (!Array.isArray(staff) || staff.length > 25 || staff.some((member) => (
      !member ||
      typeof member.name !== 'string' ||
      !member.name.trim() ||
      typeof member.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(member.email.trim())
    )))) {
      return res.status(400).json({ success: false, error: 'Staff members must include a name and a valid email address (maximum 25 representatives).' });
    }

    // 1. Verify target event exists
    let event = null;
    if (eventId && mongoose.Types.ObjectId.isValid(eventId)) {
      event = await Event.findById(eventId);
    }
    if (!event && eventId) {
      event = await Event.findOne({
        $or: [
          { slug: String(eventId) },
          { wpPostId: parseInt(eventId, 10) || -1 },
          { wpPostId: String(eventId) },
          { 'metadata.wpPostId': String(eventId) }
        ]
      });
    }
    // If target event is a WordPress directory event not yet materialized in Mongo, auto-create it
    if (!event) {
      const eventTitle = req.body.eventTitle || req.body.title || (typeof eventId === 'string' ? eventId : 'Exhibition');
      const eventSlug = req.body.wpSlug || (typeof eventId === 'string' ? eventId : `event-${Date.now()}`);
      event = await Event.create({
        title: eventTitle,
        slug: eventSlug,
        wpPostId: parseInt(eventId, 10) || undefined,
        venue: req.body.venue || 'Exhibition Centre',
        city: req.body.city || 'India',
        startDate: req.body.startDate ? new Date(req.body.startDate) : new Date(),
        endDate: req.body.endDate ? new Date(req.body.endDate) : new Date(Date.now() + 86400000 * 3),
        status: 'published',
        isClaimed: false
      });
    }
    if (!event) {
      return res.status(404).json({ success: false, error: 'Target event not found' });
    }
    const existingUser = normalizedEmail ? await User.findOne({ email: normalizedEmail }) : null;
    if (!isManagedRegistration && existingUser && existingUser.role !== 'exhibitor') {
      return res.status(409).json({
        success: false,
        error: `This email is already registered as a ${existingUser.role}. Sign in to that account or use a different email for exhibitor registration.`,
        registeredRole: existingUser.role
      });
    }
    if (!isManagedRegistration && existingUser && (existingUser.isSuspended || existingUser.status === 'suspended')) {
      return res.status(403).json({
        success: false,
        error: 'This account has been suspended. Contact support@visitexpo.in before submitting an exhibitor application.'
      });
    }
    if (event.isClaimed && !isManagedRegistration) {
      return res.status(409).json({
        success: false,
        error: 'This event has already been claimed and is no longer accepting exhibitor applications through this form.'
      });
    }

    // Check if called by an organizer, enforce plan tier checks
    if (callerToken) {
      try {
        const decoded = verifyAccessToken(callerToken);
        if (decoded && decoded.role === 'organizer') {
          const userDoc = await User.findById(decoded.id).select('plan');
          const userPlan = (userDoc?.plan || 'free').toLowerCase();
          if (userPlan === 'free') {
            return res.status(403).json({
              success: false,
              error: 'Exhibitor onboarding is not permitted on the Free Organizer Plan. Please upgrade to Starter or Enterprise.',
              requiresUpgrade: true,
              currentPlan: 'free',
              requiredPlan: 'starter'
            });
          }
          if (userPlan === 'starter') {
            const count = await Exhibitor.countDocuments({ event: event._id });
            if (count >= 25) {
              return res.status(403).json({
                success: false,
                error: 'You have reached the Starter plan allowance of 25 exhibitors for this event (Normal Level). Upgrade to Enterprise for unlimited exhibitors.',
                requiresUpgrade: true,
                currentPlan: 'starter',
                requiredPlan: 'enterprise'
              });
            }
          }
        }
      } catch (_) {}
    }

    // 2. Check if already registered for this event
    const existing = await Exhibitor.findOne({ event: event._id, name: name.trim() });
    if (existing) {
      return res.status(400).json({ success: false, error: 'This company is already registered as an exhibitor for this event' });
    }
    if (!isManagedRegistration) {
      const activeExhibitor = await Exhibitor.exists({
        event: event._id,
        status: { $ne: 'rejected' }
      });
      if (activeExhibitor) {
        return res.status(409).json({
          success: false,
          error: 'This event already has an active exhibitor registration and is no longer available through public onboarding.'
        });
      }
    }

    // 3. Create Exhibitor (defaults status to pending)
    const exhibitor = await Exhibitor.create({
      name,
      description,
      logo: logo || '',
      website: website || '',
      contactEmail: normalizedEmail,
      contactPhone: isManagedRegistration ? String(contactPhone).trim() : cleanPhone,
      event: event._id,
      attendanceType: attendanceType || 'in_person',
      staff: staff || [],
      status: 'pending'
    });

    // 4. Create User record for login
    let user = existingUser;
    if (!user) {
      user = await User.create({
        name: name,
        email: normalizedEmail,
        password: password || 'defaultPassword123',
        role: 'exhibitor',
        isVerified: false,
        status: 'active'
      });
    } else {
      // Safe update: do not overwrite role/verification status of organizers/admins!
      if (user.role === 'exhibitor') {
        if (!user.isSuspended && user.status !== 'suspended') user.status = 'active';
        if (password) {
          user.password = password;
        }
        await user.save();
      }
    }

    res.status(201).json({
      success: true,
      message: 'Exhibitor registration request submitted successfully and is pending review.',
      exhibitor
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// PRIVATE MANAGEMENT APIS (Organizer & Admin)
// ==========================================

// @desc    Get logged in exhibitor's profile
// @route   GET /api/exhibitors/profile
router.get('/profile', protect, async (req, res, next) => {
  try {
    const userEmail = (req.user.email || '').toLowerCase().trim();
    
    // Look up exhibitor by contactEmail or staff email (case-insensitive)
    const orConditions = [
      { contactEmail: { $regex: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
      { 'staff.email': { $regex: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
    ];

    // Also match by organization name or user company name if available
    if (req.user.organization) {
      try {
        const org = await Organization.findById(req.user.organization);
        if (org && org.name) {
          orConditions.push({ name: { $regex: new RegExp(`^${org.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
        }
      } catch (err) {
        // Ignore organization lookup error
      }
    }

    if (req.user.company && req.user.company.trim()) {
      orConditions.push({ name: { $regex: new RegExp(`^${req.user.company.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
    }

    const exhibitors = await Exhibitor.find({ $or: orConditions })
      .populate('event', 'title city startDate venue description slug');
    
    res.status(200).json({
      success: true,
      data: exhibitors || []
    });
  } catch (error) {
    next(error);
  }
});

router.get('/leads', protect, authorize('exhibitor'), async (req, res, next) => {
  try {
    const exhibitorIds = await Exhibitor.find(getExhibitorOwnershipQuery(req.user)).distinct('_id');
    const leads = exhibitorIds.length
      ? await Lead.find({ exhibitor: { $in: exhibitorIds } })
        .populate('event', 'title city startDate endDate venue slug')
        .populate('exhibitor', 'name boothNumber')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()
      : [];

    res.status(200).json({ success: true, data: leads });
  } catch (error) {
    next(error);
  }
});

router.post('/leads/scan', protect, authorize('exhibitor'), async (req, res, next) => {
  try {
    const { exhibitorId } = req.body;
    let badgeToken = typeof req.body.qrCode === 'string' ? req.body.qrCode.trim() : '';
    let badgeEventId = '';

    if (!mongoose.isValidObjectId(exhibitorId)) {
      return res.status(400).json({ success: false, error: 'Select a valid exhibitor booth before scanning.' });
    }

    if (badgeToken.startsWith('http://') || badgeToken.startsWith('https://')) {
      try {
        const scannedUrl = new URL(badgeToken);
        badgeToken = scannedUrl.searchParams.get('badgeToken') || '';
        badgeEventId = scannedUrl.searchParams.get('eventId') || '';
      } catch {
        return res.status(400).json({ success: false, error: 'The scanned badge URL is invalid.' });
      }
    }

    if (!badgeToken || badgeToken.length > 256) {
      return res.status(400).json({ success: false, error: 'A valid visitor badge QR code is required.' });
    }

    const exhibitor = await Exhibitor.findOne({
      _id: exhibitorId,
      status: 'approved',
      ...getExhibitorOwnershipQuery(req.user)
    });
    if (!exhibitor) {
      return res.status(403).json({ success: false, error: 'This approved booth is not linked to your exhibitor account.' });
    }

    const visitor = await Visitor.findOne({ qrCode: badgeToken })
      .populate('event', 'title city country startDate endDate status');
    if (!visitor || !visitor.event) {
      return res.status(404).json({ success: false, error: 'No visitor pass matches this QR code.' });
    }
    if (badgeEventId && String(visitor.event._id) !== String(badgeEventId)) {
      return res.status(400).json({ success: false, error: 'The QR code does not match the visitor’s event.' });
    }
    if (String(visitor.event._id) !== String(exhibitor.event)) {
      return res.status(403).json({ success: false, error: 'This visitor pass is for a different event than the selected booth.' });
    }
    if (visitor.registrationStatus !== 'confirmed') {
      return res.status(400).json({ success: false, error: 'This visitor pass is not confirmed or is no longer active.' });
    }
    if (visitor.attendanceType === 'virtual') {
      return res.status(400).json({ success: false, error: 'Virtual visitor passes cannot be scanned for in-person leads.' });
    }
    if (isEventPastEndDate(visitor.event)) {
      return res.status(400).json({ success: false, code: 'PASS_EXPIRED', error: 'This visitor pass has expired because the event has ended.' });
    }

    const existingLead = await Lead.findOne({
      event: visitor.event._id,
      exhibitor: exhibitor._id,
      email: visitor.email.toLowerCase()
    });
    if (existingLead) {
      return res.status(200).json({
        success: true,
        alreadyCaptured: true,
        message: 'This visitor is already saved as a lead for your booth.',
        lead: existingLead
      });
    }

    let lead;
    try {
      lead = await Lead.create({
        name: visitor.name,
        email: visitor.email,
        phone: visitor.phone,
        company: visitor.company || '',
        designation: visitor.designation || '',
        country: visitor.country || visitor.event.country || '',
        leadScore: 50,
        source: 'exhibitor_scan',
        status: 'new',
        event: visitor.event._id,
        exhibitor: exhibitor._id,
        visitor: visitor._id,
        notes: `Scanned at ${exhibitor.name}${exhibitor.boothNumber ? ` (Booth ${exhibitor.boothNumber})` : ''}.`,
        activityTimeline: [{
          type: 'note',
          content: `Visitor badge scanned at ${exhibitor.name}${exhibitor.boothNumber ? ` (Booth ${exhibitor.boothNumber})` : ''}.`,
          performedBy: req.user.id
        }]
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      lead = await Lead.findOne({
        event: visitor.event._id,
        exhibitor: exhibitor._id,
        email: visitor.email.toLowerCase()
      });
      if (!lead) throw error;
      return res.status(200).json({
        success: true,
        alreadyCaptured: true,
        message: 'This visitor is already saved as a lead for your booth.',
        lead
      });
    }

    res.status(201).json({
      success: true,
      alreadyCaptured: false,
      message: 'Visitor saved as a new lead for your booth.',
      lead
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Quick setup/activate booth for logged in exhibitor
// @route   POST /api/exhibitors/quick-setup
router.post('/quick-setup', protect, async (req, res, next) => {
  try {
    const { eventId, name, description, logo, website, contactPhone, boothNumber, attendanceType, staff } = req.body;

    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Event selection is required' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Selected event not found' });
    }

    const companyName = name?.trim() || req.user.company || req.user.name || 'Exhibition Partner';
    const contactEmail = req.user.email.toLowerCase().trim();

    // Keep an existing request idempotent, but never allow another exhibitor to occupy the same event.
    let exhibitor = await Exhibitor.findOne({
      event: eventId,
      contactEmail,
      status: { $ne: 'rejected' }
    });
    if (exhibitor) {
      const populated = await Exhibitor.findById(exhibitor._id)
        .populate('event', 'title city startDate venue description slug');
      return res.status(200).json({ success: true, message: 'Booth already exists for this event', exhibitor: populated });
    }

    if (event.isClaimed) {
      return res.status(409).json({ success: false, error: 'This expo has already been claimed and is no longer available for booth registration.' });
    }

    const occupiedByAnotherExhibitor = await Exhibitor.exists({
      event: eventId,
      status: { $ne: 'rejected' }
    });
    if (occupiedByAnotherExhibitor) {
      return res.status(409).json({ success: false, error: 'This expo already has an exhibitor and is no longer available for booth registration.' });
    }

    // Default staff representative to logged in user if none provided
    const initialStaff = Array.isArray(staff) && staff.length > 0 
      ? staff 
      : [{ name: req.user.name || 'Primary Representative', email: contactEmail, phone: contactPhone || req.user.phone || '+91 98765 43210' }];

    exhibitor = await Exhibitor.create({
      name: companyName,
      description: description || `${companyName} is an official exhibitor showcasing innovative products and services.`,
      logo: logo || '',
      website: website || '',
      contactEmail,
      contactPhone: contactPhone || req.user.phone || '+91 98765 43210',
      boothNumber: boothNumber?.trim() || '',
      event: eventId,
      attendanceType: attendanceType || 'in_person',
      staff: initialStaff,
      status: 'pending' // Submitted for Super Admin approval
    });

    const populated = await Exhibitor.findById(exhibitor._id)
      .populate('event', 'title city startDate venue description slug');

    res.status(201).json({
      success: true,
      message: 'Exhibitor booth request submitted successfully and sent to Admin for approval',
      exhibitor: populated
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Claim an existing exhibitor listing in event catalogue
// @route   POST /api/exhibitors/claim
router.post('/claim', protect, async (req, res, next) => {
  try {
    const { exhibitorId } = req.body;
    if (!exhibitorId) {
      return res.status(400).json({ success: false, error: 'Exhibitor ID is required' });
    }

    const exhibitor = await Exhibitor.findById(exhibitorId);
    if (!exhibitor) {
      return res.status(404).json({ success: false, error: 'Exhibitor listing not found' });
    }

    // Link to logged in user's email
    exhibitor.contactEmail = req.user.email.toLowerCase().trim();
    if (!exhibitor.staff || exhibitor.staff.length === 0) {
      exhibitor.staff = [{ name: req.user.name || 'Primary Representative', email: req.user.email.toLowerCase().trim(), phone: req.user.phone || '' }];
    }
    exhibitor.status = 'approved';
    await exhibitor.save();

    const populated = await Exhibitor.findById(exhibitor._id)
      .populate('event', 'title city startDate venue description slug');

    res.status(200).json({
      success: true,
      message: 'Exhibitor listing successfully linked to your account',
      exhibitor: populated
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get exhibitor counts by status & attendance type (Super Admin, Subadmin & Organizers)
// @route   GET /api/exhibitors/stats
router.get('/stats', protect, authorize('super_admin', 'sub_admin', 'admin', 'organizer', 'event_manager'), async (req, res, next) => {
  try {
    if (req.user.role === 'organizer') {
      const userDoc = await User.findById(req.user.id).select('plan');
      const userPlan = (userDoc?.plan || 'free').toLowerCase();
      if (userPlan === 'free') {
        return res.status(403).json({
          success: false,
          error: 'Exhibitor Management is not available on the Free Organizer Plan. Please upgrade to Starter or Enterprise.',
          requiresUpgrade: true,
          currentPlan: 'free',
          requiredPlan: 'starter'
        });
      }
    }

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

    const [total, pending, approved, rejected, inPerson, virtual] = await Promise.all([
      Exhibitor.countDocuments(query),
      Exhibitor.countDocuments({ ...query, status: 'pending' }),
      Exhibitor.countDocuments({ ...query, status: 'approved' }),
      Exhibitor.countDocuments({ ...query, status: 'rejected' }),
      Exhibitor.countDocuments({ ...query, attendanceType: 'in_person' }),
      Exhibitor.countDocuments({ ...query, attendanceType: { $in: ['virtual', 'hybrid'] } })
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        pending,
        approved,
        rejected,
        inPerson,
        virtual
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get exhibitors list
router.get('/', protect, authorize('super_admin', 'sub_admin', 'admin', 'organizer', 'event_manager', 'sales_team', 'support'), async (req, res, next) => {
  try {
    if (req.user.role === 'organizer') {
      const userDoc = await User.findById(req.user.id).select('plan');
      const userPlan = (userDoc?.plan || 'free').toLowerCase();
      if (userPlan === 'free') {
        return res.status(403).json({
          success: false,
          error: 'Exhibitor Management is not available on the Free Organizer Plan. Please upgrade to Starter or Enterprise.',
          requiresUpgrade: true,
          currentPlan: 'free',
          requiredPlan: 'starter'
        });
      }
    }

    const { eventId, status, search, page, limit } = req.query;

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
            return res.status(403).json({ success: false, error: 'Not authorized to access exhibitors for this event' });
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
      query.status = status;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contactEmail: { $regex: search, $options: 'i' } },
        { boothNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const pgNum = parseInt(page, 10) || 1;
    const pgLimit = parseInt(limit, 10) || 20;
    const skip = (pgNum - 1) * pgLimit;

    const [docs, total] = await Promise.all([
      Exhibitor.find(query)
        .populate('event', 'title city startDate venue slug banner logo')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pgLimit),
      Exhibitor.countDocuments(query)
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

// ==========================================
// EXHIBITOR DISCOVERY & B2B INQUIRY (Virtual & Hybrid Platform)
// ==========================================

// @desc    Get exhibitors for Virtual & Hybrid Discovery with search and filters
// @route   GET /api/exhibitors/discovery
router.get('/discovery', optionalAuth, async (req, res, next) => {
  try {
    const { industry, product, country, origin, search } = req.query;

    // 1. Fetch any approved MongoDB exhibitors to merge seamlessly
    let dbExhibitors = [];
    try {
      const dbDocs = await Exhibitor.find({ status: 'approved' })
        .populate('event', 'title city venue startDate slug')
        .lean();

      dbExhibitors = dbDocs.map(doc => ({
        _id: String(doc._id),
        name: doc.name,
        origin: 'india',
        country: 'India',
        countryFlag: '🇮🇳',
        city: doc.event?.city || 'India',
        industry: doc.productCategories?.[0] || 'General Industry',
        logo: doc.logo || 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=150&auto=format&fit=crop&q=80',
        description: doc.description || 'Verified registered trade exhibitor.',
        products: doc.productCategories && doc.productCategories.length > 0 ? doc.productCategories : ['Exhibition Stall', 'B2B Trade Solutions'],
        attendanceType: doc.attendanceType || 'hybrid',
        boothNumber: doc.boothNumber || 'Hall 1 - Stand Assigned',
        eventTitle: doc.event?.title || 'National Exhibition',
        contactPerson: doc.staff?.[0]?.name || doc.name + ' Representative',
        contactDesignation: 'Exhibitor Contact',
        contactEmail: doc.contactEmail,
        contactPhone: doc.contactPhone,
        verified: true,
        rating: 4.8,
        virtualBoothUrl: `https://visitexpo.in/virtual-booth/${doc._id}`,
        creditsRequired: 10
      }));
    } catch (e) {
      console.warn('[Exhibitor Discovery] MongoDB query note:', e.message);
    }

    let allExhibitors = [...CURATED_DISCOVERY_EXHIBITORS, ...dbExhibitors];

    // Filter by Origin (all | india | global)
    if (origin && origin !== 'all') {
      allExhibitors = allExhibitors.filter(ex => ex.origin === origin.toLowerCase());
    }

    // Filter by Preferred Country
    if (country && country !== 'all') {
      const cleanCountry = country.toLowerCase().trim();
      allExhibitors = allExhibitors.filter(ex =>
        ex.country.toLowerCase().includes(cleanCountry) || cleanCountry.includes(ex.country.toLowerCase())
      );
    }

    // Filter by Preferred Industry
    if (industry && industry !== 'all') {
      const cleanInd = industry.toLowerCase().trim();
      allExhibitors = allExhibitors.filter(ex =>
        ex.industry.toLowerCase().includes(cleanInd) || cleanInd.includes(ex.industry.toLowerCase())
      );
    }

    // Filter by Search Products
    if (product && product.trim()) {
      const prodTerm = product.trim().toLowerCase();
      allExhibitors = allExhibitors.filter(ex =>
        ex.products.some(p => p.toLowerCase().includes(prodTerm)) ||
        ex.name.toLowerCase().includes(prodTerm) ||
        ex.description.toLowerCase().includes(prodTerm)
      );
    }

    // Generic search query
    if (search && search.trim()) {
      const sTerm = search.trim().toLowerCase();
      allExhibitors = allExhibitors.filter(ex =>
        ex.name.toLowerCase().includes(sTerm) ||
        ex.country.toLowerCase().includes(sTerm) ||
        ex.industry.toLowerCase().includes(sTerm) ||
        ex.products.some(p => p.toLowerCase().includes(sTerm))
      );
    }

    // User credit balance if user is logged in
    let userCredits = 100;
    const userId = req.user?.id || req.user?._id;
    if (userId) {
      const user = await User.findById(userId).select('credits');
      if (user) {
        userCredits = user.credits !== undefined ? user.credits : 100;
      }
    } else if (req.query?.email) {
      const user = await User.findOne({ email: String(req.query.email).toLowerCase().trim() }).select('credits');
      if (user) {
        userCredits = user.credits !== undefined ? user.credits : 100;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        total: allExhibitors.length,
        userCredits,
        exhibitors: allExhibitors
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Connect & Send B2B Inquiry to an Exhibitor (Charges 10 Credits)
// @route   POST /api/exhibitors/inquiry
router.post('/inquiry', protect, authorize('organizer', 'event_manager'), createExhibitorEnquiry);
router.post('/inquiry', optionalAuth, async (req, res, next) => {
  try {
    const {
      exhibitorId,
      exhibitorName,
      exhibitorEmail,
      exhibitorLogo,
      country,
      industry,
      products,
      message,
      senderName,
      senderEmail,
      senderPhone,
      senderCompany,
      inquiryType
    } = req.body;

    // 1. Mandatory message validation: length, content, and spam detection
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Inquiry message is required.'
      });
    }

    const trimmedMsg = message.trim();
    if (trimmedMsg.length < 100) {
      return res.status(400).json({
        success: false,
        error: `The message must contain a minimum of 100 characters. Currently has ${trimmedMsg.length} characters.`
      });
    }

    if (trimmedMsg.length > 300) {
      return res.status(400).json({
        success: false,
        error: `The message cannot exceed 300 characters. Currently has ${trimmedMsg.length} characters.`
      });
    }

    // Check for HTML tags or script injection
    if (/<[a-z][\s\S]*>/i.test(trimmedMsg)) {
      return res.status(400).json({
        success: false,
        error: 'HTML tags and script code are not permitted in enquiry messages.'
      });
    }

    // Check for excessive repeated characters (e.g. aaaaa, ......, !!!!!!!)
    if (/(.)\1{4,}/.test(trimmedMsg)) {
      return res.status(400).json({
        success: false,
        error: 'Excessive repeated characters detected. Please write a genuine B2B inquiry.'
      });
    }

    // Check for symbols or gibberish spam (must have at least 60% alphabetic of non-space characters)
    const nonSpace = trimmedMsg.replace(/\s+/g, '');
    const letters = trimmedMsg.match(/[a-zA-Z]/g) || [];
    if (letters.length === 0 || (letters.length / nonSpace.length) < 0.6) {
      return res.status(400).json({
        success: false,
        error: 'Message must consist of genuine text and words, not symbols or random characters.'
      });
    }

    // Check for minimum word count (at least 10 words)
    const words = trimmedMsg.split(/\s+/).filter((w) => /[a-zA-Z]{2,}/.test(w));
    if (words.length < 10) {
      return res.status(400).json({
        success: false,
        error: `Please write a complete enquiry with at least 10 words (currently ${words.length}).`
      });
    }

    // Check for repetitive words spam (e.g. "quote quote quote quote...")
    const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
    if (uniqueWords.size < Math.min(6, Math.floor(words.length * 0.4))) {
      return res.status(400).json({
        success: false,
        error: 'Please avoid repetitive words and write a meaningful B2B enquiry.'
      });
    }

    // 2. Resolve User & Charge 10 Credits
    const userId = req.user?.id || req.user?._id;
    let user = null;
    if (userId) {
      user = await User.findById(userId);
    }
    if (!user && senderEmail) {
      user = await User.findOne({ email: senderEmail.toLowerCase().trim() });
    }

    const CREDITS_TO_CHARGE = 10;
    let finalCredits = 90;

    // Optional active credit balance supplied by client from local test credit top-up
    const clientCredits =
      req.body.currentCredits !== undefined && req.body.currentCredits !== null
        ? Number(req.body.currentCredits)
        : null;

    if (user) {
      // If client supplied their active credit balance that is higher (e.g. from test credit top-up),
      // synchronize user.credits to reflect the test top-up immediately
      if (clientCredits !== null && !isNaN(clientCredits) && clientCredits > (user.credits || 0)) {
        user.credits = clientCredits;
      }

      const currentCredits = user.credits !== undefined ? user.credits : 100;
      if (currentCredits < CREDITS_TO_CHARGE) {
        return res.status(400).json({
          success: false,
          error: `Insufficient credits. 10 credits are required to connect with this exhibitor. Your current balance is ${currentCredits} credits.`
        });
      }

      user.credits = Math.max(0, currentCredits - CREDITS_TO_CHARGE);
      await user.save();
      finalCredits = user.credits;
    } else {
      // Demo / Guest organizer fallback
      const currentCredits = clientCredits !== null && !isNaN(clientCredits) ? clientCredits : 100;
      if (currentCredits < CREDITS_TO_CHARGE) {
        return res.status(400).json({
          success: false,
          error: `Insufficient credits. 10 credits are required to connect with this exhibitor. Your current balance is ${currentCredits} credits.`
        });
      }
      finalCredits = Math.max(0, currentCredits - CREDITS_TO_CHARGE);
    }

    // 3. Save Inquiry record in ContactMessage
    const inquiryRecord = await ContactMessage.create({
      role: 'Organizer',
      source: 'exhibitor_discovery',
      name: senderName || user?.name || 'Verified Event Organizer',
      email: (senderEmail || user?.email || 'organizer@visitexpo.in').toLowerCase().trim(),
      phone: senderPhone || user?.phone || '',
      message: trimmedMsg,
      status: 'new',
      meta: {
        exhibitorId: exhibitorId || 'unknown',
        exhibitorName: exhibitorName || 'Trade Exhibitor',
        exhibitorEmail: exhibitorEmail || '',
        exhibitorLogo: exhibitorLogo || '',
        country: country || 'Global',
        industry: industry || 'Trade Exhibition',
        products: Array.isArray(products) ? products.join(', ') : products || '',
        inquiryType: inquiryType || 'B2B Trade Partnership',
        senderCompany: senderCompany || user?.company || '',
        creditsCharged: CREDITS_TO_CHARGE,
        remainingCredits: finalCredits,
        platform: 'Exhibitor Discovery',
        timestamp: new Date()
      }
    });

    res.status(201).json({
      success: true,
      message: `Enquiry sent successfully to "${exhibitorName || 'Exhibitor'}". 10 credits have been charged.`,
      data: {
        inquiryId: inquiryRecord._id,
        creditsCharged: CREDITS_TO_CHARGE,
        remainingCredits: finalCredits,
        exhibitorName,
        exhibitorEmail,
        exhibitorLogo: exhibitorLogo || ''
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Top up organizer test credits
// @route   POST /api/exhibitors/topup
router.post('/topup', optionalAuth, async (req, res, next) => {
  try {
    const amount = Number(req.body.amount) || 50;
    const userId = req.user?.id || req.user?._id;
    const email = req.body.email;

    let user = null;
    if (userId) {
      user = await User.findById(userId);
    }
    if (!user && email) {
      user = await User.findOne({ email: String(email).toLowerCase().trim() });
    }

    let currentCredits;
    const target = req.body.targetCredits !== undefined ? Number(req.body.targetCredits) : null;

    if (user) {
      if (target !== null && !isNaN(target)) {
        user.credits = target;
      } else {
        const base = user.credits !== undefined ? user.credits : 100;
        user.credits = base + amount;
      }
      await user.save();
      currentCredits = user.credits;
    } else {
      if (target !== null && !isNaN(target)) {
        currentCredits = target;
      } else {
        const baseCredits = req.body.currentCredits !== undefined ? Number(req.body.currentCredits) : 100;
        currentCredits = baseCredits + amount;
      }
    }

    res.status(200).json({
      success: true,
      message: `Successfully added ${amount} credits.`,
      data: {
        credits: currentCredits,
        added: amount
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get organizer credit balance
// @route   GET /api/exhibitors/credits
router.get('/credits', optionalAuth, async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const email = req.query?.email;

    let user = null;
    if (userId) {
      user = await User.findById(userId).select('credits');
    }
    if (!user && email) {
      user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('credits');
    }

    const credits = user ? (user.credits !== undefined ? user.credits : 100) : 100;
    res.status(200).json({
      success: true,
      data: { credits }
    });
  } catch (error) {
    next(error);
  }
});

// Get single Exhibitor details
router.get('/:id', protect, async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return next();
  }
  try {
    const exhibitor = await Exhibitor.findById(req.params.id)
      .populate('event', 'title city startDate endDate venue slug banner logo description organizer');

    if (!exhibitor) {
      return res.status(404).json({ success: false, error: 'Exhibitor not found' });
    }

    res.status(200).json({
      success: true,
      exhibitor
    });
  } catch (error) {
    next(error);
  }
});

// Update Exhibitor details (e.g. assign booth or edit profile)
router.put('/:id', protect, async (req, res, next) => {
  try {
    const exhibitor = await Exhibitor.findById(req.params.id);
    if (!exhibitor) {
      return res.status(404).json({ success: false, error: 'Exhibitor not found' });
    }

    // Authorization check: either super_admin/sub_admin/admin/organizer/event_manager OR the exhibitor themselves editing their own profile
    const isMgmt = ['super_admin', 'sub_admin', 'admin', 'organizer', 'event_manager'].includes(req.user.role);
    const isSelf = req.user.role === 'exhibitor' && exhibitor.contactEmail === req.user.email;

    if (!isMgmt && !isSelf) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this exhibitor profile' });
    }

    if (req.user.role === 'organizer') {
      const userDoc = await User.findById(req.user.id).select('plan');
      const userPlan = (userDoc?.plan || 'free').toLowerCase();
      if (userPlan === 'free') {
        return res.status(403).json({
          success: false,
          error: 'Exhibitor Management is not available on the Free Organizer Plan. Please upgrade to Starter or Enterprise.',
          requiresUpgrade: true,
          currentPlan: 'free',
          requiredPlan: 'starter'
        });
      }
    }

    const {
      name,
      description,
      logo,
      website,
      contactEmail,
      contactPhone,
      boothNumber,
      attendanceType,
      staff,
      isVipFeatured,
      priorityHall,
      leadRetrievalStatus
    } = req.body;

    // Update fields if provided
    if (name && isMgmt) exhibitor.name = name;
    if (description) exhibitor.description = description;
    if (logo !== undefined) exhibitor.logo = logo;
    if (website !== undefined) exhibitor.website = website;
    if (contactEmail && isMgmt) exhibitor.contactEmail = contactEmail.toLowerCase();
    if (contactPhone) exhibitor.contactPhone = contactPhone;
    if (boothNumber !== undefined && isMgmt) exhibitor.boothNumber = boothNumber;
    if (attendanceType) exhibitor.attendanceType = attendanceType;
    if (staff) exhibitor.staff = staff;

    // Advance Level Enterprise Fields
    if (isVipFeatured !== undefined && isMgmt) {
      if (req.user.role === 'organizer') {
        const userDoc = await User.findById(req.user.id).select('plan');
        const userPlan = (userDoc?.plan || 'free').toLowerCase();
        if (userPlan !== 'enterprise' && userPlan !== 'growth') {
          return res.status(403).json({
            success: false,
            error: 'VIP & Featured Exhibitor Badging is an advance feature available exclusively on the Enterprise Plan.',
            requiresUpgrade: true,
            requiredPlan: 'enterprise'
          });
        }
      }
      exhibitor.isVipFeatured = Boolean(isVipFeatured);
    }
    if (priorityHall !== undefined && isMgmt) {
      exhibitor.priorityHall = priorityHall;
    }
    if (leadRetrievalStatus !== undefined && isMgmt) {
      exhibitor.leadRetrievalStatus = leadRetrievalStatus;
    }

    await exhibitor.save();

    // Sync to event if approved
    if (exhibitor.status === 'approved') {
      const event = await Event.findById(exhibitor.event);
      if (event) {
        event.exhibitors = event.exhibitors.map(e => {
          if (e.name === exhibitor.name) {
            return {
              name: exhibitor.name,
              logo: exhibitor.logo,
              boothNumber: exhibitor.boothNumber,
              website: exhibitor.website,
              description: exhibitor.description
            };
          }
          return e;
        });
        await event.save();
      }
    }

    res.status(200).json({
      success: true,
      message: 'Exhibitor updated successfully',
      exhibitor
    });
  } catch (error) {
    next(error);
  }
});

// Approve/Reject Exhibitor (Super Admin & Subadmins)
router.put('/:id/status', protect, authorize('super_admin', 'sub_admin', 'admin'), async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status || !['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Valid status (approved, rejected, pending) is required' });
    }

    const exhibitor = await Exhibitor.findById(req.params.id);
    if (!exhibitor) {
      return res.status(404).json({ success: false, error: 'Exhibitor not found' });
    }

    exhibitor.status = status;
    await exhibitor.save();

    // Sync to event if approved (optional side-effect matching old embedded behavior)
    if (status === 'approved') {
      const event = await Event.findById(exhibitor.event);
      if (event) {
        // Ensure not already in event.exhibitors array
        const exists = event.exhibitors.some(e => e.name === exhibitor.name);
        if (!exists) {
          event.exhibitors.push({
            name: exhibitor.name,
            logo: exhibitor.logo,
            boothNumber: exhibitor.boothNumber,
            website: exhibitor.website,
            description: exhibitor.description
          });
          await event.save();
        }
      }
    } else {
      // If rejected or reverted to pending, remove from event.exhibitors list
      const event = await Event.findById(exhibitor.event);
      if (event) {
        event.exhibitors = event.exhibitors.filter(e => e.name !== exhibitor.name);
        await event.save();
      }
    }

    res.status(200).json({
      success: true,
      message: `Exhibitor request set to ${status} successfully`,
      exhibitor
    });
  } catch (error) {
    next(error);
  }
});

// Delete Exhibitor
router.delete('/:id', protect, authorize('super_admin', 'sub_admin', 'admin', 'organizer'), async (req, res, next) => {
  try {
    const exhibitor = await Exhibitor.findById(req.params.id);
    if (!exhibitor) {
      return res.status(404).json({ success: false, error: 'Exhibitor not found' });
    }

    // Also clean up from Event's embedded exhibitor list
    const event = await Event.findById(exhibitor.event);
    if (event) {
      event.exhibitors = event.exhibitors.filter(e => e.name !== exhibitor.name);
      await event.save();
    }

    await Exhibitor.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Exhibitor deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
