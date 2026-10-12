/**
 * @file oneSignalService.js
 * @description OneSignal Web Push SDK integration for VisitExpo organizers.
 * Strictly enforces that Web Push notifications are dispatched ONLY to organizers on the Enterprise plan.
 */

import https from 'https';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import Event from '../models/Event.js';
import Notification from '../models/Notification.js';

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '';
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY || '';

/**
 * Validates whether an organizer has active access to Web Push notifications via the Growth Plan.
 * Push notifications are exclusively a feature of the Growth Plan add-on (which can be taken by Starter or Enterprise organizers).
 * @param {Object|String} userOrId - User document, request user object, or User ObjectId
 * @returns {Promise<Boolean>}
 */
export const hasGrowthPushAccess = async (userOrId) => {
  if (!userOrId) return false;

  let user = userOrId;
  const userId = userOrId._id || userOrId.id;

  try {
    if ((!user.plan || !user.role) && userId) {
      user = await User.findById(userId);
    } else if (typeof userOrId === 'string') {
      user = await User.findById(userOrId);
    }

    if (!user) return false;

    const role = String(user.role || '').toLowerCase().trim();
    if (role !== 'organizer') return false;

    // 1. Direct hasGrowthPlan flag or user.plan === 'growth'
    if (user.hasGrowthPlan === true || String(user.plan).toLowerCase().trim() === 'growth') {
      return true;
    }

    // 2. Active Subscription record with plan: 'growth'
    if (user._id || user.id) {
      const growthSub = await Subscription.findOne({
        $or: [
          { user: user._id || user.id },
          ...(user.organization ? [{ organization: user.organization }] : [])
        ],
        plan: 'growth',
        status: 'active'
      }).sort({ createdAt: -1 });

      if (growthSub) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.warn('[OneSignal] Error checking Growth plan push access:', err.message);
    return Boolean(user?.hasGrowthPlan || String(user?.plan).toLowerCase().trim() === 'growth');
  }
};

export const isEnterpriseOrganizer = hasGrowthPushAccess;

/**
 * Resolves the organizer User model associated with an Event.
 * @param {Object|String} eventOrId - Event document or Event ObjectId
 * @returns {Promise<Object|null>}
 */
export const resolveEventOrganizer = async (eventOrId) => {
  try {
    if (!eventOrId) return null;

    let event = eventOrId;
    if (typeof eventOrId === 'string' || !event.title) {
      event = await Event.findById(eventOrId);
    }
    if (!event) return null;

    // 1. Direct claimedBy user reference
    if (event.claimedBy) {
      const user = await User.findById(event.claimedBy);
      if (user) return user;
    }

    // 2. Direct organizer field (can be User or Organization)
    if (event.organizer) {
      // Check if organizer field points directly to a User
      const directUser = await User.findById(event.organizer);
      if (directUser) return directUser;

      // If it's an Organization, find the organizer user for that organization
      const orgUser = await User.findOne({ organization: event.organizer, role: 'organizer' });
      if (orgUser) return orgUser;
    }

    // 3. Fallback to organizer contact email (orgEmail)
    const orgEmail = (event.orgEmail || event.organizerEmail || '').toLowerCase().trim();
    if (orgEmail) {
      const userByEmail = await User.findOne({ email: orgEmail, role: 'organizer' });
      if (userByEmail) return userByEmail;
      const anyUserByEmail = await User.findOne({ email: orgEmail });
      if (anyUserByEmail) return anyUserByEmail;
    }

    return null;
  } catch (error) {
    console.error('[OneSignal] Error resolving event organizer:', error.message);
    return null;
  }
};

/**
 * Dispatches a push notification via the OneSignal REST API v2
 * @param {Object} options
 * @param {String} options.externalId - User's external ID (User _id)
 * @param {String} options.title - Notification heading
 * @param {String} options.message - Notification body
 * @param {String} options.url - Click destination URL
 * @param {Object} options.data - Custom payload data
 * @returns {Promise<Object>}
 */
export const sendOneSignalPush = ({ externalId, title, message, url, data = {} }) => {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      target_channel: 'push',
      include_aliases: {
        external_id: [String(externalId)]
      },
      include_external_user_ids: [String(externalId)],
      headings: {
        en: title
      },
      contents: {
        en: message
      },
      data,
      url: url || 'https://client.visitexpo.in/dashboard'
    });

    const requestOptions = {
      hostname: 'api.onesignal.com',
      path: '/api/v1/notifications',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Key ${ONESIGNAL_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(requestOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, statusCode: res.statusCode, data: parsed });
          } else {
            console.warn('[OneSignal] Push response non-200:', res.statusCode, parsed);
            resolve({ success: false, statusCode: res.statusCode, error: parsed });
          }
        } catch (e) {
          resolve({ success: false, statusCode: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[OneSignal] Push notification request error:', err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(payload);
    req.end();
  });
};

/**
 * Core notification dispatcher for an Event Organizer.
 * Validates Enterprise plan eligibility, dispatches push notification, and stores in database.
 * @param {Object} params
 * @param {Object|String} params.event - Event document or ID
 * @param {String} params.title - Notification title
 * @param {String} params.message - Notification message body
 * @param {String} params.type - 'visitor' | 'lead' | 'follower' | 'interested' | 'test'
 * @param {String} params.url - URL to open when clicked
 * @param {Object} params.metadata - Extra details
 * @returns {Promise<Object>}
 */
export const notifyOrganizer = async ({ event, title, message, type, url, metadata = {} }) => {
  try {
    let eventDoc = event;
    if (event && (typeof event === 'string' || !event.title)) {
      eventDoc = await Event.findById(event);
    }

    const organizerUser = await resolveEventOrganizer(eventDoc);
    if (!organizerUser) {
      console.log(`[OneSignal] Skipped: No organizer found for event "${eventDoc?.title || event}".`);
      return { success: false, skipped: true, reason: 'no_organizer_found' };
    }

    // STRICT GROWTH PLAN CHECK: Push notification is only for organizers with the Growth plan
    const hasGrowth = await hasGrowthPushAccess(organizerUser);
    if (!hasGrowth) {
      console.log(
        `[OneSignal] Skipped push notification: Organizer "${organizerUser.email}" is on "${organizerUser.plan || 'free'}" plan without Growth Plan add-on. Web Push is reserved exclusively for the Growth plan.`
      );
      return {
        success: false,
        skipped: true,
        reason: 'growth_plan_required',
        currentPlan: organizerUser.plan || 'free'
      };
    }

    const clientUrl = process.env.CLIENT_URL || 'https://client.visitexpo.in';
    const targetUrl = url || `${clientUrl}/dashboard`;

    // 1. Dispatch push notification via OneSignal
    const pushResult = await sendOneSignalPush({
      externalId: organizerUser._id,
      title,
      message,
      url: targetUrl,
      data: {
        type,
        eventId: eventDoc?._id ? String(eventDoc._id) : '',
        eventSlug: eventDoc?.slug || '',
        eventTitle: eventDoc?.title || '',
        timestamp: new Date().toISOString(),
        ...metadata
      }
    });

    // 2. Persist notification in database for organizer dashboard history
    await Notification.create({
      user: organizerUser._id,
      title,
      message,
      type: 'push',
      metadata: {
        eventType: type,
        eventId: eventDoc?._id,
        eventTitle: eventDoc?.title,
        eventSlug: eventDoc?.slug,
        url: targetUrl,
        oneSignalResult: pushResult,
        ...metadata
      }
    });

    return {
      success: true,
      organizerId: organizerUser._id,
      organizerEmail: organizerUser.email,
      pushResult
    };
  } catch (error) {
    console.error('[OneSignal] notifyOrganizer error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Trigger: Visitor registered, checked in, or joined virtually
 */
export const notifyOrganizerOnVisitor = async ({ event, visitor, type = 'registered' }) => {
  let title = 'New Visitor Registered';
  let message = `${visitor.name || 'A visitor'}${visitor.company ? ` from ${visitor.company}` : ''} just registered for "${event?.title || 'your expo'}".`;

  if (type === 'checked_in') {
    title = 'Visitor Checked In';
    message = `${visitor.name || 'A visitor'}${visitor.company ? ` (${visitor.company})` : ''} just checked in at "${event?.title || 'your expo'}".`;
  } else if (type === 'virtual') {
    title = 'Virtual Visitor Joined';
    message = `${visitor.name || 'A visitor'}${visitor.company ? ` (${visitor.company})` : ''} just entered the virtual expo for "${event?.title || 'your expo'}".`;
  }

  const clientUrl = process.env.CLIENT_URL || 'https://client.visitexpo.in';
  return await notifyOrganizer({
    event,
    title,
    message,
    type: 'visitor',
    url: `${clientUrl}/visitors${event?._id ? `?eventId=${event._id}` : ''}`,
    metadata: {
      visitorId: visitor._id,
      visitorName: visitor.name,
      visitorEmail: visitor.email,
      visitorCompany: visitor.company,
      attendanceType: visitor.attendanceType,
      subType: type
    }
  });
};

/**
 * Trigger: Lead generated or captured
 */
export const notifyOrganizerOnLead = async ({ event, lead, source, note }) => {
  const leadName = lead.name || 'A prospective delegate';
  const leadCompany = lead.company ? ` from ${lead.company}` : '';
  const scoreBadge = lead.leadScore ? ` (Score: ${lead.leadScore})` : '';

  const title = 'New High-Intent Lead Captured';
  const message = `${leadName}${leadCompany} registered as a new lead for "${event?.title || 'your expo'}"${scoreBadge}.`;

  const clientUrl = process.env.CLIENT_URL || 'https://client.visitexpo.in';
  return await notifyOrganizer({
    event,
    title,
    message,
    type: 'lead',
    url: `${clientUrl}/leads${event?._id ? `?eventId=${event._id}` : ''}`,
    metadata: {
      leadId: lead._id,
      leadName: lead.name,
      leadEmail: lead.email,
      leadCompany: lead.company,
      leadScore: lead.leadScore,
      source: source || lead.source,
      note
    }
  });
};

/**
 * Trigger: User followed an event
 */
export const notifyOrganizerOnFollow = async ({ event, userName, userEmail, userCompany }) => {
  const displayName = userName || userEmail?.split('@')[0] || 'A trade user';
  const companyStr = userCompany ? ` (${userCompany})` : '';

  const title = 'New Event Follower';
  const message = `${displayName}${companyStr} is now following "${event?.title || 'your expo'}".`;

  const clientUrl = process.env.CLIENT_URL || 'https://client.visitexpo.in';
  return await notifyOrganizer({
    event,
    title,
    message,
    type: 'follower',
    url: `${clientUrl}/visitors${event?._id ? `?eventId=${event._id}` : ''}`,
    metadata: {
      userName,
      userEmail,
      userCompany
    }
  });
};

/**
 * Trigger: User shown interest in an event
 */
export const notifyOrganizerOnInterest = async ({ event, userName, userEmail, userCompany }) => {
  const displayName = userName || userEmail?.split('@')[0] || 'A trade visitor';
  const companyStr = userCompany ? ` (${userCompany})` : '';

  const title = 'New Event Interest Registered';
  const message = `${displayName}${companyStr} showed interest in attending "${event?.title || 'your expo'}".`;

  const clientUrl = process.env.CLIENT_URL || 'https://client.visitexpo.in';
  return await notifyOrganizer({
    event,
    title,
    message,
    type: 'interested',
    url: `${clientUrl}/leads${event?._id ? `?eventId=${event._id}` : ''}`,
    metadata: {
      userName,
      userEmail,
      userCompany
    }
  });
};

export default {
  isEnterpriseOrganizer,
  resolveEventOrganizer,
  sendOneSignalPush,
  notifyOrganizer,
  notifyOrganizerOnVisitor,
  notifyOrganizerOnLead,
  notifyOrganizerOnFollow,
  notifyOrganizerOnInterest
};
