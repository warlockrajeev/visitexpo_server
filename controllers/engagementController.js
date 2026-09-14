/**
 * @file engagementController.js
 * @description Controller methods for Event Interest & Follower engagement system.
 */

import EventEngagement from '../models/EventEngagement.js';
import User from '../models/User.js';
import Event from '../models/Event.js';

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
    const action = actionType === 'follower' ? 'follower' : 'interested';

    // Resolve user details from auth middleware or payload
    const currentUser = req.user || customUser;
    if (!currentUser || (!currentUser.email && !currentUser.id && !currentUser._id)) {
      return res.status(401).json({
        success: false,
        message: 'Authentication or user email is required to register interest or follow'
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
    const userDesignation = currentUser.designation || (userRole === 'visitor' ? 'Trade Visitor' : 'Exhibitor Rep');
    const userAvatar =
      currentUser.avatar ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=FF2E63&color=fff`;

    // Find existing engagement
    let engagement = await EventEngagement.findOne({
      userEmail,
      eventSlug: cleanSlug
    });

    if (engagement) {
      // Toggle logic
      const isCurrentlyActive = engagement.status === 'active';
      const currentType = engagement.type;

      if (action === 'interested') {
        const currentlyInterested = isCurrentlyActive && (currentType === 'interested' || currentType === 'both');

        if (currentlyInterested) {
          // Remove interested
          if (currentType === 'both') {
            engagement.type = 'follower';
            engagement.status = 'active';
          } else {
            engagement.status = 'inactive';
          }
        } else {
          // Add interested
          if (isCurrentlyActive && currentType === 'follower') {
            engagement.type = 'both';
          } else {
            engagement.type = 'interested';
            engagement.status = 'active';
          }
        }
      } else if (action === 'follower') {
        const currentlyFollowing = isCurrentlyActive && (currentType === 'follower' || currentType === 'both');

        if (currentlyFollowing) {
          // Unfollow
          if (currentType === 'both') {
            engagement.type = 'interested';
            engagement.status = 'active';
          } else {
            engagement.status = 'inactive';
          }
        } else {
          // Follow
          if (isCurrentlyActive && currentType === 'interested') {
            engagement.type = 'both';
          } else {
            engagement.type = 'follower';
            engagement.status = 'active';
          }
        }
      }

      // Update metadata
      if (eventTitle && !engagement.eventTitle) engagement.eventTitle = eventTitle;
      if (eventCity && !engagement.eventCity) engagement.eventCity = eventCity;
      if (eventVenue && !engagement.eventVenue) engagement.eventVenue = eventVenue;
      if (eventDates && !engagement.eventDates) engagement.eventDates = eventDates;
      if (eventImage && !engagement.eventImage) engagement.eventImage = eventImage;
      if (organizerId && !engagement.organizerId) engagement.organizerId = organizerId;
      if (organizerName && !engagement.organizerName) engagement.organizerName = organizerName;
      if (userName) engagement.userName = userName;
      if (userCompany) engagement.userCompany = userCompany;
      if (userDesignation) engagement.userDesignation = userDesignation;

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
        userRole,
        eventSlug: cleanSlug,
        eventId: eventId || '',
        eventTitle: eventTitle || cleanSlug.replace(/-/g, ' ').toUpperCase(),
        eventCity: eventCity || 'India',
        eventCountry: eventCountry || 'India',
        eventVenue: eventVenue || 'Main Expo Center',
        eventDates: eventDates || '2026 Edition',
        eventCategory: eventCategory || 'Trade Show',
        eventImage: eventImage || '',
        organizerId: organizerId || '',
        organizerName: organizerName || '',
        type: action,
        status: 'active',
        passType: userRole === 'visitor' ? 'Complimentary Visitor Pass' : 'Exhibitor Delegate',
        objective: 'Evaluating suppliers, B2B procurement, and business networking.'
      });
    }

    const isInterested = engagement.status === 'active' && (engagement.type === 'interested' || engagement.type === 'both');
    const isFollower = engagement.status === 'active' && (engagement.type === 'follower' || engagement.type === 'both');

    // Aggregate live counts for this event
    const [interestedCount, followersCount] = await Promise.all([
      EventEngagement.countDocuments({
        eventSlug: cleanSlug,
        status: 'active',
        type: { $in: ['interested', 'both'] }
      }),
      EventEngagement.countDocuments({
        eventSlug: cleanSlug,
        status: 'active',
        type: { $in: ['follower', 'both'] }
      })
    ]);

    return res.status(200).json({
      success: true,
      message: `Successfully updated ${action} status for ${cleanSlug}`,
      data: {
        isInterested,
        isFollower,
        type: engagement.type,
        status: engagement.status,
        engagement,
        counts: {
          interested: interestedCount,
          followers: followersCount
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

    const [attendees, interestedCount, followersCount] = await Promise.all([
      EventEngagement.find({ eventSlug: cleanSlug, status: 'active' }).sort({ createdAt: -1 }),
      EventEngagement.countDocuments({
        eventSlug: cleanSlug,
        status: 'active',
        type: { $in: ['interested', 'both'] }
      }),
      EventEngagement.countDocuments({
        eventSlug: cleanSlug,
        status: 'active',
        type: { $in: ['follower', 'both'] }
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

    const isInterested = userEngagement
      ? userEngagement.status === 'active' &&
        (userEngagement.type === 'interested' || userEngagement.type === 'both')
      : false;

    const isFollower = userEngagement
      ? userEngagement.status === 'active' &&
        (userEngagement.type === 'follower' || userEngagement.type === 'both')
      : false;

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

    const engagements = await EventEngagement.find(query).sort({ updatedAt: -1 });

    const interestedEvents = engagements.filter(
      (e) => e.type === 'interested' || e.type === 'both'
    );
    const followedEvents = engagements.filter(
      (e) => e.type === 'follower' || e.type === 'both'
    );

    return res.status(200).json({
      success: true,
      data: {
        total: engagements.length,
        all: engagements,
        interestedEvents,
        followedEvents,
        counts: {
          total: engagements.length,
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
