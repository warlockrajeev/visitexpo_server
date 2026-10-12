/**
 * @file notificationRoutes.js
 * @description In-app and OneSignal Push notification management endpoints.
 */

import express from 'express';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { protect } from '../middlewares/auth.js';
import { hasGrowthPushAccess, sendOneSignalPush } from '../services/oneSignalService.js';

const router = express.Router();

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '8d4b76bc-4946-409f-ab83-ff904d60c12e';
const ONESIGNAL_SAFARI_WEB_ID = process.env.ONESIGNAL_SAFARI_WEB_ID || 'web.onesignal.auto.37a647a2-1bdc-46a8-a505-4f4cc6400a46';

// @desc    Get user's notifications and unread count
// @route   GET /api/notifications
router.get('/', protect, async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 15;
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount, hasGrowth] = await Promise.all([
      Notification.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments({ user: userId }),
      Notification.countDocuments({ user: userId, isRead: false }),
      hasGrowthPushAccess(req.user)
    ]);

    res.status(200).json({
      success: true,
      data: {
        notifications,
        total,
        unreadCount,
        page,
        pages: Math.ceil(total / limit),
        hasGrowthPlan: hasGrowth,
        canReceivePush: hasGrowth
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get push notification status and configuration for current user
// @route   GET /api/notifications/status
router.get('/status', protect, async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id;
    const [hasGrowth, userDoc] = await Promise.all([
      hasGrowthPushAccess(req.user),
      User.findById(userId)
    ]);

    const basePlan = (userDoc?.plan || req.user.plan || 'free').toLowerCase();
    const canTakeGrowth = basePlan === 'starter' || basePlan === 'enterprise';

    res.status(200).json({
      success: true,
      data: {
        hasGrowthPlan: hasGrowth,
        canReceivePush: hasGrowth,
        basePlan,
        canTakeGrowth,
        role: userDoc?.role || req.user.role,
        plan: userDoc?.plan || req.user.plan || 'free',
        externalId: String(userId),
        appId: ONESIGNAL_APP_ID,
        safariWebId: ONESIGNAL_SAFARI_WEB_ID
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Mark single notification as read
// @route   PATCH /api/notifications/:id/read
router.patch('/:id/read', protect, async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id;
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.status(200).json({
      success: true,
      data: notification
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Mark all notifications as read
// @route   PATCH /api/notifications/read-all
router.patch('/read-all', protect, async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id;
    await Notification.updateMany(
      { user: userId, isRead: false },
      { isRead: true }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Clear all notifications for the user
// @route   DELETE /api/notifications/clear-all
router.delete('/clear-all', protect, async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id;
    await Notification.deleteMany({ user: userId });

    res.status(200).json({
      success: true,
      message: 'All notifications cleared successfully'
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Clear all notifications for the user (alias)
// @route   DELETE /api/notifications
router.delete('/', protect, async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id;
    await Notification.deleteMany({ user: userId });

    res.status(200).json({
      success: true,
      message: 'All notifications cleared successfully'
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete single notification
// @route   DELETE /api/notifications/:id
router.delete('/:id', protect, async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id;
    await Notification.findOneAndDelete({ _id: req.params.id, user: userId });

    res.status(200).json({
      success: true,
      message: 'Notification removed successfully'
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Send test push notification to Growth plan organizer
// @route   POST /api/notifications/test-push
router.post('/test-push', protect, async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id;

    // Strictly verify Growth plan using DB resolution
    const hasGrowth = await hasGrowthPushAccess(req.user);
    if (!hasGrowth) {
      const userDoc = await User.findById(userId);
      const basePlan = (userDoc?.plan || req.user.plan || 'free').toLowerCase();
      const canTakeGrowth = basePlan === 'starter' || basePlan === 'enterprise';
      return res.status(403).json({
        success: false,
        message: canTakeGrowth
          ? 'Push notifications are powered exclusively by the Growth Plan add-on. Add the Growth Plan to your organizer account to enable instant push notifications.'
          : 'Push notifications are powered by the Growth Plan add-on (available for Starter and Enterprise organizers). Free Plan accounts must upgrade to Starter or Enterprise first.',
        requiresGrowth: true,
        canTakeGrowth,
        currentPlan: basePlan
      });
    }

    const title = 'VisitExpo Web Push Test';
    const message = 'OneSignal Web Push is working! You will receive instant alerts for visitors, leads, follows, and interested delegates.';
    const clientUrl = req.headers.origin || process.env.CLIENT_URL || 'https://client.visitexpo.in';

    const pushResult = await sendOneSignalPush({
      externalId: userId,
      title,
      message,
      url: `${clientUrl}/dashboard`,
      data: {
        type: 'test',
        timestamp: new Date().toISOString()
      }
    });

    // Create notification in DB
    const notifDoc = await Notification.create({
      user: userId,
      title,
      message,
      type: 'push',
      metadata: {
        eventType: 'test',
        url: `${clientUrl}/dashboard`,
        pushResult
      }
    });

    res.status(200).json({
      success: true,
      message: 'Test push notification dispatched successfully via OneSignal',
      notification: notifDoc,
      pushResult
    });
  } catch (error) {
    next(error);
  }
});

export default router;
