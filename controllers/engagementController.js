/**
 * @file engagementController.js
 * @description Controller methods for Event Interest & Follower engagement system.
 */

import mongoose from 'mongoose';
import EventEngagement from '../models/EventEngagement.js';
import User from '../models/User.js';
import Event from '../models/Event.js';
import Visitor from '../models/Visitor.js';
import Lead from '../models/Lead.js';
import WordPressDirectorySyncService from '../services/WordPressDirectorySyncService.js';
import { deleteUserAndAllPlatformData } from '../services/userDeletionService.js';
import { notifyOrganizerOnFollow, notifyOrganizerOnInterest } from '../services/oneSignalService.js';

/**
 * @desc Toggle interest or follow for a user on a specific event
 * @route POST /api/engagements/toggle
 */
export const toggleEngagement = async (req, res) => {
  try {
    const {
      eventSlug,
      eventId,
      eventTitle,
      eventCity,
      eventCountry,
      eventVenue,
      eventDates,
      eventCategory,
      eventImage,
      organizerId,
      organizerName,
      actionType, // 'interested' | 'follower'
      user: customUser
    } = req.body;

    if (!eventSlug) {
      return res.status(400).json({ success: false, message: 'Event slug is required' });
    }

    const cleanSlug = eventSlug.toLowerCase().trim();
    const action = ['follower', 'bookmark'].includes(actionType) ? actionType : 'interested';

    // Resolve user details from auth middleware or payload
    const currentUser = req.user || customUser;
    if (!currentUser || (!currentUser.email && !currentUser.id && !currentUser._id)) {
      return res.status(401).json({
        success: false,
        message: 'Authentication or user email is required to register interest, follow, or bookmark'
      });
    }

    const userEmail = (currentUser.email || '').toLowerCase().trim();
    if (!userEmail) {
      return res.status(400).json({ success: false, message: 'Valid user email is required' });
    }

    const userId = String(currentUser.id || currentUser._id || '');
    const userName = currentUser.name || userEmail.split('@')[0];
    const userRole = currentUser.role || 'visitor';
    const userPhone = currentUser.phone || '';
    const userCompany = currentUser.company || currentUser.organization?.name || '';
    const userDesignation = currentUser.designation || '';
    const userCity = currentUser.city || '';
    const userCountry = currentUser.country || '';
    const userAvatar = currentUser.avatar || '';

    // Lookup matching Event from MongoDB to ensure complete, accurate event metadata
    let dbEvent = null;
    try {
      if (eventId && mongoose.isValidObjectId(eventId)) {
        dbEvent = await Event.findById(eventId).populate('organizer', 'name').lean();
      }
      if (!dbEvent && cleanSlug) {
        dbEvent = await Event.findOne({
          $or: [
            { slug: cleanSlug },
            { wpPostId: cleanSlug },
            ...(mongoose.isValidObjectId(cleanSlug) ? [{ _id: cleanSlug }] : [])
          ]
        })
          .populate('organizer', 'name')
          .lean();
      }
    } catch (_) {}

    const dbDates = dbEvent?.startDate
      ? `${new Date(dbEvent.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${
          dbEvent.endDate
            ? ` – ${new Date(dbEvent.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            : ''
        }`
      : '';
    const dbOrgName =
      dbEvent?.organizer?.name ||
      (dbEvent?.orgName &&
      !/^[0-9a-fA-F]{24}$/.test(dbEvent.orgName) &&
      !dbEvent.orgName.includes('onrender.com')
        ? dbEvent.orgName
        : '');

    const resolvedTitle = dbEvent?.title || eventTitle || cleanSlug.replace(/-/g, ' ').toUpperCase();
    const resolvedCity = dbEvent?.city || eventCity || '';
    const resolvedCountry = dbEvent?.country || eventCountry || 'India';
    const resolvedVenue = dbEvent?.venue || eventVenue || '';
    const resolvedDates = dbDates || eventDates || '';
    const resolvedCategory =
      (Array.isArray(dbEvent?.categories) && dbEvent.categories[0]) || eventCategory || '';
    const resolvedImage = dbEvent?.banner || eventImage || '';
    const resolvedOrgId =
      organizerId || (dbEvent?.organizer?._id ? String(dbEvent.organizer._id) : '');
    const resolvedOrgName =
      dbOrgName ||
      (organizerName &&
      !/^[0-9a-fA-F]{24}$/.test(organizerName) &&
      !organizerName.includes('onrender.com')
        ? organizerName
        : '');

    // Find existing engagement
    let engagement = await EventEngagement.findOne({
      userEmail,
      eventSlug: cleanSlug
    });

    if (engagement) {
      // Toggle logic
      const isCurrentlyActive = engagement.status === 'active';
      const currentType = engagement.type;

      if (action === 'bookmark') {
        engagement.isBookmarked = !engagement.isBookmarked;
        engagement.status = 'active';
      } else if (action === 'interested') {
        const currentlyInterested = engagement.isInterested || (isCurrentlyActive && (currentType === 'interested' || currentType === 'both'));

        if (currentlyInterested) {
          engagement.isInterested = false;
          if (currentType === 'both') {
            engagement.type = 'follower';
            engagement.status = 'active';
          } else if (engagement.isBookmarked || engagement.isFollowed) {
            engagement.status = 'active';
          } else {
            engagement.status = 'inactive';
          }
        } else {
          engagement.isInterested = true;
          if (isCurrentlyActive && (currentType === 'follower' || engagement.isFollowed)) {
            engagement.type = 'both';
          } else {
            engagement.type = 'interested';
          }
          engagement.status = 'active';
        }
      } else if (action === 'follower') {
        const currentlyFollowing = engagement.isFollowed || (isCurrentlyActive && (currentType === 'follower' || currentType === 'both'));

        if (currentlyFollowing) {
          engagement.isFollowed = false;
          if (currentType === 'both') {
            engagement.type = 'interested';
            engagement.status = 'active';
          } else if (engagement.isBookmarked || engagement.isInterested) {
            engagement.status = 'active';
          } else {
            engagement.status = 'inactive';
          }
        } else {
          engagement.isFollowed = true;
          if (isCurrentlyActive && (currentType === 'interested' || engagement.isInterested)) {
            engagement.type = 'both';
          } else {
            engagement.type = 'follower';
          }
          engagement.status = 'active';
        }
      }

      // Update metadata
      if (resolvedTitle) engagement.eventTitle = resolvedTitle;
      if (resolvedCity) engagement.eventCity = resolvedCity;
      if (resolvedCountry) engagement.eventCountry = resolvedCountry;
      if (resolvedVenue) engagement.eventVenue = resolvedVenue;
      if (resolvedDates) engagement.eventDates = resolvedDates;
      if (resolvedCategory) engagement.eventCategory = resolvedCategory;
      if (resolvedImage) engagement.eventImage = resolvedImage;
      if (resolvedOrgId) engagement.organizerId = resolvedOrgId;
      if (resolvedOrgName) engagement.organizerName = resolvedOrgName;
      if (userName) engagement.userName = userName;
      if (userCompany) engagement.userCompany = userCompany;
      if (userDesignation) engagement.userDesignation = userDesignation;
      if (userCity) engagement.userCity = userCity;
      if (userCountry) engagement.userCountry = userCountry;

      await engagement.save();
    } else {
      // Create new engagement
      engagement = await EventEngagement.create({
        user: userId && userId.length === 24 ? userId : null,
        userId,
        userName,
        userEmail,
        userPhone,
        userAvatar,
        userCompany,
        userDesignation,
        userCity,
        userCountry,
        userRole,
        eventSlug: cleanSlug,
        eventId: eventId || (dbEvent?._id ? String(dbEvent._id) : ''),
        eventTitle: resolvedTitle,
        eventCity: resolvedCity,
        eventCountry: resolvedCountry,
        eventVenue: resolvedVenue,
        eventDates: resolvedDates,
        eventCategory: resolvedCategory,
        eventImage: resolvedImage,
        organizerId: resolvedOrgId,
        organizerName: resolvedOrgName,
        type: action,
        isBookmarked: action === 'bookmark',
        isInterested: action === 'interested',
        isFollowed: action === 'follower',
        status: 'active',
        passType: userRole === 'visitor' ? 'Complimentary Visitor Pass' : 'Exhibitor Delegate',
        objective: 'Evaluating suppliers, B2B procurement, and business networking.'
      });
    }

    const isBookmarked = !!engagement.isBookmarked;
    const isInterested = engagement.isInterested || (engagement.status === 'active' && (engagement.type === 'interested' || engagement.type === 'both'));
    const isFollower = engagement.isFollowed || (engagement.status === 'active' && (engagement.type === 'follower' || engagement.type === 'both'));

    // Automatically create or update a Lead in the CRM for the event's organizer
    try {
      let targetEvt = null;
      if (eventId && mongoose.isValidObjectId(eventId)) {
        targetEvt = await Event.findById(eventId);
      }
      if (!targetEvt && cleanSlug) {
        targetEvt = await Event.findOne({ slug: cleanSlug });
      }

      if (targetEvt) {
        const orgEmail = (targetEvt.organizerEmail || targetEvt.orgEmail || '').toLowerCase().trim();
        const orgId = targetEvt.organizer ? String(targetEvt.organizer) : '';
        const isOrganizerSelf = (orgEmail && orgEmail === userEmail) || (orgId && orgId === userId);

        if (!isOrganizerSelf) {
          let leadDoc = await Lead.findOne({ event: targetEvt._id, email: userEmail });
          if (leadDoc) {
            leadDoc.leadScore = Math.max(leadDoc.leadScore || 50, action === 'interested' ? 70 : 55);
            leadDoc.activityTimeline.push({
              type: 'note',
              content: `User marked "${action === 'interested' ? 'Interested' : 'Followed'}" for this event on VisitExpo.`
            });
            await leadDoc.save();
          } else {
            await Lead.create({
              name: userName,
              email: userEmail,
              phone: userPhone || '',
              company: userCompany || 'Interested Attendee',
              designation: userDesignation || 'Trade Visitor',
              country: eventCountry || targetEvt.country || 'India',
              leadScore: action === 'interested' ? 65 : 50,
              source: action === 'interested' ? 'interested' : 'follower',
              status: 'new',
              event: targetEvt._id,
              notes: `Captured when user clicked "${action === 'interested' ? 'Interested' : 'Follow'}" for "${targetEvt.title}".`,
              activityTimeline: [
                {
                  type: 'note',
                  content: `User registered interest (${action}) on VisitExpo directory.`
                }
              ]
            });
          }

          // Trigger Web Push notification to Organizer (Enterprise plan only)
          if (action === 'follower' && isFollower) {
            notifyOrganizerOnFollow({
              event: targetEvt,
              userName,
              userEmail,
              userCompany
            }).catch(pushErr => console.warn('[EngagementController] Follow push error:', pushErr.message));
          } else if (action === 'interested' && isInterested) {
            notifyOrganizerOnInterest({
              event: targetEvt,
              userName,
              userEmail,
              userCompany
            }).catch(pushErr => console.warn('[EngagementController] Interest push error:', pushErr.message));
          }
        }
      }
    } catch (leadSyncErr) {
      console.warn('[EngagementController] Failed to auto-sync Lead:', leadSyncErr.message);
    }

    // Aggregate live counts for this event directly from MongoDB
    const [interestedCount, followersCount, visitorCount] = await Promise.all([
      EventEngagement.countDocuments({
        $or: [
          { eventSlug: cleanSlug },
          ...(dbEvent?._id ? [{ eventId: String(dbEvent._id) }] : [])
        ],
        status: 'active',
        $or: [
          { isInterested: true },
          { type: { $in: ['interested', 'both'] } }
        ]
      }),
      EventEngagement.countDocuments({
        $or: [
          { eventSlug: cleanSlug },
          ...(dbEvent?._id ? [{ eventId: String(dbEvent._id) }] : [])
        ],
        status: 'active',
        $or: [
          { isFollowed: true },
          { type: { $in: ['follower', 'both'] } }
        ]
      }),
      dbEvent?._id
        ? Visitor.countDocuments({
            event: dbEvent._id,
            registrationStatus: { $ne: 'cancelled' }
          })
        : 0
    ]);

    const totalInterestedAndAttending = interestedCount + (visitorCount || 0);

    // Invalidate WordPress sync cache so directory endpoints immediately reflect the change
    try {
      WordPressDirectorySyncService.updateEventInterestedCount(cleanSlug, 0, totalInterestedAndAttending);
      if (dbEvent?._id) {
        WordPressDirectorySyncService.updateEventInterestedCount(String(dbEvent._id), 0, totalInterestedAndAttending);
      }
      WordPressDirectorySyncService.clearCache();
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: `Successfully updated ${action} status for ${cleanSlug}`,
      data: {
        isBookmarked,
        isInterested,
        isFollower,
        type: engagement.type,
        status: engagement.status,
        engagement,
        counts: {
          interested: totalInterestedAndAttending,
          followers: followersCount,
          visitors: visitorCount || 0
        }
      }
    });
  } catch (error) {
    console.error('Error in toggleEngagement:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc Get real attendees and followers for a specific event
 * @route GET /api/engagements/event/:slug
 */
export const getEventEngagements = async (req, res) => {
  try {
    const { slug } = req.params;
    if (!slug) {
      return res.status(400).json({ success: false, message: 'Event slug is required' });
    }

    const cleanSlug = slug.toLowerCase().trim();
    const emailQuery = (req.query.email || '').toLowerCase().trim();
    const userIdQuery = req.query.userId || (req.user ? req.user.id || req.user._id : null);

    const networkQuery = {
      eventSlug: cleanSlug,
      status: 'active',
      $or: [
        { isInterested: true },
        { isFollowed: true },
        { type: { $in: ['interested', 'follower', 'both'] } }
      ]
    };
    const [attendees, interestedCount, followersCount] = await Promise.all([
      EventEngagement.find(networkQuery).sort({ createdAt: -1 }),
      EventEngagement.countDocuments({
        eventSlug: cleanSlug,
        status: 'active',
        $or: [
          { isInterested: true },
          { type: { $in: ['interested', 'both'] } }
        ]
      }),
      EventEngagement.countDocuments({
        eventSlug: cleanSlug,
        status: 'active',
        $or: [
          { isFollowed: true },
          { type: { $in: ['follower', 'both'] } }
        ]
      })
    ]);

    // Check user's current engagement
    let userEngagement = null;
    if (emailQuery || userIdQuery) {
      userEngagement = attendees.find(
        (a) =>
          (emailQuery && a.userEmail === emailQuery) ||
          (userIdQuery && String(a.userId) === String(userIdQuery))
      );
    }

    const isInterested = Boolean(userEngagement?.status === 'active' && (
      userEngagement.isInterested || userEngagement.type === 'interested' || userEngagement.type === 'both'
    ));

    const isFollower = Boolean(userEngagement?.status === 'active' && (
      userEngagement.isFollowed || userEngagement.type === 'follower' || userEngagement.type === 'both'
    ));

    return res.status(200).json({
      success: true,
      data: {
        slug: cleanSlug,
        attendees,
        total: attendees.length,
        counts: {
          interested: interestedCount,
          followers: followersCount
        },
        userStatus: {
          isInterested,
          isFollower,
          engagement: userEngagement || null
        }
      }
    });
  } catch (error) {
    console.error('Error in getEventEngagements:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc Get all events a user has shown interest in or is following
 * @route GET /api/engagements/user/:userIdOrEmail
 */
export const getUserEngagements = async (req, res) => {
  try {
    const { userIdOrEmail } = req.params;
    if (!userIdOrEmail) {
      return res.status(400).json({ success: false, message: 'User identifier is required' });
    }

    const identifier = userIdOrEmail.trim();
    const isEmail = identifier.includes('@');

    const query = {
      status: 'active',
      ...(isEmail
        ? { userEmail: identifier.toLowerCase() }
        : {
            $or: [
              { userId: identifier },
              ...(identifier.length === 24 ? [{ user: identifier }] : [])
            ]
          })
    };

    const engagements = await EventEngagement.find(query).sort({ updatedAt: -1 }).lean();

    // Hydrate each engagement with live Event data from MongoDB so cards always have full database details
    const slugSet = new Set();
    const objectIdList = [];
    engagements.forEach((e) => {
      if (e.eventSlug) slugSet.add(String(e.eventSlug).toLowerCase().trim());
      if (e.eventId) {
        const idStr = String(e.eventId).trim();
        slugSet.add(idStr.toLowerCase());
        if (mongoose.isValidObjectId(idStr)) {
          objectIdList.push(new mongoose.Types.ObjectId(idStr));
        }
      }
    });

    const eventLookupMap = new Map();
    if (slugSet.size > 0 || objectIdList.length > 0) {
      const slugArr = Array.from(slugSet);
      const matchedEvents = await Event.find({
        $or: [
          { slug: { $in: slugArr } },
          { wpPostId: { $in: slugArr } },
          ...(objectIdList.length > 0 ? [{ _id: { $in: objectIdList } }] : [])
        ]
      })
        .populate('organizer', 'name email logo website')
        .lean();

      matchedEvents.forEach((ev) => {
        if (ev.slug) eventLookupMap.set(String(ev.slug).toLowerCase().trim(), ev);
        if (ev._id) eventLookupMap.set(String(ev._id).toLowerCase().trim(), ev);
        if (ev.wpPostId) eventLookupMap.set(String(ev.wpPostId).toLowerCase().trim(), ev);
      });
    }

    const enrichedEngagements = engagements.map((e) => {
      const slugKey = String(e.eventSlug || '').toLowerCase().trim();
      const idKey = String(e.eventId || '').toLowerCase().trim();
      const dbEvt = eventLookupMap.get(slugKey) || eventLookupMap.get(idKey) || null;

      if (!dbEvt) return e;

      const populatedOrgName =
        dbEvt.organizer && typeof dbEvt.organizer === 'object' ? dbEvt.organizer.name : '';
      const rawOrgName = (dbEvt.orgName || e.organizerName || '').trim();
      const isBadOrg =
        /^[0-9a-fA-F]{24}$/.test(rawOrgName) ||
        /\b(onrender\.com|vercel\.app|localhost|http:\/\/|https:\/\/)\b/i.test(rawOrgName);
      const cleanOrganizer =
        populatedOrgName || (!isBadOrg && rawOrgName ? rawOrgName : '') || 'VisitExpo Verified Organizer';

      const formattedDates = dbEvt.startDate
        ? `${new Date(dbEvt.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${
            dbEvt.endDate
              ? ` – ${new Date(dbEvt.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              : ''
          }`
        : e.eventDates || '';

      const category =
        (Array.isArray(dbEvt.categories) && dbEvt.categories[0]) ||
        e.eventCategory ||
        'Trade & Industry';

      return {
        ...e,
        eventId: String(dbEvt._id || e.eventId || ''),
        eventSlug: dbEvt.slug || e.eventSlug,
        slug: dbEvt.slug || e.eventSlug,
        eventTitle: dbEvt.title || e.eventTitle,
        title: dbEvt.title || e.eventTitle,
        description: dbEvt.description || '',
        startDate: dbEvt.startDate || null,
        endDate: dbEvt.endDate || null,
        timings: dbEvt.timings || '',
        dates: formattedDates,
        eventDates: formattedDates,
        venue: dbEvt.venue || e.eventVenue || '',
        eventVenue: dbEvt.venue || e.eventVenue || '',
        city: dbEvt.city || e.eventCity || '',
        eventCity: dbEvt.city || e.eventCity || '',
        country: dbEvt.country || e.eventCountry || 'India',
        eventCountry: dbEvt.country || e.eventCountry || 'India',
        category,
        eventCategory: category,
        categories: dbEvt.categories || [category],
        image: dbEvt.banner || e.eventImage || '',
        eventImage: dbEvt.banner || e.eventImage || '',
        banner: dbEvt.banner || e.eventImage || '',
        organizer: cleanOrganizer,
        organizerName: cleanOrganizer,
        eventStatus: dbEvt.status || 'published',
        isFreeEvent: dbEvt.isFreeEvent,
        paidTicketPrice: dbEvt.paidTicketPrice
      };
    });

    const interestedEvents = enrichedEngagements.filter(
      (e) => e.isInterested || e.type === 'interested' || e.type === 'both'
    );
    const followedEvents = enrichedEngagements.filter(
      (e) => e.isFollowed || e.type === 'follower' || e.type === 'both'
    );
    const bookmarkedEvents = enrichedEngagements.filter(
      (e) => e.isBookmarked || e.type === 'bookmark'
    );

    return res.status(200).json({
      success: true,
      data: {
        total: enrichedEngagements.length,
        all: enrichedEngagements,
        bookmarkedEvents,
        interestedEvents,
        followedEvents,
        counts: {
          total: enrichedEngagements.length,
          bookmarks: bookmarkedEvents.length,
          interested: interestedEvents.length,
          followers: followedEvents.length
        }
      }
    });
  } catch (error) {
    console.error('Error in getUserEngagements:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc Get all user engagements for events belonging to an organizer
 * @route GET /api/engagements/organizer/:orgIdOrUserId
 */
export const getOrganizerEngagements = async (req, res) => {
  try {
    const { orgIdOrUserId } = req.params;
    if (!orgIdOrUserId) {
      return res.status(400).json({ success: false, message: 'Organizer identifier is required' });
    }

    const identifier = orgIdOrUserId.trim();

    // Also look up organizer's events from MongoDB if any
    const organizerEvents = await Event.find({
      $or: [
        { organizer: identifier.length === 24 ? identifier : null },
        { claimedBy: identifier.length === 24 ? identifier : null }
      ]
    }).select('slug');

    const eventSlugs = organizerEvents.map((e) => e.slug).filter(Boolean);

    const query = {
      status: 'active',
      $or: [
        { organizerId: identifier },
        ...(eventSlugs.length > 0 ? [{ eventSlug: { $in: eventSlugs } }] : [])
      ]
    };

    const attendees = await EventEngagement.find(query).sort({ createdAt: -1 });

    const interestedCount = attendees.filter(
      (a) => a.type === 'interested' || a.type === 'both'
    ).length;
    const followersCount = attendees.filter(
      (a) => a.type === 'follower' || a.type === 'both'
    ).length;

    return res.status(200).json({
      success: true,
      data: {
        total: attendees.length,
        attendees,
        counts: {
          total: attendees.length,
          interested: interestedCount,
          followers: followersCount
        }
      }
    });
  } catch (error) {
    console.error('Error in getOrganizerEngagements:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc Get all engagements platform-wide for Super Admin console
 * @route GET /api/engagements/all
 */
export const getAllEngagements = async (req, res) => {
  try {
    const {
      slug,
      type, // 'interested' | 'follower' | 'all'
      status = 'active',
      search,
      page = 1,
      limit = 50
    } = req.query;

    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (slug) {
      query.eventSlug = slug.toLowerCase().trim();
    }

    if (type && type !== 'all') {
      if (type === 'interested') {
        query.type = { $in: ['interested', 'both'] };
      } else if (type === 'follower' || type === 'followers') {
        query.type = { $in: ['follower', 'both'] };
      }
    }

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { userName: regex },
        { userEmail: regex },
        { userCompany: regex },
        { eventTitle: regex },
        { eventSlug: regex },
        { eventCity: regex }
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    const [engagements, total, totalInterested, totalFollowers, distinctEvents, totalBuyers] = await Promise.all([
      EventEngagement.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      EventEngagement.countDocuments(query),
      EventEngagement.countDocuments({ status: 'active', type: { $in: ['interested', 'both'] } }),
      EventEngagement.countDocuments({ status: 'active', type: { $in: ['follower', 'both'] } }),
      EventEngagement.distinct('eventSlug', { status: 'active' }),
      EventEngagement.countDocuments({
        status: 'active',
        $or: [
          { userRole: { $in: ['visitor', 'buyer'] } },
          { userDesignation: { $regex: /procurement|buyer|sourcing|director|manager|executive|officer|delegate/i } },
          { type: { $in: ['interested', 'both'] } }
        ]
      })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
        engagements,
        kpis: {
          totalActive: total,
          totalInterested,
          totalFollowers,
          totalBuyers,
          totalEvents: distinctEvents.length
        }
      }
    });
  } catch (error) {
    console.error('Error in getAllEngagements:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * @desc Delete attendee engagement record and optionally cascade delete user & all platform data
 * @route DELETE /api/engagements/:id
 */
export const deleteEngagement = async (req, res) => {
  try {
    const engagementId = req.params.id;
    const shouldDeleteUser = req.query.deleteUser === 'true' || req.body?.deleteUser === true;
    const callerId = req.user?.id || req.user?._id || null;

    if (!engagementId) {
      return res.status(400).json({ success: false, message: 'Attendee / Engagement ID is required' });
    }

    // 1. Find engagement record
    let engagement = null;
    if (mongoose.isValidObjectId(engagementId)) {
      engagement = await EventEngagement.findById(engagementId);
    }
    if (!engagement) {
      engagement = await EventEngagement.findOne({
        $or: [
          { _id: mongoose.isValidObjectId(engagementId) ? engagementId : null },
          { userEmail: engagementId.toLowerCase() }
        ]
      });
    }

    if (!engagement) {
      return res.status(404).json({ success: false, message: 'Attendee engagement record not found' });
    }

    const userEmail = (engagement.userEmail || '').toLowerCase().trim();
    const eventSlug = engagement.eventSlug;
    const targetUserId = engagement.user || engagement.userId;

    let userCascadeResult = null;

    if (shouldDeleteUser) {
      // Admin requested to delete this attendee AND their user account with all platform data
      const idOrEmail = targetUserId || userEmail;
      userCascadeResult = await deleteUserAndAllPlatformData(idOrEmail, callerId);
    } else {
      // Only delete this engagement record and any matching visitor registration for this event
      await EventEngagement.findByIdAndDelete(engagement._id);

      // Clean up matching visitor registration for this event if exists
      if (userEmail && eventSlug) {
        const ev = await Event.findOne({ slug: eventSlug }).select('_id');
        if (ev) {
          await Visitor.deleteMany({ email: userEmail, event: ev._id });
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: shouldDeleteUser
        ? `Attendee and user account "${userEmail}" along with all platform data have been permanently deleted.`
        : `Attendee "${engagement.userName}" (${userEmail}) removed successfully.`,
      deletedId: engagementId,
      userDeleted: shouldDeleteUser,
      stats: userCascadeResult?.stats || null
    });
  } catch (error) {
    console.error('Error in deleteEngagement:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, error: error.message, message: error.message });
  }
};
