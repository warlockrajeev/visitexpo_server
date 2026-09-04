/**
 * @file contactRoutes.js
 * @description Endpoints for landing page inquiries (public submission) and Super Admin management.
 */

import express from 'express';
import ContactMessage from '../models/ContactMessage.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// ============================================================================
// PUBLIC ENDPOINTS
// ============================================================================

// @desc    Submit a new contact inquiry from the landing page
// @route   POST /api/contact
// @access  Public
router.post('/', async (req, res, next) => {
  try {
    const { role, name, email, phone, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and message are required fields.'
      });
    }

    const contact = await ContactMessage.create({
      role: role || 'Organizer',
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: (phone || '').trim(),
      message: message.trim(),
      status: 'new'
    });

    res.status(201).json({
      success: true,
      message: 'Inquiry received successfully. We will get back to you shortly.',
      data: contact
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ADMIN PROTECTED ENDPOINTS
// ============================================================================

router.use(protect);
router.use(authorize('super_admin'));

// @desc    Get all contact inquiries with search, filters & pagination
// @route   GET /api/contact
// @access  Super Admin
router.get('/', async (req, res, next) => {
  try {
    const { status, role, search, page = 1, limit = 50 } = req.query;

    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (role && role !== 'all') {
      query.role = role;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: regex },
        { email: regex },
        { message: regex },
        { phone: regex }
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    const [messages, total, newCount, inProgressCount, respondedCount] = await Promise.all([
      ContactMessage.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ContactMessage.countDocuments(query),
      ContactMessage.countDocuments({ status: 'new' }),
      ContactMessage.countDocuments({ status: 'in_progress' }),
      ContactMessage.countDocuments({ status: 'responded' })
    ]);

    const totalAll = await ContactMessage.countDocuments();

    res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum) || 1,
        limit: limitNum
      },
      stats: {
        total: totalAll,
        new: newCount,
        in_progress: inProgressCount,
        responded: respondedCount
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get single contact inquiry by ID
// @route   GET /api/contact/:id
// @access  Super Admin
router.get('/:id', async (req, res, next) => {
  try {
    const contact = await ContactMessage.findById(req.params.id);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Inquiry not found'
      });
    }

    res.status(200).json({
      success: true,
      data: contact
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update status or admin notes of an inquiry
// @route   PATCH /api/contact/:id
// @access  Super Admin
router.patch('/:id', async (req, res, next) => {
  try {
    const { status, adminNotes } = req.body;
    const contact = await ContactMessage.findById(req.params.id);

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Inquiry not found'
      });
    }

    if (status) {
      contact.status = status;
      if (status === 'responded' && !contact.respondedAt) {
        contact.respondedAt = new Date();
      }
    }

    if (adminNotes !== undefined) {
      contact.adminNotes = adminNotes;
    }

    await contact.save();

    res.status(200).json({
      success: true,
      message: 'Inquiry updated successfully',
      data: contact
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete an inquiry
// @route   DELETE /api/contact/:id
// @access  Super Admin
router.delete('/:id', async (req, res, next) => {
  try {
    const contact = await ContactMessage.findByIdAndDelete(req.params.id);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Inquiry not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Inquiry deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
