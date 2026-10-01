/**
 * @file chatRoutes.js
 * @description API Routes for Organizer Live Chat system with Visitors and Exhibitors.
 */

import express from 'express';
import {
  getChatStatus,
  getChatSettings,
  updateChatSettings,
  startOrFetchConversation,
  getOrganizerConversations,
  getConversationById,
  sendMessage,
  updateConversationStatus,
  getParticipantConversations,
  getOrganizersWithExpos
} from '../controllers/chatController.js';
import { protect, authorize } from '../middlewares/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';

const router = express.Router();

/**
 * Optional authentication middleware: if token exists, sets req.user without rejecting guest callers
 */
const optionalAuth = (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      if (decoded) {
        req.user = decoded;
      }
    } catch (_) {
      // Continue without user
    }
  }
  next();
};

// ==========================================
// PUBLIC / VISITOR & EXHIBITOR ROUTES
// ==========================================

// Check if an organizer has live chat enabled
router.get('/status', getChatStatus);

// Directory of all organizers with their expos and live chat status (for visitors and exhibitors)
router.get('/organizers-directory', optionalAuth, getOrganizersWithExpos);

// Start or resume a conversation
router.post('/conversations', optionalAuth, startOrFetchConversation);

// Get conversations for a participant (visitor / exhibitor)
router.get('/participant/conversations', optionalAuth, getParticipantConversations);

// Fetch conversation thread by ID
router.get('/conversations/:id', optionalAuth, getConversationById);

// Send message to thread
router.post('/conversations/:id/messages', optionalAuth, sendMessage);

// ==========================================
// ORGANIZER PRIVATE MANAGEMENT ROUTES
// ==========================================

// Get organizer chat settings & metrics
router.get('/settings', protect, authorize('organizer', 'super_admin', 'event_manager'), getChatSettings);

// Update chat settings (enable/disable, status, auto-reply, welcome message)
router.patch('/settings', protect, authorize('organizer', 'super_admin', 'event_manager'), updateChatSettings);

// Get all organizer conversation threads
router.get('/conversations', protect, authorize('organizer', 'super_admin', 'event_manager'), getOrganizerConversations);

// Update conversation status (active / archived / closed)
router.patch('/conversations/:id/status', protect, authorize('organizer', 'super_admin', 'event_manager'), updateConversationStatus);

export default router;
