/**
 * @file wordpressRoutes.js
 * @description WordPress integration, bulk event synchronization, claimable event directory, and WordPress widget handlers.
 */

import express from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import AuthService from '../services/AuthService.js';
import EventService from '../services/EventService.js';
import { wordpressLimiter } from '../middlewares/rateLimiter.js';

const router = express.Router();

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
    const wpUrl = process.env.WORDPRESS_URL || 'https://visitexpo.in';
    const wpKey = process.env.WORDPRESS_API_KEY;

    if (wpKey) {
      try {
        console.log(`[WP-Claimable] Fetching live claimable events from WordPress: ${wpUrl}/wp-json/visitexpo/v1/claimable-events`);
        const wpResponse = await fetch(`${wpUrl}/wp-json/visitexpo/v1/claimable-events`, {
          headers: {
            'X-VisitExpo-Key': wpKey
          }
        });

        if (wpResponse.ok) {
          const wpData = await wpResponse.json();
          // Filter if search term is provided
          const { search } = req.query;
          if (search && wpData.success && wpData.data && wpData.data.docs) {
            const cleanSearch = search.toLowerCase();
            wpData.data.docs = wpData.data.docs.filter(e => 
              e.title.toLowerCase().includes(cleanSearch) || 
              (e.venue && e.venue.toLowerCase().includes(cleanSearch))
            );
            wpData.data.total = wpData.data.docs.length;
          }
          return res.status(200).json(wpData);
        } else {
          console.warn(`[WP-Claimable] WordPress returned error status ${wpResponse.status}. Falling back to MongoDB.`);
        }
      } catch (wpErr) {
        console.error('[WP-Claimable] Error connecting to WordPress custom API. Falling back to MongoDB:', wpErr);
      }
    }

    const { search, city, limit = 100, page = 1 } = req.query;

    const query = {
      isClaimed: { $ne: true },
      title: { $not: /cart|checkout|my account|password|profile|registration|refund|terms|privacy|login|thank|faqs|sample|contact|about us|blog|home/i },
      slug: { $not: /cart|checkout|my-account|password|profile|registration|refund|terms|privacy|login|thank|faqs|sample|contact|about-us|blog|home/i }
    };

    if (search) {
      query.$and = [
        {
          $or: [
            { title: { $regex: search, $options: 'i' } },
            { city: { $regex: search, $options: 'i' } },
            { categories: { $in: [new RegExp(search, 'i')] } }
          ]
        }
      ];
    }

    if (city) {
      query.city = { $regex: city, $options: 'i' };
    }

    const pgNum = parseInt(page, 10) || 1;
    const pgLimit = parseInt(limit, 10) || 20;
    const skip = (pgNum - 1) * pgLimit;

    const [docs, total] = await Promise.all([
      Event.find(query).sort({ startDate: 1, title: 1 }).skip(skip).limit(pgLimit),
      Event.countDocuments(query)
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
// 3. ORGANIZER ONBOARDING ENDPOINT
// ==========================================
/**
 * POST /api/wordpress/onboard-organizer
 * Registers organizer, sets up organization, attaches or claims WordPress event, and issues JWT tokens.
 */
router.post('/onboard-organizer', async (req, res, next) => {
  try {
    const { name, email, password, organizationName, website, phone, claimType, eventId, newEventData } = req.body;

    if (!name || !email || !organizationName) {
      return res.status(400).json({
        success: false,
        error: 'Name, Email, and Organization Name are required'
      });
    }

    let userId;
    let orgId;
    let userObj;

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      userId = existingUser._id;
      orgId = existingUser.organization;
      if (!orgId) {
        const org = await Organization.create({
          name: organizationName || existingUser.name,
          website: website || '',
          contact: { email: email.toLowerCase(), phone: phone || '' }
        });
        orgId = org._id;
        existingUser.organization = orgId;
        await existingUser.save();
      }
      userObj = existingUser.toObject();
    } else {
      if (!password) {
        return res.status(400).json({
          success: false,
          error: 'Password is required to create a new organizer account.'
        });
      }
      const authData = await AuthService.signup(name, email, password, organizationName);
      userId = authData.user.id || authData.user._id;
      orgId = authData.user.organization;

      // Set user as pending admin verification
      await User.findByIdAndUpdate(userId, { isVerified: false });
      userObj = { ...authData.user, isVerified: false };
    }

    // Update organization details if provided
    if (website || phone) {
      await Organization.findByIdAndUpdate(orgId, {
        website: website || '',
        'contact.phone': phone || '',
        'contact.email': email
      });
    }

    let targetEvent = null;

    // 2. Handle Event claiming or creation
    if (claimType === 'claim_existing' && eventId) {
      let event = null;
      if (mongoose.Types.ObjectId.isValid(eventId)) {
        event = await Event.findById(eventId);
      }
      if (!event) {
        event = await Event.findOne({ $or: [{ wpPostId: String(eventId) }, { slug: String(eventId) }] });
      }
      if (event) {
        event.organizer = orgId;
        event.isClaimed = true;
        event.claimedBy = userId;
        event.status = 'draft'; // Pending admin review
        await event.save();
        targetEvent = event;
      }
    } else if (claimType === 'create_new' && newEventData && newEventData.title) {
      targetEvent = await EventService.createEvent({
        ...newEventData,
        status: 'draft'
      }, orgId);
    }

    res.status(201).json({
      success: true,
      message: 'Organizer onboarding request submitted successfully! Your account and event claim are pending Super Admin approval.',
      pendingApproval: true,
      user: userObj,
      event: targetEvent
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
