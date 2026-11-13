/**
 * @file reviewRoutes.js
 * @description REST API routes for Reviews: public submission, public retrieval of approved/featured reviews,
 * and admin-protected moderation endpoints.
 */

import express from 'express';
import mongoose from 'mongoose';
import Review from '../models/Review.js';
import Venue from '../models/Venue.js';
import Event from '../models/Event.js';
import User from '../models/User.js';
import { protect, authorize } from '../middlewares/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { invalidateVenuesCache } from '../controllers/venueController.js';
import { DEFAULT_VENUES } from '../data/defaultVenues.js';
import { syncUserCompanyName } from '../services/companyProfileHelper.js';
import { notifyFollowersOnActivity } from '../services/followNotificationService.js';

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
      if (decoded) {
        req.user = {
          id: decoded.id,
          _id: decoded.id,
          email: decoded.email,
          role: decoded.role
        };
      }
    } catch (error) {
      // Public review browsing remains available if an optional session has expired.
    }
  }
  next();
}

function isAdminUser(user) {
  return ['super_admin', 'admin', 'sub_admin', 'subadmin'].includes(user?.role);
}

function isReviewOwner(review, user) {
  if (!review || !user) return false;
  if (user.id && review.userId && String(review.userId) === String(user.id)) {
    return true;
  }
  const reviewEmail = String(review.email || '').trim().toLowerCase();
  const userEmail = String(user.email || '').trim().toLowerCase();
  if (reviewEmail && userEmail && reviewEmail === userEmail) {
    return true;
  }
  return false;
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
    if (aggregate.count > 0) {
      await Venue.findOneAndUpdate(
        { slug: venueSlug },
        {
          rating: aggregate.averageRating,
          ratingsCount: aggregate.count,
          ratingSource: 'VisitExpo Verified Reviews'
        }
      );
    } else {
      const defaultMatch = DEFAULT_VENUES.find((d) => d.slug === venueSlug);
      await Venue.findOneAndUpdate(
        { slug: venueSlug },
        {
          rating: defaultMatch ? defaultMatch.rating : 0,
          ratingsCount: defaultMatch ? defaultMatch.ratingsCount : 0,
          ratingSource: defaultMatch ? (defaultMatch.ratingSource || 'Google Verified Reviews') : 'No reviews yet'
        }
      );
    }
    if (typeof invalidateVenuesCache === 'function') {
      invalidateVenuesCache();
    }
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
 * Submit a new review (authenticated user — tracks author userId/email and syncs updated company).
 */
router.post('/', protect, async (req, res) => {
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

    const resolvedStatus = ['pending', 'approved'].includes(status) ? status : 'approved';
    const resolvedEmail = String(req.user?.email || email || '').trim().toLowerCase();
    const resolvedUserId = req.user?.id ? String(req.user.id) : '';

    const newReview = await Review.create({
      name: nameText,
      email: resolvedEmail,
      userId: resolvedUserId,
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
      status: resolvedStatus, // Approved on event pages so comments display immediately; landing page reviews default to pending when specified
      isFeaturedOnLanding: false,
      submittedAt: new Date()
    });

    // Sync user's company name in backend if a valid company name was provided
    let updatedCompany = companyText;
    if (resolvedUserId && companyText && companyText.length >= 2) {
      const syncRes = await syncUserCompanyName(resolvedUserId, companyText);
      if (syncRes?.company) updatedCompany = syncRes.company;
    }

    const aggregate = await syncEventRating(newReview.eventSlug);

    // Notify followers of the reviewer & followers of the event about this review activity
    try {
      notifyFollowersOnActivity({
        actorUserId: resolvedUserId || null,
        actorEmail: resolvedEmail,
        actorName: nameText,
        eventSlug: newReview.eventSlug,
        eventTitle: eventTitleText,
        activityType: 'review_posted',
        title: `New Review by ${nameText}`,
        message: `${nameText} rated "${eventTitleText}" (${newReview.rating}/5 ★).`,
        url: newReview.eventSlug ? `/expo/${newReview.eventSlug}` : '/events'
      });
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: 'Comment posted successfully!',
      data: { ...newReview.toObject(), isOwner: true },
      updatedCompany,
      count: aggregate?.count ?? 1,
      averageRating: aggregate?.averageRating ?? newReview.rating
    });
  } catch (err) {
    console.error('Error submitting review:', err);
    res.status(500).json({ success: false, error: 'Failed to submit review.' });
  }
});

function extractVoterId(req) {
  return (
    req.user?.id ||
    req.user?._id ||
    req.user?.email ||
    req.body?.voterId ||
    req.query?.voterId ||
    req.headers['x-voter-id'] ||
    req.ip ||
    'anonymous_guest'
  ).toString().trim().toLowerCase();
}

function attachUserReaction(review, voterId, user = null) {
  const helpfulVoters = Array.isArray(review.helpfulVoters) ? review.helpfulVoters : [];
  const notHelpfulVoters = Array.isArray(review.notHelpfulVoters) ? review.notHelpfulVoters : [];

  let userReaction = null;
  if (voterId) {
    if (helpfulVoters.includes(voterId)) {
      userReaction = 'helpful';
    } else if (notHelpfulVoters.includes(voterId)) {
      userReaction = 'notHelpful';
    }
  }

  const helpfulCount = Number.isFinite(review.helpfulCount)
    ? Math.max(review.helpfulCount, helpfulVoters.length)
    : helpfulVoters.length;
  const notHelpfulCount = Number.isFinite(review.notHelpfulCount)
    ? Math.max(review.notHelpfulCount, notHelpfulVoters.length)
    : notHelpfulVoters.length;

  const isOwner = isReviewOwner(review, user);

  return {
    ...review,
    helpfulCount,
    notHelpfulCount,
    userReaction,
    isOwner
  };
}

async function applyReviewVote(reviewId, voterId, targetReaction) {
  const cleanId = String(reviewId || '').trim();
  if (!cleanId) return null;

  let review = null;
  if (mongoose.Types.ObjectId.isValid(cleanId)) {
    review = await Review.findById(cleanId);
  } else {
    review = await Review.findOne({ $or: [{ slug: cleanId }, { eventSlug: cleanId }] });
  }
  if (!review) return null;

  if (!Array.isArray(review.helpfulVoters)) review.helpfulVoters = [];
  if (!Array.isArray(review.notHelpfulVoters)) review.notHelpfulVoters = [];

  const cleanVoterId = String(voterId || '').trim().toLowerCase();
  if (!cleanVoterId) {
    throw new Error('Valid voter identification is required');
  }

  const wasHelpful = review.helpfulVoters.includes(cleanVoterId);
  const wasNotHelpful = review.notHelpfulVoters.includes(cleanVoterId);

  let finalReaction = null;

  if (targetReaction === 'helpful') {
    if (wasHelpful) {
      // Already voted helpful: idempotent check prevents duplicate increment
      finalReaction = 'helpful';
    } else {
      // If switching from not-helpful, pull from notHelpfulVoters
      if (wasNotHelpful) {
        review.notHelpfulVoters = review.notHelpfulVoters.filter((v) => v !== cleanVoterId);
      }
      review.helpfulVoters.push(cleanVoterId);
      finalReaction = 'helpful';
    }
  } else if (targetReaction === 'notHelpful') {
    if (wasNotHelpful) {
      // Already voted not-helpful: idempotent check prevents duplicate increment
      finalReaction = 'notHelpful';
    } else {
      // If switching from helpful, pull from helpfulVoters
      if (wasHelpful) {
        review.helpfulVoters = review.helpfulVoters.filter((v) => v !== cleanVoterId);
      }
      review.notHelpfulVoters.push(cleanVoterId);
      finalReaction = 'notHelpful';
    }
  } else if (targetReaction === 'none' || targetReaction === 'remove') {
    // Un-vote / toggle off
    if (wasHelpful) {
      review.helpfulVoters = review.helpfulVoters.filter((v) => v !== cleanVoterId);
    }
    if (wasNotHelpful) {
      review.notHelpfulVoters = review.notHelpfulVoters.filter((v) => v !== cleanVoterId);
    }
    finalReaction = null;
  }

  // Update counts to match voter arrays strictly
  review.helpfulCount = review.helpfulVoters.length;
  review.notHelpfulCount = review.notHelpfulVoters.length;

  await review.save();

  return {
    reviewId: review._id,
    helpfulCount: review.helpfulCount,
    notHelpfulCount: review.notHelpfulCount,
    userReaction: finalReaction
  };
}

/**
 * GET /api/reviews
 * Fetch all approved reviews (status: 'approved' or 'featured').
 */
router.get('/', optionalProtect, async (req, res) => {
  try {
    const voterId = extractVoterId(req);
    const { eventSlug, limit } = req.query;
    const filter = { status: { $in: ['approved', 'featured'] } };
    if (eventSlug) filter.eventSlug = eventSlug.toLowerCase().trim();

    const reviews = await Review.find(filter)
      .sort({ isFeaturedOnLanding: -1, createdAt: -1 })
      .limit(Number(limit) || 50)
      .lean();

    const formatted = reviews.map((r) => attachUserReaction(r, voterId, req.user));
    res.status(200).json({ success: true, count: formatted.length, data: formatted });
  } catch (err) {
    console.error('Error fetching reviews:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch reviews.' });
  }
});

/**
 * GET /api/reviews/featured
 * Fetch only reviews marked as featured on landing page.
 */
router.get('/featured', optionalProtect, async (req, res) => {
  try {
    const voterId = extractVoterId(req);
    // Strictly return only reviews approved by admin and marked for landing page showcase
    const reviews = await Review.find({
      isFeaturedOnLanding: true,
      status: { $in: ['approved', 'featured'] }
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    const formatted = reviews.map((r) => attachUserReaction(r, voterId, req.user));
    res.status(200).json({ success: true, count: formatted.length, data: formatted });
  } catch (err) {
    console.error('Error fetching featured reviews:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch featured reviews.' });
  }
});

/**
 * GET /api/reviews/event/:slug
 * Fetch approved reviews for a specific expo by slug.
 */
router.get('/event/:slug', optionalProtect, async (req, res) => {
  try {
    const voterId = extractVoterId(req);
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

    const formatted = reviews.map((r) => attachUserReaction(r, voterId, req.user));
    res.status(200).json({
      success: true,
      count: aggregate.count,
      averageRating: aggregate.averageRating,
      data: formatted
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
    if (review.userId !== String(req.user.id) && !isAdminUser(req.user)) {
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
 * Cast, toggle, or switch helpful feedback with duplicate vote prevention.
 */
router.post('/:id/helpful', optionalProtect, async (req, res) => {
  try {
    const voterId = extractVoterId(req);
    const isRemove = req.body?.action === 'remove' || req.body?.delta === -1;
    const targetReaction = isRemove ? 'none' : 'helpful';

    const result = await applyReviewVote(req.params.id, voterId, targetReaction);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }

    res.status(200).json({
      success: true,
      data: {
        reviewId: result.reviewId,
        helpfulCount: result.helpfulCount,
        notHelpfulCount: result.notHelpfulCount,
        userReaction: result.userReaction
      }
    });
  } catch (err) {
    console.error('Error updating helpful count:', err);
    res.status(500).json({ success: false, error: 'Failed to update helpful feedback.' });
  }
});

/**
 * POST /api/reviews/:id/not-helpful
 * Cast, toggle, or switch not-helpful feedback with duplicate vote prevention.
 */
router.post('/:id/not-helpful', optionalProtect, async (req, res) => {
  try {
    const voterId = extractVoterId(req);
    const isRemove = req.body?.action === 'remove' || req.body?.delta === -1;
    const targetReaction = isRemove ? 'none' : 'notHelpful';

    const result = await applyReviewVote(req.params.id, voterId, targetReaction);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }

    res.status(200).json({
      success: true,
      data: {
        reviewId: result.reviewId,
        helpfulCount: result.helpfulCount,
        notHelpfulCount: result.notHelpfulCount,
        userReaction: result.userReaction
      }
    });
  } catch (err) {
    console.error('Error updating not-helpful count:', err);
    res.status(500).json({ success: false, error: 'Failed to update not-helpful feedback.' });
  }
});

/**
 * POST /api/reviews/:id/reaction
 * Unified reaction endpoint: 'helpful' | 'notHelpful' | 'none'
 */
router.post('/:id/reaction', optionalProtect, async (req, res) => {
  try {
    const voterId = extractVoterId(req);
    let targetReaction = req.body?.reaction;
    if (!targetReaction) {
      if (req.body?.action === 'remove' || req.body?.delta === -1) targetReaction = 'none';
      else targetReaction = 'helpful';
    }

    const result = await applyReviewVote(req.params.id, voterId, targetReaction);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }

    res.status(200).json({
      success: true,
      data: {
        reviewId: result.reviewId,
        helpfulCount: result.helpfulCount,
        notHelpfulCount: result.notHelpfulCount,
        userReaction: result.userReaction
      }
    });
  } catch (err) {
    console.error('Error updating reaction feedback:', err);
    res.status(500).json({ success: false, error: 'Failed to update reaction feedback.' });
  }
});

/**
 * GET /api/reviews/organizer/my-events
 * Fetch all reviews added to expos owned/created/claimed by the authenticated organizer.
 */
router.get('/organizer/my-events', protect, authorize('organizer', 'super_admin', 'admin'), async (req, res) => {
  try {
    const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const userDoc = await User.findById(req.user.id).select('organization email role').lean();

    const ownerConditions = [
      { createdBy: req.user.id },
      { claimedBy: req.user.id },
      { organizer: req.user.id }
    ];
    if (userDoc?.organization) {
      ownerConditions.push({ organizer: userDoc.organization });
    }
    if (userDoc?.email) {
      ownerConditions.push({ orgEmail: { $regex: new RegExp(`^${escapeRegex(userDoc.email.trim())}$`, 'i') } });
    }

    const organizerEvents = await Event.find({ $or: ownerConditions })
      .select('_id title slug city startDate endDate status banner')
      .sort({ startDate: -1 })
      .lean();

    if (organizerEvents.length === 0) {
      return res.status(200).json({
        success: true,
        events: [],
        stats: { total: 0, averageRating: 0, approved: 0, pending: 0, rejected: 0, featured: 0, helpfulTotal: 0 },
        data: []
      });
    }

    const eventBySlug = new Map();
    const eventByTitle = new Map();
    const slugRegexes = [];
    const titleRegexes = [];

    for (const ev of organizerEvents) {
      if (ev.slug) {
        const s = String(ev.slug).trim().toLowerCase();
        eventBySlug.set(s, ev);
        slugRegexes.push(new RegExp(`^${escapeRegex(s)}$`, 'i'));
      }
      if (ev.title) {
        const t = String(ev.title).trim().toLowerCase();
        eventByTitle.set(t, ev);
        titleRegexes.push(new RegExp(`^${escapeRegex(ev.title.trim())}$`, 'i'));
      }
    }

    const matchConditions = [];
    if (slugRegexes.length > 0) matchConditions.push({ eventSlug: { $in: slugRegexes } });
    if (titleRegexes.length > 0) matchConditions.push({ eventTitle: { $in: titleRegexes } });

    const { eventSlug, status, rating, search } = req.query;
    const baseFilter = matchConditions.length > 0 ? { $or: matchConditions } : { _id: null };

    // Calculate summary stats across all reviews for the organizer's events (before view filters)
    const allOrgReviews = await Review.find(baseFilter).sort({ createdAt: -1 }).lean();

    const stats = {
      total: allOrgReviews.length,
      approved: allOrgReviews.filter((r) => r.status === 'approved').length,
      featured: allOrgReviews.filter((r) => r.status === 'featured').length,
      pending: allOrgReviews.filter((r) => r.status === 'pending').length,
      rejected: allOrgReviews.filter((r) => r.status === 'rejected').length,
      helpfulTotal: allOrgReviews.reduce((acc, r) => acc + (Number(r.helpfulCount) || 0), 0),
      averageRating:
        allOrgReviews.length > 0
          ? Number((allOrgReviews.reduce((acc, r) => acc + (Number(r.rating) || 0), 0) / allOrgReviews.length).toFixed(1))
          : 0
    };

    const filtered = allOrgReviews
      .filter((r) => {
        if (eventSlug && eventSlug !== 'all') {
          const targetSlug = String(eventSlug).trim().toLowerCase();
          const matchedEvent = eventBySlug.get(targetSlug);
          const revSlug = String(r.eventSlug || '').trim().toLowerCase();
          const revTitle = String(r.eventTitle || '').trim().toLowerCase();
          if (revSlug !== targetSlug && (!matchedEvent || revTitle !== String(matchedEvent.title || '').trim().toLowerCase())) {
            return false;
          }
        }
        if (status && status !== 'all' && r.status !== status) return false;
        if (rating && Number(r.rating) !== Number(rating)) return false;
        if (search && search.trim()) {
          const q = search.trim().toLowerCase();
          const haystack = [r.name, r.company, r.role, r.eventTitle, r.headline, r.review]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .map((r) => {
        const linkedEvent =
          eventBySlug.get(String(r.eventSlug || '').trim().toLowerCase()) ||
          eventByTitle.get(String(r.eventTitle || '').trim().toLowerCase()) ||
          null;
        return {
          ...r,
          isOwner: isReviewOwner(r, req.user),
          eventDetails: linkedEvent
            ? {
                _id: linkedEvent._id,
                title: linkedEvent.title,
                slug: linkedEvent.slug,
                city: linkedEvent.city,
                startDate: linkedEvent.startDate
              }
            : null
        };
      });

    res.status(200).json({
      success: true,
      events: organizerEvents,
      stats,
      count: filtered.length,
      data: filtered
    });
  } catch (err) {
    console.error('Error fetching organizer expo reviews:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch organizer expo reviews.' });
  }
});

/**
 * PUT /api/reviews/:id
 * Edit an existing comment/review (only the author who created it or an admin).
 */
router.put('/:id', protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }
    const existing = await Review.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }
    if (!isReviewOwner(existing, req.user) && !isAdminUser(req.user)) {
      return res.status(403).json({
        success: false,
        error: 'You are not authorized to edit another user\'s review.'
      });
    }

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
    if (isReviewOwner(existing, req.user) && company !== undefined && String(company).trim().length >= 2) {
      await syncUserCompanyName(req.user.id, company.trim());
    }
    const aggregate = await syncEventRating(updated.eventSlug);
    res.status(200).json({
      success: true,
      data: { ...updated.toObject(), isOwner: isReviewOwner(updated, req.user) },
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
 * Delete a review (strictly only the user who made it OR an admin).
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }
    const existing = await Review.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }
    if (!isReviewOwner(existing, req.user) && !isAdminUser(req.user)) {
      return res.status(403).json({
        success: false,
        error: 'You are not authorized to delete another user\'s review.'
      });
    }

    await existing.deleteOne();
    const aggregate = await syncEventRating(existing.eventSlug);
    if (existing.venueSlug) {
      await syncVenueRating(existing.venueSlug);
    }
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
router.get('/admin/all', protect, authorize('super_admin', 'admin'), async (req, res) => {
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
router.put('/admin/:id/status', protect, authorize('super_admin', 'admin'), async (req, res) => {
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
router.put('/admin/:id/feature', protect, authorize('super_admin', 'admin'), async (req, res) => {
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
router.delete('/admin/:id', protect, authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) {
      return res.status(404).json({ success: false, error: 'Review not found.' });
    }
    await syncEventRating(review.eventSlug);
    if (review.venueSlug) {
      await syncVenueRating(review.venueSlug);
    }
    res.status(200).json({ success: true, message: 'Review deleted permanently.' });
  } catch (err) {
    console.error('Error deleting review:', err);
    res.status(500).json({ success: false, error: 'Failed to delete review.' });
  }
});

export default router;
