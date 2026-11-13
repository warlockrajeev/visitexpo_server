/**
 * @file followNotificationService.js
 * @description Broadcasts persistent in-app & desktop push notifications to followers whenever a followed user or followed event creates an event or performs activity.
 */

import mongoose from 'mongoose';
import Follow from '../models/Follow.js';
import EventEngagement from '../models/EventEngagement.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { sendOneSignalPush } from './oneSignalService.js';

/**
 * Resolves all unique follower User IDs for an actor (followed user) and/or an event (followed event),
 * persists Notification records for each follower, and dispatches OneSignal Web Push alerts.
 */
export async function notifyFollowersOnActivity({
  actorUserId = null,
  actorEmail = '',
  actorName = 'Someone you follow',
  eventSlug = '',
  eventId = null,
  eventTitle = '',
  activityType = 'activity',
  title = 'New Activity Update',
  message = '',
  url = '/dashboard',
  metadata = {}
}) {
  try {
    const cleanActorEmail = String(actorEmail || '').trim().toLowerCase();
    const cleanActorId = actorUserId && mongoose.isValidObjectId(actorUserId) ? String(actorUserId) : '';
    const cleanSlug = String(eventSlug || '').trim().toLowerCase();
    const cleanEventId = eventId && mongoose.isValidObjectId(eventId) ? String(eventId) : '';

    const recipientUserIds = new Set();
    const lookupEmails = new Set();

    // 1. Gather followers of the Actor User
    const userFollowOr = [];
    if (cleanActorId) {
      userFollowOr.push({ targetUser: new mongoose.Types.ObjectId(cleanActorId) });
    }
    if (cleanActorEmail) {
      userFollowOr.push({ targetEmail: cleanActorEmail });
    }

    if (userFollowOr.length > 0) {
      const userFollowers = await Follow.find({
        targetType: 'user',
        status: 'active',
        $or: userFollowOr
      })
        .select('followerUser followerEmail')
        .lean();

      for (const f of userFollowers) {
        if (f.followerUser) recipientUserIds.add(String(f.followerUser));
        else if (f.followerEmail) lookupEmails.add(String(f.followerEmail).trim().toLowerCase());
      }
    }

    // 2. Gather followers of the Event (if eventSlug or eventId provided)
    const eventOr = [];
    if (cleanSlug) eventOr.push({ eventSlug: cleanSlug });
    if (cleanEventId) eventOr.push({ eventId: cleanEventId });

    if (eventOr.length > 0) {
      const eventFollowers = await EventEngagement.find({
        $and: [
          { $or: eventOr },
          { status: 'active' },
          { $or: [{ isFollowed: true }, { type: { $in: ['follower', 'both'] } }] }
        ]
      })
        .select('user userId userEmail')
        .lean();

      for (const ef of eventFollowers) {
        const uid = ef.user || (ef.userId && mongoose.isValidObjectId(ef.userId) ? ef.userId : null);
        if (uid) recipientUserIds.add(String(uid));
        else if (ef.userEmail) lookupEmails.add(String(ef.userEmail).trim().toLowerCase());
      }
    }

    // Also include actor's email followers from EventEngagement? Only explicit followers above.
    // Resolve any email-only followers to real User _ids
    if (lookupEmails.size > 0) {
      const matchedUsers = await User.find({
        email: { $in: Array.from(lookupEmails) }
      })
        .select('_id email')
        .lean();
      for (const u of matchedUsers) {
        recipientUserIds.add(String(u._id));
      }
    }

    // Never notify the actor about their own activity
    if (cleanActorId) {
      recipientUserIds.delete(cleanActorId);
    }
    if (cleanActorEmail) {
      const actorUsers = await User.find({ email: cleanActorEmail }).select('_id').lean();
      for (const au of actorUsers) {
        recipientUserIds.delete(String(au._id));
      }
    }

    if (recipientUserIds.size === 0) {
      return { notified: 0 };
    }

    const clientBase = process.env.CLIENT_URL || 'http://localhost:3000';
    const fullUrl = url.startsWith('http') ? url : `${clientBase}${url.startsWith('/') ? url : `/${url}`}`;

    const notifPayloadMeta = {
      ...metadata,
      category: 'follow_activity',
      activityType,
      actorId: cleanActorId || null,
      actorName,
      eventId: cleanEventId || null,
      eventSlug: cleanSlug || '',
      eventTitle: eventTitle || '',
      url: url.startsWith('http') ? url : url
    };

    const docsToCreate = Array.from(recipientUserIds).map((uid) => ({
      user: new mongoose.Types.ObjectId(uid),
      title,
      message,
      type: 'push',
      isRead: false,
      metadata: notifPayloadMeta
    }));

    await Notification.insertMany(docsToCreate);

    // Best-effort OneSignal background web push dispatch when keys are configured
    if (process.env.ONESIGNAL_API_KEY && process.env.ONESIGNAL_APP_ID) {
      await Promise.allSettled(
        Array.from(recipientUserIds).map((uid) =>
          sendOneSignalPush({
            externalId: uid,
            title,
            message,
            url: fullUrl,
            data: notifPayloadMeta
          })
        )
      );
    }

    return { notified: docsToCreate.length };
  } catch (err) {
    console.warn('[FollowNotificationService] Dispatch error:', err.message);
    return { notified: 0, error: err.message };
  }
}

export default { notifyFollowersOnActivity };

