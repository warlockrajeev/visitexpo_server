/**
 * @file activityRoutes.js
 * @description Public & authenticated client activity ingestion endpoints
 * capturing page visits, event clicks, form interactions/submissions, and engagement actions.
 */

import express from 'express';
import { isBotUserAgent, logUserActivity } from '../utils/activityLogger.js';

const router = express.Router();

// @desc    Track single or batched user activity events from the frontend
// @route   POST /api/activity/track
// @access  Public / Optional Auth
router.post('/track', async (req, res) => {
  try {
    if (isBotUserAgent(req.headers?.['user-agent'])) {
      return res.status(200).json({ success: true, tracked: 0, skippedBot: true });
    }

    const body = req.body || {};
    const items = Array.isArray(body.events) ? body.events.slice(0, 25) : [body];

    const sharedUser = body.user || null;
    const sharedSessionId = body.sessionId || '';

    const tasks = items
      .filter((item) => item && typeof item === 'object' && (item.activityType || item.actionLabel || item.pagePath))
      .map((item) =>
        logUserActivity({
          req,
          user: item.user || sharedUser,
          sessionId: item.sessionId || sharedSessionId,
          activityType: item.activityType || 'page_visit',
          category: item.category || 'navigation',
          actionLabel: item.actionLabel || `Visited ${item.pagePath || '/'}`,
          description: item.description || '',
          pagePath: item.pagePath || '',
          pageTitle: item.pageTitle || '',
          referrerPath: item.referrerPath || '',
          targetEvent: item.targetEvent || null,
          formInfo: item.formInfo || null,
          elementInfo: item.elementInfo || null,
          metadata: item.metadata || null,
          source: 'client_tracker'
        })
      );

    await Promise.allSettled(tasks);

    return res.status(200).json({
      success: true,
      tracked: tasks.length
    });
  } catch (err) {
    // Telemetry should never disrupt user flows
    return res.status(200).json({ success: false, tracked: 0 });
  }
});

export default router;
