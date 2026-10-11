/**
 * @file featuredOrganizerRoutes.js
 * @description REST API routes for Featured Organizers:
 * - Public list of approved & active featured organizers
 * - Enterprise organizer applications (exclusive to Enterprise Plan)
 * - Super Admin full moderation, manual creation, edit, toggle, and review
 */

import express from 'express';
import FeaturedOrganizer from '../models/FeaturedOrganizer.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// Baseline organizers for auto-seeding if collection is initially empty
const BASELINE_FEATURED_ORGANIZERS = [
  {
    name: 'Informa Markets',
    shortName: 'Informa Markets',
    slug: 'informa-markets',
    brandColor: '#002D62',
    accentColor: '#00A3E0',
    website: 'https://www.informamarkets.com',
    badge: 'Global Leader',
    scope: 'World’s leading B2B exhibitions, trade fairs, and market-making platforms.',
    category: 'Trade & Industry',
    eventsCount: 20,
    displayOrder: 1,
    status: 'approved',
    isActive: true
  },
  {
    name: 'Indian Exhibition Services (IES)',
    shortName: 'IES India',
    slug: 'ies-india',
    brandColor: '#1E40AF',
    accentColor: '#3B82F6',
    website: 'https://ies-india.com',
    badge: 'National Trade Expos',
    scope: 'Premier industrial trade exhibitions, manufacturing expos, and DRR conventions.',
    category: 'Trade & Industry',
    eventsCount: 14,
    displayOrder: 2,
    status: 'approved',
    isActive: true
  },
  {
    name: 'Messe Frankfurt',
    shortName: 'Messe Frankfurt',
    slug: 'messe-frankfurt',
    brandColor: '#DC2626',
    accentColor: '#F59E0B',
    website: 'https://www.messefrankfurt.com',
    badge: 'German Fairs',
    scope: 'World’s largest trade fair, congress and event organiser with own grounds.',
    category: 'Trade & Industry',
    eventsCount: 14,
    displayOrder: 3,
    status: 'approved',
    isActive: true
  },
  {
    name: 'RX India (Reed Exhibitions)',
    shortName: 'RX India',
    slug: 'rx-india',
    brandColor: '#1E3A8A',
    accentColor: '#0284C7',
    website: 'https://rxglobal.com/rx-india',
    badge: 'Reed Exhibitions',
    scope: 'Global events powerhouse driving targeted market access and matchmaking.',
    category: 'Trade & Industry',
    eventsCount: 9,
    displayOrder: 4,
    status: 'approved',
    isActive: true
  },
  {
    name: 'NürnbergMesse India',
    shortName: 'NürnbergMesse',
    slug: 'nurnbergmesse',
    brandColor: '#0284C7',
    accentColor: '#0EA5E9',
    website: 'https://www.nm-india.com',
    badge: 'German Excellence',
    scope: 'Premier specialty exhibitions for architecture, building tech, and hardware.',
    category: 'Trade & Industry',
    eventsCount: 8,
    displayOrder: 5,
    status: 'approved',
    isActive: true
  },
  {
    name: 'Messe Düsseldorf India',
    shortName: 'Messe Düsseldorf',
    slug: 'messe-dusseldorf',
    brandColor: '#B91C1C',
    accentColor: '#EF4444',
    website: 'https://www.md-india.com',
    badge: 'Medical & Industrial',
    scope: 'Medical Fair India, metallurgy conventions, and global industrial forums.',
    category: 'Healthcare & Pharma',
    eventsCount: 6,
    displayOrder: 6,
    status: 'approved',
    isActive: true
  },
  {
    name: 'CEMS-Global USA',
    shortName: 'CEMS-Global',
    slug: 'cems-global',
    brandColor: '#047857',
    accentColor: '#10B981',
    website: 'https://cems.global',
    badge: 'Multinational',
    scope: 'Multinational exhibition organizer spanning South & Southeast Asia and South America.',
    category: 'Trade & Industry',
    eventsCount: 6,
    displayOrder: 7,
    status: 'approved',
    isActive: true
  },
  {
    name: 'Guangdong Grandeur Intl Exhibition Group',
    shortName: 'Grandeur Group',
    slug: 'guangdong-grandeur',
    brandColor: '#B45309',
    accentColor: '#F59E0B',
    website: 'https://www.gzhw.com',
    badge: 'Asia Pacific',
    scope: 'Major organizer of landscape, gardening, entertainment, and commercial trade fairs.',
    category: 'Trade & Industry',
    eventsCount: 6,
    displayOrder: 8,
    status: 'approved',
    isActive: true
  },
  {
    name: 'MEX Exhibitions Pvt. Ltd.',
    shortName: 'MEX Exhibitions',
    slug: 'mex-exhibitions',
    brandColor: '#4338CA',
    accentColor: '#6366F1',
    website: 'https://cewexpo.com',
    badge: 'Consumer & Sign',
    scope: 'Consumer Electronics World Expo, Gifts World Expo, and Sign India showcases.',
    category: 'Technology & AI',
    eventsCount: 5,
    displayOrder: 9,
    status: 'approved',
    isActive: true
  },
  {
    name: 'Confederation of Indian Industry (CII)',
    shortName: 'CII',
    slug: 'cii',
    brandColor: '#15803D',
    accentColor: '#22C55E',
    website: 'https://www.cii.in',
    badge: 'Apex Industry Body',
    scope: 'India’s premier business association driving industrial growth, mass transit, and engineering.',
    category: 'Trade & Industry',
    eventsCount: 5,
    displayOrder: 10,
    status: 'approved',
    isActive: true
  }
];

// Helper to seed baseline organizers if collection is empty
const ensureSeedData = async () => {
  const count = await FeaturedOrganizer.countDocuments();
  if (count === 0) {
    try {
      await FeaturedOrganizer.insertMany(BASELINE_FEATURED_ORGANIZERS);
      console.log(`[FeaturedOrganizer] Seeded ${BASELINE_FEATURED_ORGANIZERS.length} default featured organizers.`);
    } catch (err) {
      console.warn('[FeaturedOrganizer] Seed note:', err.message);
    }
  }
};

// ==========================================
// 1. PUBLIC ROUTES
// ==========================================

// @desc    Get all active featured organizers for public showcase
// @route   GET /api/featured-organizers
router.get('/', async (req, res, next) => {
  try {
    await ensureSeedData();

    const featured = await FeaturedOrganizer.find({
      status: 'approved',
      isActive: true
    })
      .sort({ displayOrder: 1, eventsCount: -1, createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: featured,
      count: featured.length
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 2. ORGANIZER APPLICATION ROUTES (ENTERPRISE ONLY)
// ==========================================

// @desc    Get current logged-in organizer's featured application
// @route   GET /api/featured-organizers/my-application
router.get('/my-application', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('name email role plan isPlanActive organization');
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const isEnterprise = user.plan === 'enterprise' || user.plan === 'growth';

    // Find any existing application for this user
    const application = await FeaturedOrganizer.findOne({ applicantUser: user._id }).lean();

    res.status(200).json({
      success: true,
      isEnterprise,
      userPlan: user.plan,
      application: application || null
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Apply for Featured Organizer (Enterprise Plan required)
// @route   POST /api/featured-organizers/apply
router.post('/apply', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    // Role check: must be organizer
    if (user.role !== 'organizer') {
      return res.status(403).json({
        success: false,
        error: 'Only event organizers can apply for Featured Organizer status.'
      });
    }

    // Strict Plan Check: Must have Enterprise or Growth plan (NOT Free or Starter)
    const isEnterprise = user.plan === 'enterprise' || user.plan === 'growth';
    if (!isEnterprise) {
      return res.status(403).json({
        success: false,
        error: 'Featured Organizer placement is exclusively available on the Enterprise Plan. Free and Starter plans are not eligible. Please upgrade your plan to apply.',
        currentPlan: user.plan || 'free',
        requiredPlan: 'enterprise'
      });
    }

    const {
      name,
      shortName,
      website,
      logoUrl,
      brandColor,
      accentColor,
      badge,
      scope,
      category,
      applicantPhone,
      applicationNotes
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Organizer / Company name is required.' });
    }

    // Check if an application already exists for this applicant
    let existing = await FeaturedOrganizer.findOne({ applicantUser: user._id });

    if (existing) {
      // If already approved, notify that they are already a featured organizer
      if (existing.status === 'approved') {
        // Allow updating brand assets/details
        existing.name = name.trim();
        existing.shortName = (shortName || name).trim();
        if (website) existing.website = website.trim();
        if (logoUrl) existing.logoUrl = logoUrl.trim();
        if (brandColor) existing.brandColor = brandColor.trim();
        if (accentColor) existing.accentColor = accentColor.trim();
        if (badge) existing.badge = badge.trim();
        if (scope) existing.scope = scope.trim();
        if (category) existing.category = category.trim();
        if (applicantPhone) existing.applicantPhone = applicantPhone.trim();
        if (applicationNotes) existing.applicationNotes = applicationNotes.trim();
        await existing.save();

        return res.status(200).json({
          success: true,
          message: 'Featured Organizer profile updated successfully! Your showcase remains live.',
          data: existing
        });
      }

      // If pending or rejected, update and reset to pending for review
      existing.name = name.trim();
      existing.shortName = (shortName || name).trim();
      existing.website = (website || '').trim();
      existing.logoUrl = (logoUrl || existing.logoUrl || '').trim();
      existing.brandColor = brandColor || existing.brandColor || '#0284C7';
      existing.accentColor = accentColor || existing.accentColor || '#38BDF8';
      existing.badge = (badge || 'Enterprise Partner').trim();
      existing.scope = (scope || '').trim();
      existing.category = category || existing.category || 'Trade & Industry';
      existing.applicantEmail = user.email;
      existing.applicantPhone = (applicantPhone || existing.applicantPhone || '').trim();
      existing.applicationNotes = (applicationNotes || '').trim();
      existing.status = 'pending';
      existing.isActive = false; // Remains inactive until approved
      existing.adminReviewNotes = ''; // Clear previous rejection notes on re-application
      await existing.save();

      return res.status(200).json({
        success: true,
        message: 'Your application has been updated and submitted for Admin review.',
        data: existing
      });
    }

    // Create a new application document
    const newFeatured = new FeaturedOrganizer({
      name: name.trim(),
      shortName: (shortName || name).trim(),
      website: (website || '').trim(),
      logoUrl: (logoUrl || '').trim(),
      brandColor: brandColor || '#0284C7',
      accentColor: accentColor || '#38BDF8',
      badge: (badge || 'Enterprise Partner').trim(),
      scope: (scope || '').trim(),
      category: category || 'Trade & Industry',
      eventsCount: 0,
      displayOrder: 99,
      status: 'pending',
      isActive: false,
      applicantUser: user._id,
      applicantOrganization: user.organization || null,
      applicantEmail: user.email,
      applicantPhone: (applicantPhone || '').trim(),
      applicationNotes: (applicationNotes || '').trim()
    });

    await newFeatured.save();

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully! VisitExpo Super Admin team will review and approve your featured placement.',
      data: newFeatured
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 3. ADMIN MANAGEMENT & MODERATION ROUTES
// ==========================================

// @desc    Admin: Get all featured organizers and applications with summary stats
// @route   GET /api/featured-organizers/admin/all
router.get('/admin/all', protect, authorize('super_admin', 'sub_admin', 'admin'), async (req, res, next) => {
  try {
    await ensureSeedData();

    const { status, search } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (search && search.trim()) {
      const q = search.trim();
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { shortName: { $regex: q, $options: 'i' } },
        { applicantEmail: { $regex: q, $options: 'i' } },
        { badge: { $regex: q, $options: 'i' } }
      ];
    }

    const items = await FeaturedOrganizer.find(filter)
      .populate('applicantUser', 'name email role plan company designation')
      .populate('reviewedBy', 'name email')
      .sort({ displayOrder: 1, createdAt: -1 })
      .lean();

    // Summary counts
    const [totalFeatured, activeCount, pendingCount, rejectedCount] = await Promise.all([
      FeaturedOrganizer.countDocuments({ status: 'approved' }),
      FeaturedOrganizer.countDocuments({ status: 'approved', isActive: true }),
      FeaturedOrganizer.countDocuments({ status: 'pending' }),
      FeaturedOrganizer.countDocuments({ status: 'rejected' })
    ]);

    res.status(200).json({
      success: true,
      data: items,
      stats: {
        totalFeatured,
        activeCount,
        pendingCount,
        rejectedCount,
        totalRecords: items.length
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Directly create a new featured organizer (without application)
// @route   POST /api/featured-organizers/admin
router.post('/admin', protect, authorize('super_admin', 'sub_admin', 'admin'), async (req, res, next) => {
  try {
    const {
      name,
      shortName,
      website,
      logoUrl,
      brandColor,
      accentColor,
      badge,
      scope,
      category,
      eventsCount,
      displayOrder,
      isActive
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Organizer name is required.' });
    }

    const item = new FeaturedOrganizer({
      name: name.trim(),
      shortName: (shortName || name).trim(),
      website: (website || '').trim(),
      logoUrl: (logoUrl || '').trim(),
      brandColor: brandColor || '#0284C7',
      accentColor: accentColor || '#38BDF8',
      badge: (badge || 'Featured Organizer').trim(),
      scope: (scope || '').trim(),
      category: category || 'Trade & Industry',
      eventsCount: Number(eventsCount) || 0,
      displayOrder: Number(displayOrder) || 1,
      status: 'approved',
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      reviewedBy: req.user.id,
      reviewedAt: new Date()
    });

    await item.save();

    res.status(201).json({
      success: true,
      message: 'Featured Organizer created successfully!',
      data: item
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Update existing featured organizer
// @route   PUT /api/featured-organizers/admin/:id
router.put('/admin/:id', protect, authorize('super_admin', 'sub_admin', 'admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const item = await FeaturedOrganizer.findById(id);

    if (!item) {
      return res.status(404).json({ success: false, error: 'Featured organizer not found.' });
    }

    const {
      name,
      shortName,
      website,
      logoUrl,
      brandColor,
      accentColor,
      badge,
      scope,
      category,
      eventsCount,
      displayOrder,
      isActive,
      status,
      adminReviewNotes
    } = req.body;

    if (name) item.name = name.trim();
    if (shortName !== undefined) item.shortName = shortName.trim();
    if (website !== undefined) item.website = website.trim();
    if (logoUrl !== undefined) item.logoUrl = logoUrl.trim();
    if (brandColor) item.brandColor = brandColor.trim();
    if (accentColor) item.accentColor = accentColor.trim();
    if (badge) item.badge = badge.trim();
    if (scope !== undefined) item.scope = scope.trim();
    if (category) item.category = category.trim();
    if (eventsCount !== undefined) item.eventsCount = Number(eventsCount);
    if (displayOrder !== undefined) item.displayOrder = Number(displayOrder);
    if (isActive !== undefined) item.isActive = Boolean(isActive);
    if (status) item.status = status;
    if (adminReviewNotes !== undefined) item.adminReviewNotes = adminReviewNotes.trim();

    await item.save();

    res.status(200).json({
      success: true,
      message: 'Featured Organizer updated successfully!',
      data: item
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Approve or Reject an Enterprise Organizer's application
// @route   PATCH /api/featured-organizers/admin/:id/status
router.patch('/admin/:id/status', protect, authorize('super_admin', 'sub_admin', 'admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminReviewNotes, badge, displayOrder, eventsCount, isActive } = req.body;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status. Must be approved, rejected, or pending.' });
    }

    const item = await FeaturedOrganizer.findById(id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Featured organizer application not found.' });
    }

    item.status = status;
    item.reviewedBy = req.user.id;
    item.reviewedAt = new Date();

    if (adminReviewNotes !== undefined) {
      item.adminReviewNotes = adminReviewNotes.trim();
    }
    if (badge) item.badge = badge.trim();
    if (displayOrder !== undefined) item.displayOrder = Number(displayOrder);
    if (eventsCount !== undefined) item.eventsCount = Number(eventsCount);

    if (status === 'approved') {
      item.isActive = isActive !== undefined ? Boolean(isActive) : true;
    } else if (status === 'rejected') {
      item.isActive = false;
    }

    await item.save();

    res.status(200).json({
      success: true,
      message: status === 'approved'
        ? 'Application approved! Organizer is now featured.'
        : 'Application status updated.',
      data: item
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Toggle active status on homepage
// @route   PATCH /api/featured-organizers/admin/:id/toggle-active
router.patch('/admin/:id/toggle-active', protect, authorize('super_admin', 'sub_admin', 'admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const item = await FeaturedOrganizer.findById(id);

    if (!item) {
      return res.status(404).json({ success: false, error: 'Featured organizer not found.' });
    }

    item.isActive = !item.isActive;
    await item.save();

    res.status(200).json({
      success: true,
      message: `Organizer is now ${item.isActive ? 'Active on Homepage' : 'Hidden from Homepage'}.`,
      isActive: item.isActive,
      data: item
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Delete a featured organizer
// @route   DELETE /api/featured-organizers/admin/:id
router.delete('/admin/:id', protect, authorize('super_admin', 'sub_admin', 'admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const item = await FeaturedOrganizer.findByIdAndDelete(id);

    if (!item) {
      return res.status(404).json({ success: false, error: 'Featured organizer not found.' });
    }

    res.status(200).json({
      success: true,
      message: 'Featured organizer deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
