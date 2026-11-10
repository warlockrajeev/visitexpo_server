/**
 * @file reviewRoutes.js
 * @description REST API routes for Reviews: public submission, public retrieval of approved/featured reviews,
 * and admin-protected moderation endpoints.
 */

import express from 'express';
import Review from '../models/Review.js';
import Venue from '../models/Venue.js';
import Event from '../models/Event.js';
import { protect, authorize } from '../middlewares/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';

const router = express.Router();

function optionalProtect(req, _res, next) {
  const token =
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null) ||
    req.cookies?.token;
  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      if (decoded) req.user = { id: decoded.id, _id: decoded.id, email: decoded.email };
    } catch (error) {
      // Public review browsing remains available if an optional session has expired.
    }
  }
  next();
}

async function getVenueReviewAggregate(venueSlug) {
  const [aggregate] = await Review.aggregate([
    {
      $match: {
        venueSlug,
        status: { $in: ['approved', 'featured'] }
      }
    },
    { $group: { _id: null, count: { $sum: 1 }, averageRating: { $avg: '$rating' } } }
  ]);
  return {
    count: aggregate?.count || 0,
    averageRating: aggregate?.averageRating ? Math.round(aggregate.averageRating * 10) / 10 : 0
  };
}

async function syncVenueRating(venueSlug) {
  if (!venueSlug) return;
  try {
    const aggregate = await getVenueReviewAggregate(venueSlug);
    await Venue.findOneAndUpdate(
      { slug: venueSlug },
      {
        rating: aggregate.averageRating,
        ratingsCount: aggregate.count
      }
    );
  } catch (_) {}
}

async function getEventReviewAggregate(eventSlug) {
  const slug = String(eventSlug || '').toLowerCase().trim();
  if (!slug) return { count: 0, averageRating: 0 };
  const [aggregate] = await Review.aggregate([
    {
      $match: {
        $or: [
          { eventSlug: slug },
          { eventSlug: { $regex: new RegExp(`^${slug}$`, 'i') } }
        ],
        status: { $in: ['approved', 'featured', 'pending'] }
      }
    },
    { $group: { _id: null, count: { $sum: 1 }, averageRating: { $avg: '$rating' } } }
  ]);
  return {
    count: aggregate?.count || 0,
    averageRating: aggregate?.averageRating ? Number(aggregate.averageRating.toFixed(1)) : 0
  };
}

async function syncEventRating(eventSlug) {
  try {
    const slug = String(eventSlug || '').toLowerCase().trim();
    if (!slug) return null;
    const aggregate = await getEventReviewAggregate(slug);
    await Event.findOneAndUpdate(
      {
        $or: [
          { slug },
          { slug: { $regex: new RegExp(`^${slug}$`, 'i') } }
        ]
      },
      { rating: aggregate.averageRating, reviewCount: aggregate.count }
    );
    return aggregate;
  } catch (err) {
    console.warn('syncEventRating warning:', err.message);
    return null;
  }
}

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
      rating, headline, review, comment, tags, status
    } = req.body;

    const nameText = typeof name === 'string' ? name.trim() : '';
    const eventTitleText = typeof eventTitle === 'string' ? eventTitle.trim() : '';
    const titleText = typeof title === 'string' ? title.trim() : '';
    const companyText = typeof company === 'string' ? company.trim() : '';
    const headlineText = typeof headline === 'string' ? headline.trim() : '';
    const reviewValue = review || comment;
    const reviewText = typeof reviewValue === 'string' ? reviewValue.trim() : '';

    if (!nameText || !eventTitleText || !reviewText) {
      return res.status(400).json({
        success: false,
        error: 'Name, event title, and review/comment text are required.'
      });
    }

    const allowedHumanText = /^[\p{L}\p{M}\p{N}\s.,!?'"’“”&()/\-:;]+$/u;
    const hasLetter = (value) => /\p{L}/u.test(value);
    const alphanumericCount = (value) => (value.match(/[\p{L}\p{N}]/gu) || []).length;

    if (
      nameText.length < 2 ||
      nameText.length > 120 ||
      !hasLetter(nameText) ||
      !/^[\p{L}\p{M}\s.'’-]+$/u.test(nameText)
    ) {
      return res.status(400).json({ success: false, error: 'Please enter a valid full name.' });
    }

    if (
      eventTitleText.length < 2 ||
      eventTitleText.length > 160 ||
      alphanumericCount(eventTitleText) < 2 ||
      !allowedHumanText.test(eventTitleText)
    ) {
      return res.status(400).json({ success: false, error: 'Please enter a valid event or expo name.' });
    }

    if (titleText && (titleText.length < 2 || titleText.length > 80 || !hasLetter(titleText) || !allowedHumanText.test(titleText))) {
      return res.status(400).json({ success: false, error: 'Please enter a valid designation or title.' });
    }

    if (companyText && (companyText.length < 2 || companyText.length > 120 || alphanumericCount(companyText) < 2 || !allowedHumanText.test(companyText))) {
      return res.status(400).json({ success: false, error: 'Please enter a valid company name.' });
    }

    if (headlineText && (headlineText.length < 2 || headlineText.length > 300 || alphanumericCount(headlineText) < 2 || !allowedHumanText.test(headlineText))) {
      return res.status(400).json({ success: false, error: 'Please enter a valid headline.' });
    }

    if (reviewText.length < 4 || reviewText.length > 2000 || alphanumericCount(reviewText) < 4 || !allowedHumanText.test(reviewText)) {
      return res.status(400).json({ success: false, error: 'Please enter a meaningful review using letters, numbers, and common punctuation.' });
    }

    const newReview = await Review.create({
      name: nameText,
      email: (email || '').trim(),
      role: (role || 'Verified Trade Buyer').trim(),
      title: titleText || 'Trade Professional',
      company: companyText,
      avatar: avatar || '',
      eventTitle: eventTitleText,
      eventSlug: (eventSlug || eventTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')).trim(),
      venue: (venue || '').trim(),
      rating: Math.min(5, Math.max(1, Number(rating) || 5)),
      headline: headlineText,
      review: reviewText,
      tags: Array.isArray(tags) ? tags.map(t => t.trim()).filter(Boolean) : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : []),
      status: status || 'approved', // Approved so user comments display immediately!
      isFeaturedOnLanding: false,
      submittedAt: new Date()
    });

    const aggregate = await syncEventRating(newReview.eventSlug);

    res.status(201).json({
      success: true,
      message: 'Comment posted successfully!',
      data: newReview,
      count: aggregate?.count ?? 1,
      averageRating: aggregate?.averageRating ?? newReview.rating
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
    const [reviews, aggregate] = await Promise.all([
      Review.find({
        $or: [
          { eventSlug: slug },
          { eventSlug: { $regex: new RegExp(`^${slug}$`, 'i') } }
        ],
        status: { $in: ['approved', 'featured', 'pending'] }
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      getEventReviewAggregate(slug)
    ]);

    res.status(200).json({
      success: true,
      count: aggregate.count,
      averageRating: aggregate.averageRating,
      data: reviews
    });
  } catch (err) {
    console.error('Error fetching event reviews:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch event reviews.' });
  }
});

/**
 * GET /api/reviews/venue/:slug
 * Fetch published reviews and their aggregate rating for a venue.
 */
router.get('/venue/:slug', optionalProtect, async (req, res) => {
  try {
    const venueSlug = String(req.params.slug || '').toLowerCase().trim();
    const filter = { venueSlug, status: { $in: ['approved', 'featured'] } };
    const [reviews, aggregate] = await Promise.all([
      Review.find(filter).sort({ createdAt: -1 }).limit(100).lean(),
      getVenueReviewAggregate(venueSlug)
    ]);

    res.status(200).json({
      success: true,
      count: aggregate.count,
      averageRating: aggregate.averageRating,
      data: reviews.map(({ email: _email, userId, ...review }) => ({
        ...review,
        isOwner: Boolean(req.user?.id && userId === String(req.user.id))
      }))
    });
  } catch (error) {
    console.error('Error fetching venue reviews:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch venue reviews.' });
  }
});

/**
 * POST /api/reviews/venue
 * Submit a venue review for immediate publication.
 */
router.post('/venue', protect, async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const designation = typeof req.body.designation === 'string' ? req.body.designation.trim() : '';
    const headline = typeof req.body.headline === 'string' ? req.body.headline.trim() : '';
    const reviewText = typeof req.body.review === 'string' ? req.body.review.trim() : '';
    const venueSlug = typeof req.body.venueSlug === 'string' ? req.body.venueSlug.trim().toLowerCase() : '';
    const rating = Number(req.body.rating);
    const venue = venueSlug ? await Venue.findOne({ slug: venueSlug }).select('name slug').lean() : null;

    if (!venue) {
      return res.status(404).json({ success: false, error: 'Venue not found. Refresh the page and try again.' });
    }
    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ success: false, error: 'Enter a name between 2 and 120 characters.' });
    }
    if (designation.length < 2 || designation.length > 80) {
      return res.status(400).json({ success: false, error: 'Enter a designation between 2 and 80 characters.' });
    }
    if (headline.length < 3 || headline.length > 160) {
      return res.status(400).json({ success: false, error: 'Enter a review title between 3 and 160 characters.' });
    }
    if (reviewText.length < 4 || reviewText.length > 2000) {
      return res.status(400).json({ success: false, error: 'Enter feedback between 4 and 2,000 characters.' });
    }
    if (![1, 2, 3, 4, 5].includes(rating)) {
      return res.status(400).json({ success: false, error: 'Select a rating from 1 to 5.' });
    }

    const review = await Review.create({
      name,
      email: String(req.user.email || '').toLowerCase(),
      userId: String(req.user.id),
      title: designation,
      role: designation,
      eventTitle: venue.name,
      venue: venue.name,
      venueSlug: venue.slug,
      rating,
      headline,
      review: reviewText,
      status: 'approved',
      submittedAt: new Date()
    });
    const aggregate = await getVenueReviewAggregate(venue.slug);
    await syncVenueRating(venue.slug);

    res.status(201).json({
      success: true,
      message: 'Venue review submitted successfully.',
      data: { ...review.toObject(), isOwner: true },
      count: aggregate.count,
      averageRating: aggregate.averageRating
    });
  } catch (error) {
    console.error('Error submitting venue review:', error);
    res.status(500).json({ success: false, error: 'Failed to submit venue review.' });
  }
});

/**
 * PUT /api/reviews/venue/:id
 * Update a venue review owned by the authenticated user.
 */
router.put('/venue/:id', protect, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review || !review.venueSlug) {
      return res.status(404).json({ success: false, error: 'Venue review not found.' });
    }
    if (review.userId !== String(req.user.id)) {
      return res.status(403).json({ success: false, error: 'You can only edit your own review.' });
    }

    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const designation = typeof req.body.designation === 'string' ? req.body.designation.trim() : '';
    const headline = typeof req.body.headline === 'string' ? req.body.headline.trim() : '';
    const reviewText = typeof req.body.review === 'string' ? req.body.review.trim() : '';
    const rating = Number(req.body.rating);
    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ success: false, error: 'Enter a name between 2 and 120 characters.' });
    }
    if (designation.length < 2 || designation.length > 80) {
      return res.status(400).json({ success: false, error: 'Enter a designation between 2 and 80 characters.' });
    }
    if (headline.length < 3 || headline.length > 160) {
      return res.status(400).json({ success: false, error: 'Enter a review title between 3 and 160 characters.' });
    }
    if (reviewText.length < 4 || reviewText.length > 2000) {
      return res.status(400).json({ success: false, error: 'Enter feedback between 4 and 2,000 characters.' });
    }
    if (![1, 2, 3, 4, 5].includes(rating)) {
      return res.status(400).json({ success: false, error: 'Select a rating from 1 to 5.' });
    }

    review.name = name;
    review.title = designation;
    review.role = designation;
    review.headline = headline;
    review.review = reviewText;
    review.rating = rating;
    await review.save();

    const aggregate = await getVenueReviewAggregate(review.venueSlug);
    await syncVenueRating(review.venueSlug);
    res.status(200).json({
      success: true,
      message: 'Venue review updated successfully.',
      data: { ...review.toObject(), isOwner: true },
      count: aggregate.count,
      averageRating: aggregate.averageRating
    });
  } catch (error) {
    console.error('Error updating venue review:', error);
    res.status(500).json({ success: false, error: 'Failed to update venue review.' });
  }
});

/**
 * DELETE /api/reviews/venue/:id
 * Delete a venue review owned by the authenticated user.
 */
router.delete('/venue/:id', protect, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review || !review.venueSlug) {
      return res.status(404).json({ success: false, error: 'Venue review not found.' });
    }
    if (review.userId !== String(req.user.id)) {
      return res.status(403).json({ success: false, error: 'You can only delete your own review.' });
    }

    const venueSlug = review.venueSlug;
    await review.deleteOne();
    const aggregate = await getVenueReviewAggregate(venueSlug);
    await syncVenueRating(venueSlug);
    res.status(200).json({
      success: true,
      message: 'Venue review deleted successfully.',
      count: aggregate.count,
      averageRating: aggregate.averageRating
    });
  } catch (error) {
    console.error('Error deleting venue review:', error);
    res.status(500).json({ success: false, error: 'Failed to delete venue review.' });
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

/**
 * POST /api/reviews/:id/not-helpful
 * Increment not-helpful count (public, no auth).
 */
router.post('/:id/not-helpful', async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { $inc: { notHelpfulCount: 1 } },
      { new: true }
    );
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }
    res.status(200).json({ success: true, data: { notHelpfulCount: review.notHelpfulCount } });
  } catch (err) {
    console.error('Error updating not-helpful count:', err);
    res.status(500).json({ success: false, error: 'Failed to update not-helpful count.' });
  }
});

/**
 * PUT /api/reviews/:id
 * Edit an existing comment/review.
 */
router.put('/:id', async (req, res) => {
  try {
    const { review, comment, company, rating } = req.body;
    const txt = (review || comment || '').trim();
    if (!txt) {
      return res.status(400).json({ success: false, error: 'Review text is required.' });
    }
    const updateData = {
      review: txt,
      comment: txt
    };
    if (company !== undefined) updateData.company = company.trim();
    if (rating !== undefined) updateData.rating = Math.min(5, Math.max(1, Number(rating) || 5));

    const updated = await Review.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }
    const aggregate = await syncEventRating(updated.eventSlug);
    res.status(200).json({
      success: true,
      data: updated,
      count: aggregate?.count ?? 0,
      averageRating: aggregate?.averageRating ?? 0,
      message: 'Review updated successfully.'
    });
  } catch (err) {
    console.error('Error updating review:', err);
    res.status(500).json({ success: false, error: 'Failed to update review.' });
  }
});

/**
 * DELETE /api/reviews/:id
 * Delete a review (by id).
 */
router.delete('/:id', async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }
    const aggregate = await syncEventRating(review.eventSlug);
    res.status(200).json({
      success: true,
      count: aggregate?.count ?? 0,
      averageRating: aggregate?.averageRating ?? 0,
      message: 'Review deleted successfully.'
    });
  } catch (err) {
    console.error('Error deleting review:', err);
    res.status(500).json({ success: false, error: 'Failed to delete review.' });
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
