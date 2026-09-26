/**
 * @file exhibitorRoutes.js
 * @description Exhibitor registration and dashboard management endpoints.
 */

import express from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Exhibitor from '../models/Exhibitor.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import ContactMessage from '../models/ContactMessage.js';
import { protect, authorize } from '../middlewares/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { CURATED_DISCOVERY_EXHIBITORS } from '../data/curatedDiscoveryExhibitors.js';

const router = express.Router();

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
    const { eventId, name, description, logo, website, contactEmail, contactPhone, attendanceType, staff, password } = req.body;

    if (!eventId) {
      return res.status(400).json({
        success: false,
        error: 'Event ID is required. Please select an active event before onboarding an exhibitor.'
      });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Company Name is required.' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, error: 'Company Description is required.' });
    }
    if (!contactEmail || !contactEmail.trim()) {
      return res.status(400).json({ success: false, error: 'Contact Email is required.' });
    }
    if (!contactPhone || !contactPhone.trim()) {
      return res.status(400).json({ success: false, error: 'Contact Phone is required.' });
    }

    // 1. Verify target event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Target event not found' });
    }

    // 2. Check if already registered for this event
    const existing = await Exhibitor.findOne({ event: eventId, name: name.trim() });
    if (existing) {
      return res.status(400).json({ success: false, error: 'This company is already registered as an exhibitor for this event' });
    }

    // 3. Create Exhibitor (defaults status to pending)
    const exhibitor = await Exhibitor.create({
      name,
      description,
      logo: logo || '',
      website: website || '',
      contactEmail: contactEmail.toLowerCase(),
      contactPhone,
      event: eventId,
      attendanceType: attendanceType || 'in_person',
      staff: staff || [],
      status: 'pending'
    });

    // 4. Create User record for login
    let user = await User.findOne({ email: contactEmail.toLowerCase() });
    if (!user) {
      user = await User.create({
        name: name,
        email: contactEmail.toLowerCase(),
        password: password || 'defaultPassword123',
        role: 'exhibitor',
        isVerified: false
      });
    } else {
      // Safe update: do not overwrite role/verification status of organizers/admins!
      if (user.role === 'exhibitor') {
        if (password) {
          user.password = password;
          await user.save();
        }
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

    // Check if already registered for this event
    let exhibitor = await Exhibitor.findOne({ event: eventId, contactEmail });
    if (exhibitor) {
      const populated = await Exhibitor.findById(exhibitor._id)
        .populate('event', 'title city startDate venue description slug');
      return res.status(200).json({ success: true, message: 'Booth already exists for this event', exhibitor: populated });
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
      boothNumber: boothNumber || 'TBD',
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

// @desc    Get exhibitor counts by status & attendance type (Super Admin & Organizers)
// @route   GET /api/exhibitors/stats
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
router.get('/', protect, authorize('super_admin', 'organizer', 'event_manager', 'sales_team', 'support'), async (req, res, next) => {
  try {
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
    if (req.user?.id) {
      const user = await User.findById(req.user.id).select('credits');
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
router.post('/inquiry', optionalAuth, async (req, res, next) => {
  try {
    const {
      exhibitorId,
      exhibitorName,
      exhibitorEmail,
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

    // 1. Mandatory message length validation: min 100 characters, max 300 characters
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

    // 2. Resolve User & Charge 10 Credits
    const userId = req.user?.id || req.user?._id;
    let user = null;
    if (userId) {
      user = await User.findById(userId);
    } else if (senderEmail) {
      user = await User.findOne({ email: senderEmail.toLowerCase().trim() });
    }

    const CREDITS_TO_CHARGE = 10;
    let finalCredits = 90;

    if (user) {
      const currentCredits = user.credits !== undefined ? user.credits : 100;
      if (currentCredits < CREDITS_TO_CHARGE) {
        return res.status(400).json({
          success: false,
          error: `Insufficient credits. 10 credits are required to connect with this exhibitor. Your current balance is ${currentCredits} credits.`
        });
      }

      user.credits = currentCredits - CREDITS_TO_CHARGE;
      await user.save();
      finalCredits = user.credits;
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
        exhibitorEmail
      }
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

    // Authorization check: either super_admin/organizer/event_manager OR the exhibitor themselves editing their own profile
    const isMgmt = ['super_admin', 'organizer', 'event_manager'].includes(req.user.role);
    const isSelf = req.user.role === 'exhibitor' && exhibitor.contactEmail === req.user.email;

    if (!isMgmt && !isSelf) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this exhibitor profile' });
    }

    const { name, description, logo, website, contactEmail, contactPhone, boothNumber, attendanceType, staff } = req.body;

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

// Approve/Reject Exhibitor (Super Admin only)
router.put('/:id/status', protect, authorize('super_admin'), async (req, res, next) => {
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

    // Sync isVerified on User
    const emailEscaped = (exhibitor.contactEmail || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const associatedUser = await User.findOne({ email: { $regex: new RegExp(`^${emailEscaped}$`, 'i') } });
    if (associatedUser && associatedUser.role === 'exhibitor') {
      if (status === 'approved') {
        associatedUser.isVerified = true;
        await associatedUser.save();
      } else {
        // Only mark unverified if they have NO other approved exhibitor accounts
        const otherApproved = await Exhibitor.findOne({
          contactEmail: { $regex: new RegExp(`^${emailEscaped}$`, 'i') },
          _id: { $ne: exhibitor._id },
          status: 'approved'
        });
        if (!otherApproved) {
          associatedUser.isVerified = false;
          await associatedUser.save();
        }
      }
    }

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
router.delete('/:id', protect, authorize('super_admin', 'organizer'), async (req, res, next) => {
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
