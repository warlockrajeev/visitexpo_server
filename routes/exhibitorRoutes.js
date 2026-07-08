/**
 * @file exhibitorRoutes.js
 * @description Exhibitor registration and dashboard management endpoints.
 */

import express from 'express';
import Event from '../models/Event.js';
import Exhibitor from '../models/Exhibitor.js';
import User from '../models/User.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// ==========================================
// PUBLIC EXHIBITOR REGISTRATION API
// ==========================================
router.post('/register', async (req, res, next) => {
  try {
    const { eventId, name, description, logo, website, contactEmail, contactPhone, attendanceType, staff, password } = req.body;

    if (!eventId || !name || !description || !contactEmail || !contactPhone) {
      return res.status(400).json({
        success: false,
        error: 'Event ID, Company Name, Description, Contact Email, and Contact Phone are required'
      });
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
    const exhibitors = await Exhibitor.find({ contactEmail: req.user.email })
      .populate('event', 'title city startDate venue description');
    
    if (!exhibitors || exhibitors.length === 0) {
      return res.status(404).json({ success: false, error: 'Exhibitor profile not found' });
    }

    res.status(200).json({
      success: true,
      data: exhibitors
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
      if (req.user.role === 'organizer') {
        const event = await Event.findById(eventId);
        if (!event || event.organizer.toString() !== req.user._id.toString()) {
          return res.status(403).json({ success: false, error: 'Not authorized to access exhibitors for this event' });
        }
      }
      query.event = eventId;
    } else {
      if (req.user.role === 'organizer') {
        const myEvents = await Event.find({ organizer: req.user._id });
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
      Exhibitor.find(query).sort({ createdAt: -1 }).skip(skip).limit(pgLimit),
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

// Approve/Reject Exhibitor
router.put('/:id/status', protect, authorize('super_admin', 'organizer', 'event_manager'), async (req, res, next) => {
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
    const associatedUser = await User.findOne({ email: exhibitor.contactEmail });
    if (associatedUser && associatedUser.role === 'exhibitor') {
      if (status === 'approved') {
        associatedUser.isVerified = true;
        await associatedUser.save();
      } else {
        // Only mark unverified if they have NO other approved exhibitor accounts
        const otherApproved = await Exhibitor.findOne({
          contactEmail: exhibitor.contactEmail,
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
