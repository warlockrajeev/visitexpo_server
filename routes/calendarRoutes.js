/**
 * @file calendarRoutes.js
 * @description API endpoints for Calendar Sync (Google, Outlook, RFC 5545 .ics),
 * reminder settings management, and reminder scheduler triggers.
 */

import express from 'express';
import CalendarService from '../services/CalendarService.js';
import User from '../models/User.js';
import Event from '../models/Event.js';
import { protect } from '../middlewares/auth.js';

const router = express.Router();

/**
 * 1. GET /api/calendar/preferences
 * Fetch user's calendar sync and reminder settings
 */
router.get('/preferences', async (req, res, next) => {
  try {
    // If authenticated user
    if (req.headers.authorization) {
      return protect(req, res, async () => {
        const userDoc = await User.findById(req.user.id).select('calendarSettings email name');
        if (!userDoc) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }

        const settings = userDoc.calendarSettings || {
          autoSync: true,
          preferredProvider: 'google',
          googleConnected: false,
          outlookConnected: false,
          reminderTimes: ['24h', '1h', '15m'],
          channels: { email: true, push: true, sms: false },
          timezone: 'Asia/Kolkata'
        };

        return res.status(200).json({
          success: true,
          preferences: settings,
          user: {
            email: userDoc.email,
            name: userDoc.name
          }
        });
      });
    }

    // Default guest preferences
    res.status(200).json({
      success: true,
      preferences: {
        autoSync: true,
        preferredProvider: 'google',
        googleConnected: false,
        outlookConnected: false,
        reminderTimes: ['24h', '1h', '15m'],
        channels: { email: true, push: true, sms: false },
        timezone: 'Asia/Kolkata'
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 2. PUT /api/calendar/preferences
 * Update user's calendar sync and reminder settings with visible save confirmation
 */
router.put('/preferences', protect, async (req, res, next) => {
  try {
    const {
      autoSync,
      preferredProvider,
      reminderTimes,
      channels,
      timezone,
      googleConnected,
      googleEmail,
      outlookConnected,
      outlookEmail
    } = req.body;

    const userDoc = await User.findById(req.user.id);
    if (!userDoc) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (!userDoc.calendarSettings) {
      userDoc.calendarSettings = {};
    }

    if (autoSync !== undefined) userDoc.calendarSettings.autoSync = !!autoSync;
    if (preferredProvider !== undefined) userDoc.calendarSettings.preferredProvider = preferredProvider;
    if (reminderTimes !== undefined && Array.isArray(reminderTimes)) {
      userDoc.calendarSettings.reminderTimes = reminderTimes;
    }
    if (channels !== undefined) {
      userDoc.calendarSettings.channels = {
        email: channels.email !== false,
        push: channels.push !== false,
        sms: !!channels.sms
      };
    }
    if (timezone) userDoc.calendarSettings.timezone = timezone;
    if (googleConnected !== undefined) userDoc.calendarSettings.googleConnected = !!googleConnected;
    if (googleEmail !== undefined) userDoc.calendarSettings.googleEmail = googleEmail;
    if (outlookConnected !== undefined) userDoc.calendarSettings.outlookConnected = !!outlookConnected;
    if (outlookEmail !== undefined) userDoc.calendarSettings.outlookEmail = outlookEmail;

    await userDoc.save();

    res.status(200).json({
      success: true,
      message: 'Calendar sync & reminder preferences saved successfully!',
      preferences: userDoc.calendarSettings
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 3. POST /api/calendar/sync
 * Sync registered event to Google or Outlook Calendar or produce .ics
 */
router.post('/sync', async (req, res, next) => {
  try {
    const { eventId, eventSlug, provider, userEmail, userName, reminderTimes, timezone, eventData } = req.body;

    if (!eventId && !eventSlug && !eventData) {
      return res.status(400).json({
        success: false,
        error: 'Event identifier (eventId or eventSlug) is required for calendar sync.'
      });
    }

    const syncResult = await CalendarService.syncEvent({
      eventId,
      eventSlug,
      provider: provider || 'google',
      userEmail,
      userName,
      reminderTimes,
      timezone,
      eventData
    });

    res.status(200).json(syncResult);
  } catch (error) {
    // Return structured failure response so frontend can display error to user
    res.status(400).json({
      success: false,
      error: error.message || 'Calendar sync failed. Please try again or download the .ics file.'
    });
  }
});

/**
 * 4. GET /api/calendar/events/:slug/ics
 * Download standard RFC 5545 .ics calendar invite with reminder alarms
 */
router.get('/events/:slug/ics', async (req, res, next) => {
  try {
    const { slug } = req.params;
    let event = await Event.findOne({ slug });
    if (!event && slug.match(/^[0-9a-fA-F]{24}$/)) {
      event = await Event.findById(slug);
    }

    if (!event) {
      return res.status(404).send('Event not found');
    }

    const icsContent = CalendarService.generateIcsContent(event);
    const filename = `${(event.slug || 'visitexpo-event').replace(/[^a-zA-Z0-9_-]/g, '_')}.ics`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(icsContent);
  } catch (error) {
    next(error);
  }
});

/**
 * 5. POST /api/calendar/connect/:provider
 * Connect Google or Outlook Calendar account (OAuth mock / linking)
 */
router.post('/connect/:provider', protect, async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { accountEmail } = req.body;

    const userDoc = await User.findById(req.user.id);
    if (!userDoc) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (!userDoc.calendarSettings) {
      userDoc.calendarSettings = {};
    }

    const targetEmail = accountEmail || userDoc.email;

    if (provider === 'google') {
      userDoc.calendarSettings.googleConnected = true;
      userDoc.calendarSettings.googleEmail = targetEmail;
      userDoc.calendarSettings.preferredProvider = 'google';
    } else if (provider === 'outlook') {
      userDoc.calendarSettings.outlookConnected = true;
      userDoc.calendarSettings.outlookEmail = targetEmail;
      userDoc.calendarSettings.preferredProvider = 'outlook';
    } else {
      return res.status(400).json({ success: false, error: 'Unsupported calendar provider' });
    }

    await userDoc.save();

    res.status(200).json({
      success: true,
      message: `${provider === 'google' ? 'Google Calendar' : 'Outlook Calendar'} connected successfully!`,
      preferences: userDoc.calendarSettings
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 6. POST /api/calendar/disconnect/:provider
 * Disconnect a calendar provider
 */
router.post('/disconnect/:provider', protect, async (req, res, next) => {
  try {
    const { provider } = req.params;
    const userDoc = await User.findById(req.user.id);
    if (!userDoc) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (!userDoc.calendarSettings) {
      userDoc.calendarSettings = {};
    }

    if (provider === 'google') {
      userDoc.calendarSettings.googleConnected = false;
      userDoc.calendarSettings.googleEmail = '';
    } else if (provider === 'outlook') {
      userDoc.calendarSettings.outlookConnected = false;
      userDoc.calendarSettings.outlookEmail = '';
    }

    await userDoc.save();

    res.status(200).json({
      success: true,
      message: `${provider === 'google' ? 'Google Calendar' : 'Outlook Calendar'} disconnected.`,
      preferences: userDoc.calendarSettings
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 7. POST /api/calendar/send-reminders
 * Trigger upcoming event reminders dispatcher (cron or manual admin invoke)
 */
router.post('/send-reminders', async (req, res, next) => {
  try {
    const result = await CalendarService.sendUpcomingEventReminders();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
