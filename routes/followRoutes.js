/**
 * @file followRoutes.js
 * @description API routes for User-to-User & User-to-Event Follow graph, batch follower counts, and user updates.
 */

import express from 'express';
import mongoose from 'mongoose';
import Follow from '../models/Follow.js';
import EventEngagement from '../models/EventEngagement.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { protect } from '../middlewares/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';

const router = express.Router();

function optionalAuth(req, _res, next) {
  const token =
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null) ||
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
    } catch (_) {}
  }
  next();
}

async function resolveFollowerCountForTarget({ targetUserId, targetEmail }) {
  const or = [];
  if (targetUserId && mongoose.isValidObjectId(targetUserId)) {
    or.push({ targetUser: new mongoose.Types.ObjectId(targetUserId) });
  }
  const cleanEmail = String(targetEmail || '').trim().toLowerCase();
  if (cleanEmail) {
    or.push({ targetEmail: cleanEmail });
  }
  if (or.length === 0) return 0;

  return Follow.countDocuments({
    targetType: 'user',
    status: 'active',
    $or: or
  });
}

/**
 * POST /api/follows/user/toggle
 * Follow or unfollow a VisitExpo user (organizer, exhibitor, attendee).
 */
router.post('/user/toggle', protect, async (req, res) => {
  try {
    const followerId = String(req.user.id || req.user._id || '');
    if (!followerId || !mongoose.isValidObjectId(followerId)) {
      return res.status(401).json({ success: false, error: 'Invalid authenticated user.' });
    }
    const followerDoc = await User.findById(followerId).select('name email role company organization').lean();
    if (!followerDoc) {
      return res.status(401).json({ success: false, error: 'Authenticated user not found.' });
    }

    const { targetUserId, targetEmail, targetEngagementId, targetName, targetCompany, targetRole } = req.body;
    let cleanTargetEmail = String(targetEmail || '').trim().toLowerCase();
    let lookupUserId = targetUserId;

    if (!lookupUserId && !cleanTargetEmail && targetEngagementId && mongoose.isValidObjectId(targetEngagementId)) {
      const engDoc = await EventEngagement.findById(targetEngagementId)
        .select('user userId userEmail')
        .lean();
      if (engDoc) {
        lookupUserId = String(engDoc.userId || engDoc.user || '');
        if (!cleanTargetEmail && engDoc.userEmail) {
          cleanTargetEmail = String(engDoc.userEmail).trim().toLowerCase();
        }
      }
    }

    let resolvedTargetUser = null;
    if (lookupUserId && mongoose.isValidObjectId(lookupUserId)) {
      resolvedTargetUser = await User.findById(lookupUserId).select('name email role company organization').lean();
    }
    if (!resolvedTargetUser && cleanTargetEmail) {
      resolvedTargetUser = await User.findOne({ email: cleanTargetEmail })
        .select('name email role company organization')
        .lean();
    }

    const finalTargetId = resolvedTargetUser?._id ? String(resolvedTargetUser._id) : null;
    const finalTargetEmail = (resolvedTargetUser?.email || cleanTargetEmail || '').toLowerCase();
    const finalTargetName = resolvedTargetUser?.name || String(targetName || 'VisitExpo Member').trim();

    if (!finalTargetId && !finalTargetEmail) {
      return res.status(400).json({ success: false, error: 'Target user identifier or email is required.' });
    }

    if (
      (finalTargetId && finalTargetId === followerId) ||
      (finalTargetEmail && finalTargetEmail === String(followerDoc.email || '').toLowerCase())
    ) {
      return res.status(400).json({ success: false, error: 'You cannot follow yourself.' });
    }

    const targetMatchOr = [];
    if (finalTargetId) targetMatchOr.push({ targetUser: new mongoose.Types.ObjectId(finalTargetId) });
    if (finalTargetEmail) targetMatchOr.push({ targetEmail: finalTargetEmail });

    let followDoc = await Follow.findOne({
      followerUser: new mongoose.Types.ObjectId(followerId),
      targetType: 'user',
      $or: targetMatchOr
    });

    let isFollowing = false;
    if (followDoc) {
      followDoc.status = followDoc.status === 'active' ? 'inactive' : 'active';
      followDoc.followerName = followerDoc.name || followDoc.followerName;
      followDoc.followerCompany = followerDoc.company || '';
      if (finalTargetId && !followDoc.targetUser) followDoc.targetUser = new mongoose.Types.ObjectId(finalTargetId);
      if (finalTargetEmail && !followDoc.targetEmail) followDoc.targetEmail = finalTargetEmail;
      if (finalTargetName) followDoc.targetName = finalTargetName;
      await followDoc.save();
      isFollowing = followDoc.status === 'active';
    } else {
      followDoc = await Follow.create({
        followerUser: new mongoose.Types.ObjectId(followerId),
        followerEmail: String(followerDoc.email || '').toLowerCase(),
        followerName: followerDoc.name || 'VisitExpo User',
        followerCompany: followerDoc.company || '',
        followerRole: followerDoc.role || 'visitor',
        targetType: 'user',
        targetUser: finalTargetId ? new mongoose.Types.ObjectId(finalTargetId) : null,
        targetEmail: finalTargetEmail,
        targetName: finalTargetName,
        targetCompany: String(targetCompany || resolvedTargetUser?.company || '').trim(),
        targetRole: String(targetRole || resolvedTargetUser?.role || '').trim(),
        status: 'active'
      });
      isFollowing = true;
    }

    const followerCount = await resolveFollowerCountForTarget({
      targetUserId: finalTargetId,
      targetEmail: finalTargetEmail
    });

    // Notify the followed user when someone newly follows them
    if (isFollowing && finalTargetId) {
      try {
        await Notification.create({
          user: new mongoose.Types.ObjectId(finalTargetId),
          title: `New Follower: ${followerDoc.name || followerDoc.email}`,
          message: `${followerDoc.name || 'A VisitExpo member'}${followerDoc.company ? ` (${followerDoc.company})` : ''} started following you.`,
          type: 'push',
          isRead: false,
          metadata: {
            category: 'follow_activity',
            activityType: 'new_follower',
            actorId: followerId,
            actorName: followerDoc.name,
            url: '/following'
          }
        });
      } catch (_) {}
    }

    res.status(200).json({
      success: true,
      isFollowing,
      followerCount,
      targetUserId: finalTargetId,
      targetEmail: finalTargetEmail
    });
  } catch (err) {
    console.error('Error toggling user follow:', err);
    res.status(500).json({ success: false, error: 'Failed to update follow status.' });
  }
});

/**
 * POST /api/follows/user/status-batch
 * Return follower counts & whether the current user follows each listed user target.
 */
router.post('/user/status-batch', optionalAuth, async (req, res) => {
  try {
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
    const currentUserId = req.user?.id || req.user?._id || null;
    const currentEmail = String(req.user?.email || req.body?.currentUserEmail || '').trim().toLowerCase();

    const engagementIds = targets
      .map((t) => String(t.engagementId || '').trim())
      .filter((id) => mongoose.isValidObjectId(id));

    const engUserById = new Map();
    const engEmailById = new Map();
    if (engagementIds.length > 0) {
      const engDocs = await EventEngagement.find({
        _id: { $in: engagementIds.map((id) => new mongoose.Types.ObjectId(id)) }
      })
        .select('_id user userId userEmail')
        .lean();
      for (const ed of engDocs) {
        const eid = String(ed._id);
        const uidVal = String(ed.userId || ed.user || '').trim();
        const emlVal = String(ed.userEmail || '').trim().toLowerCase();
        if (uidVal) engUserById.set(eid, uidVal);
        if (emlVal) engEmailById.set(eid, emlVal);
      }
    }

    const enrichedTargets = targets.map((t) => {
      const eid = String(t.engagementId || '').trim();
      return {
        ...t,
        resolvedUid: String(t.userId || engUserById.get(eid) || '').trim(),
        resolvedEml: String(t.email || engEmailById.get(eid) || '').trim().toLowerCase()
      };
    });

    const userIds = Array.from(
      new Set(enrichedTargets.map((t) => t.resolvedUid).filter((id) => mongoose.isValidObjectId(id)))
    );
    const emails = Array.from(
      new Set(enrichedTargets.map((t) => t.resolvedEml).filter(Boolean))
    );

    if (userIds.length === 0 && emails.length === 0) {
      return res.status(200).json({ success: true, countsByKey: {}, followedKeys: [] });
    }

    const orFilters = [];
    if (userIds.length > 0) {
      orFilters.push({ targetUser: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } });
    }
    if (emails.length > 0) {
      orFilters.push({ targetEmail: { $in: emails } });
    }

    const activeFollows = await Follow.find({
      targetType: 'user',
      status: 'active',
      $or: orFilters
    })
      .select('followerUser followerEmail targetUser targetEmail')
      .lean();

    const countsByKey = {};
    const followedKeysSet = new Set();

    for (const target of enrichedTargets) {
      const uid = target.resolvedUid;
      const eml = target.resolvedEml;
      const key = String(target.key || uid || eml);
      if (!key) continue;

      const matching = activeFollows.filter(
        (f) => (uid && String(f.targetUser || '') === uid) || (eml && String(f.targetEmail || '').toLowerCase() === eml)
      );
      countsByKey[key] = matching.length;

      if (currentUserId || currentEmail) {
        const isMeFollowing = matching.some(
          (f) =>
            (currentUserId && String(f.followerUser || '') === String(currentUserId)) ||
            (currentEmail && String(f.followerEmail || '').toLowerCase() === currentEmail)
        );
        if (isMeFollowing) followedKeysSet.add(key);
      }
    }

    res.status(200).json({
      success: true,
      countsByKey,
      followedKeys: Array.from(followedKeysSet)
    });
  } catch (err) {
    console.error('Error loading batch follow statuses:', err);
    res.status(500).json({ success: false, error: 'Failed to load follow counts.' });
  }
});

/**
 * GET /api/follows/my
 * Returns followed users, followed events, users following me, and recent activity feed updates.
 */
router.get('/my', protect, async (req, res) => {
  try {
    const userId = String(req.user.id || req.user._id);
    const userEmail = String(req.user.email || '').trim().toLowerCase();

    const myUserOr = [{ followerUser: new mongoose.Types.ObjectId(userId) }];
    if (userEmail) myUserOr.push({ followerEmail: userEmail });

    const myTargetOr = [{ targetUser: new mongoose.Types.ObjectId(userId) }];
    if (userEmail) myTargetOr.push({ targetEmail: userEmail });

    const [rawFollowedUsers, rawMyFollowers, followedEvents, rawActivityUpdates] = await Promise.all([
      Follow.find({ targetType: 'user', status: 'active', $or: myUserOr })
        .sort({ createdAt: -1 })
        .lean(),
      Follow.find({ targetType: 'user', status: 'active', $or: myTargetOr })
        .sort({ createdAt: -1 })
        .lean(),
      EventEngagement.find({
        status: 'active',
        $or: [{ isFollowed: true }, { type: { $in: ['follower', 'both'] } }],
        $and: [
          {
            $or: [
              { user: new mongoose.Types.ObjectId(userId) },
              { userId },
              ...(userEmail ? [{ userEmail }] : [])
            ]
          }
        ]
      })
        .sort({ createdAt: -1 })
        .lean(),
      Notification.find({
        user: new mongoose.Types.ObjectId(userId),
        'metadata.category': 'follow_activity'
      })
        .sort({ createdAt: -1 })
        .limit(30)
        .lean()
    ]);

    const followedUsers = await Promise.all(
      rawFollowedUsers.map(async (f) => {
        const followerCount = await resolveFollowerCountForTarget({
          targetUserId: f.targetUser ? String(f.targetUser) : null,
          targetEmail: f.targetEmail
        });
        return {
          id: String(f._id),
          userId: f.targetUser ? String(f.targetUser) : null,
          email: f.targetEmail || '',
          name: f.targetName || 'VisitExpo Member',
          company: f.targetCompany || '',
          role: f.targetRole || 'member',
          followerCount,
          followedAt: f.createdAt
        };
      })
    );

    const myFollowers = rawMyFollowers.map((f) => ({
      id: String(f._id),
      userId: f.followerUser ? String(f.followerUser) : null,
      email: f.followerEmail || '',
      name: f.followerName || 'VisitExpo Member',
      company: f.followerCompany || '',
      role: f.followerRole || 'member',
      followedAt: f.createdAt
    }));

    const activityUpdates = rawActivityUpdates.map((n) => ({
      id: String(n._id),
      title: n.title,
      message: n.message,
      url: n.metadata?.url || '',
      actorName: n.metadata?.actorName || '',
      eventTitle: n.metadata?.eventTitle || '',
      activityType: n.metadata?.activityType || '',
      isRead: Boolean(n.isRead),
      createdAt: n.createdAt
    }));

    res.status(200).json({
      success: true,
      data: {
        followedUsers,
        myFollowers,
        followedEvents,
        activityUpdates,
        stats: {
          followingUsers: followedUsers.length,
          followingEvents: followedEvents.length,
          followersCount: myFollowers.length
        }
      }
    });
  } catch (err) {
    console.error('Error loading user follow overview:', err);
    res.status(500).json({ success: false, error: 'Failed to load follow overview.' });
  }
});

export default router;
