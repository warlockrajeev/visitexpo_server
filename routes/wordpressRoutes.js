/**
 * @file wordpressRoutes.js
 * @description WordPress integration, bulk event synchronization, claimable event directory, and WordPress widget handlers.
 */

import express from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Ticket from '../models/Ticket.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import AuthService from '../services/AuthService.js';
import EventService from '../services/EventService.js';
import UserRepository from '../repositories/UserRepository.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { wordpressLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

import { syncEventToWordPress } from '../services/WordPressSyncService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __wpFilename = fileURLToPath(import.meta.url);
const __wpDirname = path.dirname(__wpFilename);

function getWpImage(slug, id, wpPostId, title) {
  try {
    const imgPath = path.join(__wpDirname, '../data/wordpress-event-images.json');
    if (fs.existsSync(imgPath)) {
      const data = JSON.parse(fs.readFileSync(imgPath, 'utf8'));
      if (slug && data[slug]) return data[slug];
      if (id && data[String(id)]) return data[String(id)];
      if (wpPostId && data[String(wpPostId)]) return data[String(wpPostId)];
      if (title) {
        const titleSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        if (data[titleSlug]) return data[titleSlug];
        const lowerTitle = title.toLowerCase();
        for (const [k, url] of Object.entries(data)) {
          if (k.length > 5 && isNaN(Number(k))) {
            const rk = k.replace(/-/g, ' ');
            if (lowerTitle.includes(rk) || (rk.length > 10 && rk.includes(lowerTitle))) return url;
          }
        }
      }
    }
  } catch {}
  return null;
}

// ==========================================
// 1. BULK / SINGLE WORDPRESS EVENT SYNC
// ==========================================
/**
 * POST /api/wordpress/sync
 * Sync events from WordPress pages/posts.
 */
router.post('/sync', wordpressLimiter, async (req, res, next) => {
  try {
    const { events } = req.body;
    
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        error: 'An array of "events" is required'
      });
    }

    const synced = [];
    for (const item of events) {
      if (!item.title) continue;

      const slug = item.slug || EventService._slugify(item.title);
      const wpPostId = item.wpPostId ? String(item.wpPostId) : '';

      // Check if event already exists by wpPostId or slug
      let event = null;
      if (wpPostId) {
        event = await Event.findOne({ wpPostId });
      }
      if (!event && slug) {
        event = await Event.findOne({ slug });
      }

      const eventData = {
        title: item.title,
        slug: slug,
        description: item.description || `Official expo listing for ${item.title}.`,
        venue: item.venue || item.location || 'Exhibition Center',
        city: item.city || 'India',
        country: item.country || 'India',
        startDate: item.startDate ? new Date(item.startDate) : new Date(),
        endDate: item.endDate ? new Date(item.endDate) : new Date(Date.now() + 86400000 * 2),
        timings: item.timings || '10:00 AM - 6:00 PM',
        categories: Array.isArray(item.categories) ? item.categories : [item.categories || 'Exhibition'],
        wpPostId: wpPostId,
        wpUrl: item.wpUrl || '',
        status: item.status || 'published'
      };

      if (event) {
        // Update existing event without overwriting claimed organizer status
        Object.assign(event, eventData);
        await event.save();
        synced.push(event);
      } else {
        // Create new unclaimed event
        event = await Event.create({
          ...eventData,
          isClaimed: false
        });

        // Auto-create a default ticket tier for the new event
        const ticketPrice = item.ticketPrice ? parseInt(item.ticketPrice, 10) : 0;
        const existingTicket = await Ticket.findOne({ event: event._id });
        if (!existingTicket) {
          await Ticket.create({
            title: ticketPrice > 0 ? 'General Admission' : 'Visitor Pass',
            description: ticketPrice > 0
              ? `Standard paid entry ticket — ₹${ticketPrice}`
              : 'Complimentary visitor registration pass',
            type: ticketPrice > 0 ? 'paid' : 'free',
            price: ticketPrice,
            currency: 'INR',
            capacity: 1000,
            event: event._id
          });
        }

        synced.push(event);
      }
    }

    res.status(200).json({
      success: true,
      message: `Successfully synced ${synced.length} events from WordPress.`,
      count: synced.length,
      synced
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 2. GET CLAIMABLE WORDPRESS EVENTS
// ==========================================
/**
 * GET /api/wordpress/claimable-events
 * Fetch list of unclaimed events for the Organizer Onboarding directory search.
 */
router.get('/claimable-events', wordpressLimiter, async (req, res, next) => {
  try {
    const { search, city, limit = 2500, page = 1 } = req.query;

    const query = {
      isClaimed: { $ne: true },
      title: { $not: /cart|checkout|my account|password|profile|registration|refund|terms|privacy|login|thank|faqs|sample|contact|about us|blog|home/i },
      slug: { $not: /cart|checkout|my-account|password|profile|registration|refund|terms|privacy|login|thank|faqs|sample|contact|about-us|blog|home/i }
    };

    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { title: { $regex: s, $options: 'i' } },
        { venue: { $regex: s, $options: 'i' } },
        { city: { $regex: s, $options: 'i' } },
        { categories: { $in: [new RegExp(s, 'i')] } }
      ];
    }

    if (city && city.trim()) {
      query.city = { $regex: city.trim(), $options: 'i' };
    }

    const pgLimit = limit === 'all' ? 2500 : (parseInt(limit, 10) || 2500);
    const pgNum = parseInt(page, 10) || 1;
    const skip = (pgNum - 1) * pgLimit;

    const [rawDocs, total] = await Promise.all([
      Event.find(query)
        .select('title slug description venue city country startDate endDate banner wpPostId wpUrl isClaimed orgName orgEmail orgPhone orgWebsite orgDesc orgLogo')
        .sort({ startDate: 1, title: 1 })
        .skip(skip)
        .limit(pgLimit)
        .lean(),
      Event.countDocuments(query)
    ]);

    const docs = rawDocs.map((e, idx) => ({
      _id: String(e._id),
      id: String(e.wpPostId || e._id),
      wpPostId: e.wpPostId || String(e._id),
      title: e.title,
      slug: e.slug,
      description: e.description || '',
      image: e.banner || getWpImage(e.slug, e._id, e.wpPostId, e.title) || null,
      banner: e.banner || getWpImage(e.slug, e._id, e.wpPostId, e.title) || null,
      startDate: e.startDate ? new Date(e.startDate).toISOString() : null,
      endDate: e.endDate ? new Date(e.endDate).toISOString() : null,
      venue: e.venue || 'Exhibition Center',
      city: e.city || 'India',
      country: e.country || 'India',
      isClaimed: false,
      orgName: e.orgName || 'Verified Organizer',
      orgEmail: e.orgEmail || '',
      orgPhone: e.orgPhone || '',
      orgWebsite: e.orgWebsite || '',
      orgDesc: e.orgDesc || '',
      orgLogo: e.orgLogo || ''
    }));

    return res.status(200).json({
      success: true,
      data: {
        docs,
        total,
        page: pgNum,
        count: docs.length
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 2.5 CLAIM QUOTA ENDPOINT & HELPER
// ==========================================
/**
 * Helper to calculate daily event claim quota for an organizer.
 * Free plan: max 3 claims per calendar day.
 * Starter / Enterprise / Growth plans & Super Admin / Admin: unlimited claims.
 */
async function getOrganizerClaimQuota(userId) {
  if (!userId) {
    return {
      plan: 'free',
      isUnlimited: false,
      dailyLimit: 3,
      claimsToday: 0,
      claimsRemaining: 3,
      canClaim: true
    };
  }

  const user = await User.findById(userId);
  if (!user) {
    return {
      plan: 'free',
      isUnlimited: false,
      dailyLimit: 3,
      claimsToday: 0,
      claimsRemaining: 3,
      canClaim: true
    };
  }

  // Super admins and platform admins bypass daily limits
  const isAdmin = ['super_admin', 'admin', 'sub_admin', 'subadmin'].includes(user.role);

  let sub = await Subscription.findOne({
    $or: [
      ...(user.organization ? [{ organization: user.organization }] : []),
      { user: user._id }
    ],
    status: 'active'
  }).sort({ createdAt: -1 });

  const rawPlan = (sub?.plan || user.plan || 'free').toLowerCase();
  const isPlanActive = sub ? sub.status === 'active' : !!user.isPlanActive;
  const isPaidTier = isPlanActive && ['starter', 'enterprise', 'growth'].includes(rawPlan);
  const isUnlimited = isAdmin || isPaidTier;

  // Calendar day window: from today's midnight 00:00:00
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const claimsToday = await Event.countDocuments({
    claimedBy: user._id,
    isClaimed: true,
    $or: [
      { claimedAt: { $gte: startOfDay } },
      { claimedAt: null, updatedAt: { $gte: startOfDay } },
      { claimedAt: null, createdAt: { $gte: startOfDay } }
    ]
  });

  const dailyLimit = isUnlimited ? null : 3;
  const claimsRemaining = isUnlimited ? null : Math.max(0, 3 - claimsToday);
  const canClaim = isUnlimited || claimsToday < 3;

  return {
    plan: isUnlimited ? (isAdmin ? 'admin' : rawPlan) : 'free',
    isUnlimited,
    dailyLimit,
    claimsToday,
    claimsRemaining,
    canClaim
  };
}

/**
 * GET /api/wordpress/claim-quota
 * Returns current organizer's daily event claim quota, used count, and plan limit.
 */
router.get('/claim-quota', async (req, res, next) => {
  try {
    let token = null;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(200).json({
        success: true,
        authenticated: false,
        quota: {
          plan: 'free',
          isUnlimited: false,
          dailyLimit: 3,
          claimsToday: 0,
          claimsRemaining: 3,
          canClaim: true
        }
      });
    }

    const decoded = verifyAccessToken(token);
    if (!decoded?.id) {
      return res.status(200).json({
        success: true,
        authenticated: false,
        quota: {
          plan: 'free',
          isUnlimited: false,
          dailyLimit: 3,
          claimsToday: 0,
          claimsRemaining: 3,
          canClaim: true
        }
      });
    }

    const quota = await getOrganizerClaimQuota(decoded.id);

    res.status(200).json({
      success: true,
      authenticated: true,
      quota
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 3. ORGANIZER ONBOARDING ENDPOINT
// ==========================================
/**
 * POST /api/wordpress/onboard-organizer
 * Registers organizer, sets up organization, attaches or claims WordPress event, and issues JWT tokens.
 */
router.post('/onboard-organizer', async (req, res, next) => {
  try {
    const {
      name,
      email,
      officialEmail,
      password,
      organizationName,
      website,
      phone,
      claimType,
      eventId,
      newEventData,
      proofFileName,
      additionalNotes,
      city
    } = req.body;

    // --- Strict Field Validation ---
    const targetEmail = (officialEmail || email || '').toLowerCase().trim();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!targetEmail || !emailRegex.test(targetEmail)) {
      return res.status(400).json({
        success: false,
        error: 'A valid official corporate email is required (e.g. organizer@company.com).'
      });
    }

    if (!website || !website.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Official website URL is required.'
      });
    }
    const urlRegex = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?$/i;
    if (!urlRegex.test(website.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid website URL (e.g. https://eventdomain.com).'
      });
    }

    if (!phone || !phone.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Contact phone hotline is required.'
      });
    }
    const cleanDigits = phone.replace(/\D/g, '');
    const hasLetters = /[a-zA-Z]/.test(phone);
    if (hasLetters || cleanDigits.length < 10 || cleanDigits.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid phone number (10 to 15 digits, numbers only, no letters).'
      });
    }

    if (claimType === 'claim_existing' && (!proofFileName || !proofFileName.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Upload proof of ownership document (incorporation cert or authorization letter) is mandatory.'
      });
    }

    if (additionalNotes && additionalNotes.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Notes to moderation team cannot exceed 1000 characters.'
      });
    }

    let userId = null;
    let orgId = null;
    let userObj = null;

    // 1. Authenticate user from Bearer token or cookies if available
    let token = null;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (token) {
      const decoded = verifyAccessToken(token);
      if (decoded?.id) {
        const authUser = await User.findById(decoded.id);
        if (authUser) {
          userId = authUser._id;
          orgId = authUser.organization;
          userObj = authUser.toObject();
        }
      }
    }

    // 2. If not authenticated via token, check if user exists by email
    const effectiveEmail = (officialEmail || email || '').toLowerCase().trim();
    if (!userId && effectiveEmail) {
      const existingUser = await User.findOne({ email: effectiveEmail });
      if (existingUser) {
        userId = existingUser._id;
        orgId = existingUser.organization;
        userObj = existingUser.toObject();
      }
    }

    // 3. If user still does not exist, safely register new organizer account without OTP/city blockage
    if (!userId) {
      if (!effectiveEmail) {
        return res.status(400).json({
          success: false,
          error: 'Email address is required for organizer verification.'
        });
      }

      const userCity = city || (newEventData && newEventData.city) || 'India';
      const cleanPhone = phone ? String(phone).replace(/[^0-9]/g, '') : '';
      const newUser = await UserRepository.create({
        name: (name || 'Organizer User').trim(),
        email: effectiveEmail,
        password: password || 'Password123!',
        role: 'organizer',
        phone: cleanPhone,
        city: userCity,
        isVerified: false,
        isPhoneVerified: false,
        authProvider: 'local',
        hasCustomPassword: !!password
      });

      userId = newUser._id;
      userObj = newUser.toObject();
    }

    // 4. Ensure Organization is associated
    const effectiveOrgName = organizationName || userObj?.company || userObj?.name || 'Organizer Organization';
    if (!orgId) {
      const org = await Organization.create({
        name: effectiveOrgName,
        website: website || '',
        contact: {
          email: effectiveEmail || userObj?.email || '',
          phone: phone || userObj?.phone || ''
        },
        address: { city: city || userObj?.city || 'India' },
        teamMembers: [{ user: userId, role: 'organizer' }]
      });
      orgId = org._id;
      await User.findByIdAndUpdate(userId, { organization: orgId });
    } else {
      const updateData = {};
      if (website) updateData.website = website;
      if (phone) updateData['contact.phone'] = phone;
      if (effectiveEmail) updateData['contact.email'] = effectiveEmail;
      if (Object.keys(updateData).length > 0) {
        await Organization.findByIdAndUpdate(orgId, updateData);
      }
    }

    let targetEvent = null;

    // 5. Handle Event claiming or creation
    if (claimType === 'claim_existing' && (eventId || req.body.eventData)) {
      let event = null;
      const cleanEventId = String(eventId || '');
      const eventSlug = req.body.eventSlug || req.body.eventData?.slug;
      const eventWpPostId = req.body.wpPostId || req.body.eventData?.wpPostId || (cleanEventId.startsWith('wp-') ? '' : cleanEventId);

      if (mongoose.Types.ObjectId.isValid(cleanEventId)) {
        event = await Event.findById(cleanEventId);
      }
      if (!event) {
        const queryOr = [];
        if (eventWpPostId) queryOr.push({ wpPostId: String(eventWpPostId) });
        if (eventSlug) queryOr.push({ slug: String(eventSlug) });
        if (cleanEventId) {
          queryOr.push({ wpPostId: cleanEventId });
          queryOr.push({ slug: cleanEventId });
        }
        if (req.body.eventData?.title) {
          queryOr.push({ title: new RegExp(`^${req.body.eventData.title.trim()}$`, 'i') });
        }
        if (queryOr.length > 0) {
          event = await Event.findOne({ $or: queryOr });
        }
      }

      // If event is not yet synced to MongoDB, create it on-the-fly from eventData so the claim can be processed
      if (!event && req.body.eventData) {
        const d = req.body.eventData;
        const cleanTitle = d.title || 'Exhibition Event';
        const cleanSlug = d.slug || cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const cleanCity = (d.city || 'India').replace(/\d+/g, '').trim() || 'India';
        const rawWpId = d.wpPostId ? String(d.wpPostId) : (cleanEventId.startsWith('wp-') ? '' : cleanEventId);

        event = new Event({
          title: cleanTitle,
          slug: cleanSlug,
          description: d.description || `Official expo listing for ${cleanTitle}.`,
          venue: d.venue || 'Exhibition Center',
          city: cleanCity,
          country: d.country || 'India',
          startDate: d.startDate ? new Date(d.startDate) : new Date(),
          endDate: d.endDate ? new Date(d.endDate) : new Date(Date.now() + 86400000 * 2),
          timings: d.timings || '10:00 AM - 6:00 PM',
          categories: Array.isArray(d.categories) && d.categories.length > 0 ? d.categories : ['Exhibition'],
          image: d.image || '',
          banner: d.banner || '',
          wpPostId: rawWpId,
          wpUrl: d.wpUrl || '',
          organizer: orgId,
          isClaimed: true,
          claimedBy: userId,
          claimedAt: new Date(),
          status: 'draft'
        });
      }

      if (event) {
        // Prevent claiming an event that is already claimed by another organizer
        if (event.isClaimed && event.claimedBy && String(event.claimedBy) !== String(userId)) {
          return res.status(400).json({
            success: false,
            error: 'This event listing has already been claimed by another organizer.'
          });
        }

        // Enforce Plan Claim Quota: Free plan limit is 3 claims per day; Starter/Enterprise are unlimited
        const isExistingClaimUpdate = event.isClaimed && String(event.claimedBy) === String(userId);
        if (!isExistingClaimUpdate) {
          const quota = await getOrganizerClaimQuota(userId);
          if (!quota.canClaim) {
            return res.status(403).json({
              success: false,
              error: `Daily event claim limit reached. Free organizers can claim up to 3 events per day (${quota.claimsToday}/3 used). Upgrade to Starter or Enterprise plan to claim unlimited events.`,
              dailyLimitReached: true,
              claimsToday: quota.claimsToday,
              maxDailyClaims: 3,
              plan: 'free'
            });
          }
        }

        event.organizer = orgId;
        event.isClaimed = true;
        event.claimedBy = userId;
        event.claimedAt = new Date();
        event.status = 'draft'; // Pending admin review

        if (officialEmail || effectiveEmail) {
          event.orgEmail = officialEmail || effectiveEmail;
        }
        if (phone) {
          event.orgPhone = phone;
        }
        if (website) {
          event.orgWebsite = website;
        }
        if (effectiveOrgName) {
          event.orgName = effectiveOrgName;
        }
        if (additionalNotes) {
          event.orgDesc = additionalNotes;
          event.claimNotes = additionalNotes;
        }
        if (proofFileName) {
          event.claimProof = proofFileName;
        }

        await event.save();
        targetEvent = event;
      } else {
        return res.status(404).json({
          success: false,
          error: 'Event not found in directory. Please select an event to claim.'
        });
      }
    } else if (claimType === 'create_new' && newEventData && newEventData.title) {
      targetEvent = await EventService.createEvent({
        ...newEventData,
        status: 'draft'
      }, orgId);
    }

    if (targetEvent) {
      try {
        await syncEventToWordPress(targetEvent);
      } catch (syncErr) {
        console.warn('[WP-Claim] WordPress sync warning:', syncErr.message);
      }
    }

    const updatedQuota = await getOrganizerClaimQuota(userId);

    res.status(201).json({
      success: true,
      message: 'Organizer claim request submitted successfully! Your ownership verification is pending admin review.',
      pendingApproval: true,
      user: userObj,
      event: targetEvent,
      quota: updatedQuota
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 4. WORDPRESS EMBED WIDGET JS HELPER
// ==========================================
/**
 * GET /api/wordpress/widget.js
 * Serves a lightweight JavaScript loader snippet for WordPress.
 */
router.get('/widget.js', (req, res) => {
  const dashboardUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  
  const jsContent = `
(function() {
  const DASHBOARD_URL = "${dashboardUrl}";
  
  function initVisitExpoWidgets() {
    const exhibitorBtns = document.querySelectorAll('.visitexpo-exhibitor-btn');
    exhibitorBtns.forEach(btn => {
      const eventId = btn.getAttribute('data-event-id') || '';
      const wpSlug = btn.getAttribute('data-wp-slug') || '';
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        window.open(DASHBOARD_URL + '/onboarding/exhibitor?eventId=' + encodeURIComponent(eventId) + '&wp_slug=' + encodeURIComponent(wpSlug), '_blank');
      });
    });

    const claimBtns = document.querySelectorAll('.visitexpo-claim-btn');
    claimBtns.forEach(btn => {
      const wpSlug = btn.getAttribute('data-wp-slug') || '';
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        window.open(DASHBOARD_URL + '/onboarding/organizer?claim_slug=' + encodeURIComponent(wpSlug), '_blank');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVisitExpoWidgets);
  } else {
    initVisitExpoWidgets();
  }
})();
  `;

  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(jsContent);
});

export default router;
