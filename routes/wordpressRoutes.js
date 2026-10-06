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
    const wpUrl = process.env.WORDPRESS_URL || 'https://visitexpo.in';
    const wpKey = process.env.WORDPRESS_API_KEY;

    if (wpKey) {
      try {
        // Try fetching all events via inspect-event-meta first (supports posts_per_page: -1)
        console.log(`[WP-Claimable] Fetching live events from WordPress: ${wpUrl}/wp-json/visitexpo/v1/inspect-event-meta`);
        const wpMetaResponse = await fetch(`${wpUrl}/wp-json/visitexpo/v1/inspect-event-meta`, {
          headers: { 'X-VisitExpo-Key': wpKey }
        });

        if (wpMetaResponse.ok) {
          const wpMetaData = await wpMetaResponse.json();
          const rawDocs = wpMetaData.data?.docs || [];

          if (Array.isArray(rawDocs) && rawDocs.length > 0) {
            let docs = rawDocs.map((d, idx) => {
              const m = d.meta || {};
              const startTs = m.ovaem_date_start_time?.[0];
              const endTs = m.ovaem_date_end_time?.[0];
              const venue = m.ovaem_address_event?.[0] || m.ovaem_venue?.[0] || m.ovaem_address?.[0] || 'Exhibition Center';
              const rawDesc = m.yoast_wpseo_metadesc?.[0] || m.ovaem_desc_event?.[0] || m.ovaem_org_desc?.[0] || (m.content?.[0] ? m.content[0].slice(0, 300) : '') || '';

              const realImg = getWpImage(d.slug, d.id, d.id, d.title);
              return {
                _id: String(d.id || `wp-${idx}`),
                id: String(d.id || `wp-${idx}`),
                wpPostId: d.id,
                title: d.title || 'Exhibition Event',
                slug: d.slug,
                description: rawDesc,
                image: realImg,
                banner: realImg,
                startDate: startTs && parseInt(startTs) > 0 ? new Date(parseInt(startTs) * 1000).toISOString() : null,
                endDate: endTs && parseInt(endTs) > 0 ? new Date(parseInt(endTs) * 1000).toISOString() : null,
                venue: venue,
                city: m.ovaem_city?.[0] || 'India',
                isClaimed: false
              };
            });

            // Filter if search term is provided
            const { search, limit } = req.query;
            if (search) {
              const cleanSearch = search.toLowerCase();
              docs = docs.filter(e => 
                e.title.toLowerCase().includes(cleanSearch) || 
                (e.venue && e.venue.toLowerCase().includes(cleanSearch)) ||
                (e.city && e.city.toLowerCase().includes(cleanSearch))
              );
            }

            const total = docs.length;
            if (limit && limit !== 'all' && !isNaN(parseInt(limit, 10))) {
              docs = docs.slice(0, parseInt(limit, 10));
            }

            return res.status(200).json({
              success: true,
              data: {
                docs,
                total: total,
                count: docs.length
              }
            });
          }
        }

        // Fallback to claimable-events
        const wpResponse = await fetch(`${wpUrl}/wp-json/visitexpo/v1/claimable-events`, {
          headers: { 'X-VisitExpo-Key': wpKey }
        });

        if (wpResponse.ok) {
          const wpData = await wpResponse.json();
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
          status: 'draft'
        });
      }

      if (event) {
        event.organizer = orgId;
        event.isClaimed = true;
        event.claimedBy = userId;
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

    res.status(201).json({
      success: true,
      message: 'Organizer claim request submitted successfully! Your ownership verification is pending admin review.',
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
