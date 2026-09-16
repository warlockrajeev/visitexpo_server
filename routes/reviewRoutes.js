/**
 * @file reviewRoutes.js
 * @description REST API routes for Reviews: public submission, public retrieval of approved/featured reviews,
 * and admin-protected moderation endpoints.
 */

import express from 'express';
import Review from '../models/Review.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/reviews
 * Submit a new review (public — no auth required).
 * Review is created with status: 'pending' and must be approved by admin.
 */
router.post('/', async (req, res) => {
  try {
    const {
      name, email, role, title, company, avatar,
      eventTitle, eventSlug, venue,
      rating, headline, review, tags
    } = req.body;

    if (!name || !eventTitle || !review) {
      return res.status(400).json({
        success: false,
        error: 'Name, event title, and review text are required.'
      });
    }

    const newReview = await Review.create({
      name: name.trim(),
      email: (email || '').trim(),
      role: (role || 'Verified Trade Buyer').trim(),
      title: (title || 'Trade Professional').trim(),
      company: (company || '').trim(),
      avatar: avatar || '',
      eventTitle: eventTitle.trim(),
      eventSlug: (eventSlug || eventTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')).trim(),
      venue: (venue || '').trim(),
      rating: Math.min(5, Math.max(1, Number(rating) || 5)),
      headline: (headline || '').trim(),
      review: review.trim(),
      tags: Array.isArray(tags) ? tags.map(t => t.trim()).filter(Boolean) : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : []),
      status: 'pending',
      isFeaturedOnLanding: false,
      submittedAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully! It will appear after admin approval.',
      data: newReview
    });
  } catch (err) {
    console.error('Error submitting review:', err);
    res.status(500).json({ success: false, error: 'Failed to submit review.' });
  }
});

/**
 * GET /api/reviews
 * Fetch all approved reviews (status: 'approved' or 'featured').
 */
router.get('/', async (req, res) => {
  try {
    const { eventSlug, limit } = req.query;
    const filter = { status: { $in: ['approved', 'featured'] } };
    if (eventSlug) filter.eventSlug = eventSlug.toLowerCase().trim();

    const reviews = await Review.find(filter)
      .sort({ isFeaturedOnLanding: -1, createdAt: -1 })
      .limit(Number(limit) || 50)
      .lean();

    res.status(200).json({ success: true, count: reviews.length, data: reviews });
  } catch (err) {
    console.error('Error fetching reviews:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch reviews.' });
  }
});

/**
 * GET /api/reviews/featured
 * Fetch only reviews marked as featured on landing page.
 */
router.get('/featured', async (req, res) => {
  try {
    const reviews = await Review.find({ isFeaturedOnLanding: true, status: { $in: ['approved', 'featured'] } })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.status(200).json({ success: true, count: reviews.length, data: reviews });
  } catch (err) {
    console.error('Error fetching featured reviews:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch featured reviews.' });
  }
});

/**
 * GET /api/reviews/event/:slug
 * Fetch approved reviews for a specific expo by slug.
 */
router.get('/event/:slug', async (req, res) => {
  try {
    const slug = (req.params.slug || '').toLowerCase().trim();
    const reviews = await Review.find({
      eventSlug: slug,
      status: { $in: ['approved', 'featured'] }
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    res.status(200).json({ success: true, count: reviews.length, data: reviews });
  } catch (err) {
    console.error('Error fetching event reviews:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch event reviews.' });
  }
});

/**
 * POST /api/reviews/:id/helpful
 * Increment helpful count (public, no auth).
 */
router.post('/:id/helpful', async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { $inc: { helpfulCount: 1 } },
      { new: true }
    );
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }
    res.status(200).json({ success: true, data: { helpfulCount: review.helpfulCount } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update helpful count.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-PROTECTED ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/reviews/admin/all
 * List all reviews across all statuses (admin only).
 */
router.get('/admin/all', protect, authorize('super_admin'), async (req, res) => {
  try {
    const { status, search, rating, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }
    if (rating) {
      filter.rating = Number(rating);
    }
    if (search) {
      const q = search.trim();
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { eventTitle: { $regex: q, $options: 'i' } },
        { headline: { $regex: q, $options: 'i' } },
        { review: { $regex: q, $options: 'i' } },
        { company: { $regex: q, $options: 'i' } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [reviews, total, stats] = await Promise.all([
      Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Review.countDocuments(filter),
      Review.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const statusCounts = { pending: 0, approved: 0, rejected: 0, featured: 0 };
    stats.forEach(s => { statusCounts[s._id] = s.count; });

    const featuredOnLandingCount = await Review.countDocuments({ isFeaturedOnLanding: true });

    res.status(200).json({
      success: true,
      count: reviews.length,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      stats: { ...statusCounts, featuredOnLanding: featuredOnLandingCount, total: Object.values(statusCounts).reduce((a, b) => a + b, 0) },
      data: reviews
    });
  } catch (err) {
    console.error('Error fetching admin reviews:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch reviews.' });
  }
});

/**
 * PUT /api/reviews/admin/:id/status
 * Update review status (approve / reject / feature).
 */
router.put('/admin/:id/status', protect, authorize('super_admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected', 'featured'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status value.' });
    }

    const update = {
      status,
      reviewedByAdmin: req.user?.email || 'admin',
      reviewedAt: new Date()
    };

    // If status is 'featured', also mark as featured on landing
    if (status === 'featured') {
      update.isFeaturedOnLanding = true;
    }

    const review = await Review.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }

    res.status(200).json({ success: true, data: review });
  } catch (err) {
    console.error('Error updating review status:', err);
    res.status(500).json({ success: false, error: 'Failed to update review status.' });
  }
});

/**
 * PUT /api/reviews/admin/:id/feature
 * Toggle isFeaturedOnLanding flag.
 */
router.put('/admin/:id/feature', protect, authorize('super_admin'), async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }

    review.isFeaturedOnLanding = !review.isFeaturedOnLanding;
    // Ensure featured reviews are at least approved
    if (review.isFeaturedOnLanding && review.status === 'pending') {
      review.status = 'approved';
    }
    if (review.isFeaturedOnLanding) {
      review.status = 'featured';
    }
    review.reviewedByAdmin = req.user?.email || 'admin';
    review.reviewedAt = new Date();
    await review.save();

    res.status(200).json({ success: true, data: review });
  } catch (err) {
    console.error('Error toggling feature:', err);
    res.status(500).json({ success: false, error: 'Failed to toggle featured status.' });
  }
});

/**
 * DELETE /api/reviews/admin/:id
 * Permanently delete a review.
 */
router.delete('/admin/:id', protect, authorize('super_admin'), async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }
    res.status(200).json({ success: true, message: 'Review deleted permanently.' });
  } catch (err) {
    console.error('Error deleting review:', err);
    res.status(500).json({ success: false, error: 'Failed to delete review.' });
  }
});

export default router;
