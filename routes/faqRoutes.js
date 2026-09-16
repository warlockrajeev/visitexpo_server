/**
 * @file faqRoutes.js
 * @description Express API routes for Frequently Asked Questions (FAQ).
 * Public retrieval for frontend showcase and admin-protected moderation & CRUD.
 */

import express from 'express';
import Faq from '../models/Faq.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

const DEFAULT_FAQS = [
  {
    question: 'How do I claim or publish an event on VisitExpo?',
    answer:
      'Organizers can search for their event on the directory or click "Onboard as Organizer". Once your business email is verified, you gain instant dashboard access to manage schedules, booth floorplans, tickets, and attendee registrations.',
    category: 'Organizers',
    order: 1,
    isActive: true
  },
  {
    question: 'How can exhibitors book booths and collect visitor leads?',
    answer:
      'Exhibitors can click "Register as Exhibitor" on any listed expo. Once approved by the organizer, your team receives an Exhibitor Hub login with mobile QR lead scanner capabilities to capture and export buyer leads in real time.',
    category: 'Exhibitors',
    order: 2,
    isActive: true
  },
  {
    question: 'Are visitor entry passes complimentary?',
    answer:
      'Yes! Most trade exhibitions on VisitExpo offer complimentary digital entry passes for verified industry professionals and trade buyers. Simply register online to receive your instant digital pass and fast-track QR badge.',
    category: 'Visitors',
    order: 3,
    isActive: true
  },
  {
    question: 'What is the VisitExpo Global Network?',
    answer:
      'VisitExpo is an enterprise exhibition discovery and event SaaS platform connecting millions of trade buyers, verified organizers, and global exhibitors across automotive, medical, industrial, technology, and energy sectors.',
    category: 'General',
    order: 4,
    isActive: true
  },
  {
    question: 'How do I access my digital entry badge on event day?',
    answer:
      'Your digital pass is stored in your VisitExpo attendee dashboard and immediately emailed to you upon registration. Simply show the digital QR badge on your smartphone at the venue entrance for contactless fast-track entry.',
    category: 'Visitors',
    order: 5,
    isActive: true
  },
  {
    question: 'Can organizers export attendee analytics and lead reports?',
    answer:
      'Yes. The Super Admin and Organizer consoles provide comprehensive analytics on attendee turnouts, delegate designations, company profiles, and badge check-ins with one-click CSV/Excel export.',
    category: 'Organizers',
    order: 6,
    isActive: true
  }
];

// Helper to seed default FAQs if database collection is empty
const seedDefaultFaqsIfNeeded = async () => {
  try {
    const count = await Faq.countDocuments();
    if (count === 0) {
      await Faq.insertMany(DEFAULT_FAQS);
      console.log('[FAQ] Seeded default curated FAQs successfully.');
    }
  } catch (err) {
    console.error('[FAQ] Error auto-seeding default FAQs:', err.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/faqs
 * Fetch all active FAQs sorted by order and creation date.
 * Supports optional ?category= filter.
 */
router.get('/', async (req, res) => {
  try {
    await seedDefaultFaqsIfNeeded();

    const { category } = req.query;
    const filter = { isActive: true };

    if (category && category !== 'All' && category !== 'all') {
      filter.category = new RegExp(`^${category.trim()}$`, 'i');
    }

    const faqs = await Faq.find(filter)
      .sort({ order: 1, createdAt: 1 })
      .lean();

    // Distinct categories for tabs
    const allCategories = await Faq.distinct('category', { isActive: true });

    res.status(200).json({
      success: true,
      count: faqs.length,
      categories: ['All', ...allCategories.filter(Boolean)],
      data: faqs
    });
  } catch (err) {
    console.error('Error fetching FAQs:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch FAQs.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-PROTECTED ROUTES (super_admin)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/faqs/admin/all
 * List all FAQs (active and hidden) with counts, category filtering, search, and pagination.
 */
router.get('/admin/all', protect, authorize('super_admin'), async (req, res) => {
  try {
    await seedDefaultFaqsIfNeeded();

    const { search, category, status, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (category && category !== 'All' && category !== 'all') {
      filter.category = new RegExp(`^${category.trim()}$`, 'i');
    }

    if (status === 'active') {
      filter.isActive = true;
    } else if (status === 'hidden' || status === 'inactive') {
      filter.isActive = false;
    }

    if (search) {
      const q = search.trim();
      filter.$or = [
        { question: { $regex: q, $options: 'i' } },
        { answer: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [faqs, total, totalActive, totalHidden, distinctCategories] = await Promise.all([
      Faq.find(filter)
        .sort({ order: 1, createdAt: 1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Faq.countDocuments(filter),
      Faq.countDocuments({ isActive: true }),
      Faq.countDocuments({ isActive: false }),
      Faq.distinct('category')
    ]);

    res.status(200).json({
      success: true,
      count: faqs.length,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)) || 1,
      stats: {
        total: totalActive + totalHidden,
        active: totalActive,
        hidden: totalHidden
      },
      categories: ['All', ...distinctCategories.filter(Boolean)],
      data: faqs
    });
  } catch (err) {
    console.error('Error fetching admin FAQs:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch admin FAQs.' });
  }
});

/**
 * POST /api/faqs/admin
 * Create a new FAQ.
 */
router.post('/admin', protect, authorize('super_admin'), async (req, res) => {
  try {
    const { question, answer, category, order, isActive } = req.body;

    if (!question || !answer) {
      return res.status(400).json({
        success: false,
        error: 'Question and answer are required.'
      });
    }

    const newFaq = await Faq.create({
      question: question.trim(),
      answer: answer.trim(),
      category: (category || 'General').trim(),
      order: Number(order) || 0,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      createdBy: req.user?._id || null
    });

    res.status(201).json({
      success: true,
      message: 'FAQ created successfully.',
      data: newFaq
    });
  } catch (err) {
    console.error('Error creating FAQ:', err);
    res.status(500).json({ success: false, error: 'Failed to create FAQ.' });
  }
});

/**
 * PUT /api/faqs/admin/:id
 * Update an existing FAQ.
 */
router.put('/admin/:id', protect, authorize('super_admin'), async (req, res) => {
  try {
    const { question, answer, category, order, isActive } = req.body;

    const update = {};
    if (question !== undefined) update.question = question.trim();
    if (answer !== undefined) update.answer = answer.trim();
    if (category !== undefined) update.category = category.trim();
    if (order !== undefined) update.order = Number(order);
    if (isActive !== undefined) update.isActive = Boolean(isActive);

    const updatedFaq = await Faq.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true
    });

    if (!updatedFaq) {
      return res.status(404).json({ success: false, error: 'FAQ not found.' });
    }

    res.status(200).json({
      success: true,
      message: 'FAQ updated successfully.',
      data: updatedFaq
    });
  } catch (err) {
    console.error('Error updating FAQ:', err);
    res.status(500).json({ success: false, error: 'Failed to update FAQ.' });
  }
});

/**
 * PUT /api/faqs/admin/:id/toggle
 * Toggle active/hidden status of an FAQ.
 */
router.put('/admin/:id/toggle', protect, authorize('super_admin'), async (req, res) => {
  try {
    const faq = await Faq.findById(req.params.id);
    if (!faq) {
      return res.status(404).json({ success: false, error: 'FAQ not found.' });
    }

    faq.isActive = !faq.isActive;
    await faq.save();

    res.status(200).json({
      success: true,
      message: `FAQ is now ${faq.isActive ? 'active' : 'hidden'}.`,
      data: faq
    });
  } catch (err) {
    console.error('Error toggling FAQ status:', err);
    res.status(500).json({ success: false, error: 'Failed to toggle FAQ status.' });
  }
});

/**
 * DELETE /api/faqs/admin/:id
 * Permanently delete an FAQ.
 */
router.delete('/admin/:id', protect, authorize('super_admin'), async (req, res) => {
  try {
    const deletedFaq = await Faq.findByIdAndDelete(req.params.id);
    if (!deletedFaq) {
      return res.status(404).json({ success: false, error: 'FAQ not found.' });
    }

    res.status(200).json({
      success: true,
      message: 'FAQ deleted permanently.'
    });
  } catch (err) {
    console.error('Error deleting FAQ:', err);
    res.status(500).json({ success: false, error: 'Failed to delete FAQ.' });
  }
});

export default router;
