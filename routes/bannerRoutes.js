/**
 * @file bannerRoutes.js
 * @description API routes for Landing Page Banner Spotlight promotion requests, moderation, and active public carousel feed.
 * Feature exclusive to Growth Plan Organizers.
 */

import express from 'express';
import BannerRequest from '../models/BannerRequest.js';
import Event from '../models/Event.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import { protect, authorize } from '../middlewares/auth.js';
import { hasGrowthPromotionAccess } from '../services/promotionAudienceService.js';

const router = express.Router();

// ============================================================================
// 1. PUBLIC ROUTES
// ============================================================================

// @desc    Get active approved banners for Landing Page Hero Slider
// @route   GET /api/banners/active
router.get('/active', async (req, res, next) => {
  try {
    const now = new Date();

    // Query approved, active banners within valid date ranges (if dates set)
    const query = {
      status: 'approved',
      isActive: true,
      $and: [
        {
          $or: [
            { startDate: null },
            { startDate: { $lte: now } }
          ]
        },
        {
          $or: [
            { endDate: null },
            { endDate: { $gte: now } }
          ]
        }
      ]
    };

    const banners = await BannerRequest.find(query)
      .populate('event', 'title slug city dates startDate endDate venue bannerImage featuredImage logo category description entryType price organizer')
      .populate('organizer', 'name company organization email plan hasGrowthPlan')
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    // Filter out banners whose underlying event is deleted
    const validBanners = banners.filter(b => b.event != null);

    res.status(200).json({
      success: true,
      count: validBanners.length,
      banners: validBanners
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Track click on banner spotlight
// @route   POST /api/banners/:id/click
router.post('/:id/click', async (req, res, next) => {
  try {
    await BannerRequest.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// 2. ORGANIZER PROTECTED ROUTES (Requires Login + Growth Plan)
// ============================================================================

// @desc    Get organizer's banner requests and entitlement status
// @route   GET /api/banners/my-requests
router.get('/my-requests', protect, async (req, res, next) => {
  try {
    const hasGrowth = await hasGrowthPromotionAccess(req.user);

    const requests = await BannerRequest.find({ organizer: req.user._id })
      .populate('event', 'title slug city dates bannerImage featuredImage category status')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      hasGrowthPlan: hasGrowth,
      plan: req.user.plan || 'free',
      requests
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Submit new Landing Page Banner Spotlight request (Growth Plan Exclusive)
// @route   POST /api/banners/request
router.post('/request', protect, async (req, res, next) => {
  try {
    // 1. Verify Growth Plan access
    const hasGrowth = await hasGrowthPromotionAccess(req.user);
    if (!hasGrowth) {
      return res.status(403).json({
        success: false,
        error: 'Growth Plan Required',
        message: 'Landing Page Banner Spotlight is an exclusive feature for Growth Plan Organizers. Please upgrade your plan to feature your exhibition on the homepage.'
      });
    }

    const {
      eventId,
      headline,
      subheadline,
      bannerImage,
      ctaText,
      ctaLink,
      badgeText,
      requestedDays = 14
    } = req.body;

    if (!eventId) {
      return res.status(400).json({
        success: false,
        error: 'Event is required to request a banner spotlight'
      });
    }

    // 2. Verify event exists and belongs to organizer (or user is admin)
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const isOwner =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      String(event.organizer) === String(req.user._id);

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized',
        message: 'You can only request banner spotlights for exhibitions you organize.'
      });
    }

    // Check if there is already an active or pending request for this event
    const existing = await BannerRequest.findOne({
      event: eventId,
      organizer: req.user._id,
      status: { $in: ['pending', 'approved'] }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Duplicate Request',
        message: `You already have a ${existing.status} banner spotlight for this exhibition.`
      });
    }

    // Default image to event's banner or featured image if none provided
    const resolvedBanner =
      bannerImage ||
      event.bannerImage ||
      event.featuredImage ||
      'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1600&auto=format&fit=crop&q=80';

    const resolvedHeadline = (headline && headline.trim()) || event.title;
    const resolvedSubheadline =
      (subheadline && subheadline.trim()) ||
      (event.description ? event.description.substring(0, 220) : 'Join industry leaders and explore world-class exhibits.');
    const resolvedCtaLink = (ctaLink && ctaLink.trim()) || `/events?highlight=${event.slug || event._id}`;

    const bannerRequest = await BannerRequest.create({
      event: eventId,
      organizer: req.user._id,
      headline: resolvedHeadline,
      subheadline: resolvedSubheadline,
      bannerImage: resolvedBanner,
      ctaText: (ctaText && ctaText.trim()) || 'Explore Exhibition',
      ctaLink: resolvedCtaLink,
      badgeText: (badgeText && badgeText.trim()) || 'Growth Spotlight',
      requestedDays: Math.min(Math.max(Number(requestedDays) || 14, 3), 60),
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      message: 'Banner spotlight request submitted successfully! Our curation team will review and activate your banner.',
      data: bannerRequest
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Withdraw/cancel an existing banner request
// @route   DELETE /api/banners/request/:id
router.delete('/request/:id', protect, async (req, res, next) => {
  try {
    const banner = await BannerRequest.findById(req.params.id);
    if (!banner) {
      return res.status(404).json({ success: false, error: 'Banner request not found' });
    }

    const isOwner =
      String(banner.organizer) === String(req.user._id) ||
      req.user.role === 'super_admin' ||
      req.user.role === 'admin';

    if (!isOwner) {
      return res.status(403).json({ success: false, error: 'Unauthorized to cancel this request' });
    }

    await BannerRequest.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Banner spotlight request cancelled successfully.'
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// 3. ADMIN MODERATION ROUTES (Super Admin & Admin Only)
// ============================================================================

// @desc    Get all banner spotlight requests with stats and filters
// @route   GET /api/banners/admin/all
router.get('/admin/all', protect, authorize('super_admin', 'admin', 'event_manager'), async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [banners, total, pendingCount, approvedCount, rejectedCount] = await Promise.all([
      BannerRequest.find(filter)
        .populate('event', 'title slug city dates bannerImage featuredImage category venue')
        .populate('organizer', 'name email company organization plan hasGrowthPlan phone')
        .populate('reviewedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      BannerRequest.countDocuments(filter),
      BannerRequest.countDocuments({ status: 'pending' }),
      BannerRequest.countDocuments({ status: 'approved', isActive: true }),
      BannerRequest.countDocuments({ status: 'rejected' })
    ]);

    res.status(200).json({
      success: true,
      stats: {
        total,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount
      },
      banners,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)) || 1
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Approve or Reject a Banner Spotlight request
// @route   PATCH /api/banners/admin/:id/status
router.patch('/admin/:id/status', protect, authorize('super_admin', 'admin', 'event_manager'), async (req, res, next) => {
  try {
    const { status, priority, adminNotes, days, startDate, endDate, badgeText, isActive } = req.body;

    const banner = await BannerRequest.findById(req.params.id)
      .populate('event', 'title')
      .populate('organizer', 'name email');

    if (!banner) {
      return res.status(404).json({ success: false, error: 'Banner request not found' });
    }

    if (status) {
      banner.status = status;
      banner.reviewedBy = req.user._id;
      banner.reviewedAt = new Date();
    }

    if (adminNotes !== undefined) {
      banner.adminNotes = adminNotes;
    }

    if (priority !== undefined) {
      banner.priority = Number(priority) || 1;
    }

    if (badgeText !== undefined) {
      banner.badgeText = badgeText;
    }

    if (isActive !== undefined) {
      banner.isActive = Boolean(isActive);
    }

    // Set duration on approval
    if (status === 'approved') {
      const now = new Date();
      banner.startDate = startDate ? new Date(startDate) : now;
      const durationDays = Number(days) || banner.requestedDays || 14;
      banner.endDate = endDate ? new Date(endDate) : new Date(banner.startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
      banner.isActive = true;
    }

    await banner.save();

    res.status(200).json({
      success: true,
      message: `Banner request ${status === 'approved' ? 'approved and activated on landing page' : status} successfully!`,
      data: banner
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin directly creates a featured banner spotlight
// @route   POST /api/banners/admin/direct
router.post('/admin/direct', protect, authorize('super_admin', 'admin'), async (req, res, next) => {
  try {
    const {
      eventId,
      headline,
      subheadline,
      bannerImage,
      ctaText,
      ctaLink,
      badgeText,
      priority = 5,
      days = 30
    } = req.body;

    const event = await Event.findById(eventId).populate('organizer');
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const now = new Date();
    const banner = await BannerRequest.create({
      event: eventId,
      organizer: event.organizer?._id || req.user._id,
      headline: headline || event.title,
      subheadline: subheadline || event.description?.substring(0, 200) || 'Official Exhibition Spotlight',
      bannerImage: bannerImage || event.bannerImage || event.featuredImage || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1600&auto=format&fit=crop&q=80',
      ctaText: ctaText || 'Explore Exhibition',
      ctaLink: ctaLink || `/events?highlight=${event.slug || event._id}`,
      badgeText: badgeText || 'Featured Spotlight',
      priority: Number(priority) || 5,
      startDate: now,
      endDate: new Date(now.getTime() + Number(days) * 24 * 60 * 60 * 1000),
      status: 'approved',
      isActive: true,
      reviewedBy: req.user._id,
      reviewedAt: now
    });

    res.status(201).json({
      success: true,
      message: 'Direct banner spotlight created and activated live!',
      data: banner
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin delete a banner
// @route   DELETE /api/banners/admin/:id
router.delete('/admin/:id', protect, authorize('super_admin', 'admin'), async (req, res, next) => {
  try {
    await BannerRequest.findByIdAndDelete(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Banner record deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
