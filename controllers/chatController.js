/**
 * @file chatController.js
 * @description Controller for Live Chat between Organizers and Visitors/Exhibitors.
 */

import mongoose from 'mongoose';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Event from '../models/Event.js';
import ChatConversation from '../models/ChatConversation.js';
import { getAggregatedOrganizers } from '../routes/adminRoutes.js';

/**
 * Helper to resolve an Organizer User given various identifiers (organizerId, eventId, slug, orgEmail)
 */
async function resolveOrganizerUser({ organizerId, eventId, slug, orgEmail }) {
  // 1. Direct Organizer User ID
  if (organizerId && mongoose.isValidObjectId(organizerId)) {
    const user = await User.findById(organizerId).select('name email role isVerified isChatEnabled chatStatus chatWelcomeMessage chatAutoReply organization');
    if (user && (user.role === 'organizer' || user.role === 'super_admin' || user.role === 'event_manager')) {
      return { user, source: 'user_id' };
    }

    // Maybe it's an Organization ID
    const org = await Organization.findById(organizerId);
    if (org) {
      const orgUser = await User.findOne({ organization: org._id, role: 'organizer' })
        .select('name email role isVerified isChatEnabled chatStatus chatWelcomeMessage chatAutoReply organization');
      if (orgUser) return { user: orgUser, organization: org, source: 'organization_id' };
      // Fallback: synthesized user object from organization
      return {
        user: {
          _id: org._id,
          name: org.name,
          email: org.contact?.email || '',
          role: 'organizer',
          isVerified: true,
          isChatEnabled: !!org.isChatEnabled,
          chatStatus: org.chatStatus || 'offline',
          chatWelcomeMessage: org.chatWelcomeMessage || 'Hello! Welcome to our exhibition desk. How can we assist you today?',
          chatAutoReply: true
        },
        organization: org,
        source: 'organization_fallback'
      };
    }
  }

  // 2. Query by Event ID or Slug
  let eventDoc = null;
  if (eventId && mongoose.isValidObjectId(eventId)) {
    eventDoc = await Event.findById(eventId).select('title slug claimedBy organizer orgEmail').lean();
  } else if (slug) {
    eventDoc = await Event.findOne({
      $or: [{ slug: slug.toLowerCase() }, { _id: mongoose.isValidObjectId(slug) ? slug : null }].filter(Boolean)
    }).select('title slug claimedBy organizer orgEmail').lean();
  }

  if (eventDoc) {
    // Check claimedBy user
    if (eventDoc.claimedBy && mongoose.isValidObjectId(eventDoc.claimedBy)) {
      const claimedUser = await User.findById(eventDoc.claimedBy).select('name email role isVerified isChatEnabled chatStatus chatWelcomeMessage chatAutoReply organization');
      if (claimedUser) return { user: claimedUser, event: eventDoc, source: 'event_claimedBy' };
    }

    // Check organizer organization
    if (eventDoc.organizer && mongoose.isValidObjectId(eventDoc.organizer)) {
      const orgUser = await User.findOne({ organization: eventDoc.organizer, role: 'organizer' })
        .select('name email role isVerified isChatEnabled chatStatus chatWelcomeMessage chatAutoReply organization');
      if (orgUser) return { user: orgUser, event: eventDoc, source: 'event_organizer_user' };
      
      const org = await Organization.findById(eventDoc.organizer);
      if (org) {
        return {
          user: {
            _id: org._id,
            name: org.name,
            email: org.contact?.email || '',
            role: 'organizer',
            isVerified: true,
            isChatEnabled: !!org.isChatEnabled,
            chatStatus: org.chatStatus || 'offline',
            chatWelcomeMessage: org.chatWelcomeMessage || 'Hello! Welcome to our exhibition desk. How can we assist you today?',
            chatAutoReply: true
          },
          event: eventDoc,
          organization: org,
          source: 'event_org_fallback'
        };
      }
    }

    // Check orgEmail
    if (eventDoc.orgEmail) {
      const userByEmail = await User.findOne({ email: eventDoc.orgEmail.toLowerCase().trim() })
        .select('name email role isVerified isChatEnabled chatStatus chatWelcomeMessage chatAutoReply organization');
      if (userByEmail) return { user: userByEmail, event: eventDoc, source: 'event_orgEmail' };
    }
  }

  // 3. Query by orgEmail directly
  if (orgEmail) {
    const userByEmail = await User.findOne({ email: orgEmail.toLowerCase().trim() })
      .select('name email role isVerified isChatEnabled chatStatus chatWelcomeMessage chatAutoReply organization');
    if (userByEmail) return { user: userByEmail, source: 'direct_email' };
  }

  return { user: null, event: eventDoc };
}

// ============================================================================
// 1. PUBLIC ENDPOINTS: Check Organizer Chat Status & Config
// ============================================================================

/**
 * @desc Get Organizer Chat Status (Online/Offline) and welcome message
 * @route GET /api/chat/status
 * @access Public
 */
export const getChatStatus = async (req, res, next) => {
  try {
    const { organizerId, eventId, slug, orgEmail } = req.query;

    const { user: organizer, event } = await resolveOrganizerUser({
      organizerId,
      eventId,
      slug,
      orgEmail
    });

    if (!organizer) {
      return res.status(200).json({
        success: true,
        isChatEnabled: false,
        chatStatus: 'offline',
        message: 'Organizer does not have an active chat profile registered.'
      });
    }

    const isEnabled = !!organizer.isChatEnabled;
    const currentStatus = organizer.chatStatus || (isEnabled ? 'online' : 'offline');

    res.status(200).json({
      success: true,
      isChatEnabled: isEnabled,
      chatStatus: currentStatus,
      chatWelcomeMessage:
        organizer.chatWelcomeMessage ||
        'Hello! Welcome to our exhibition desk. How can we assist you today?',
      organizer: {
        id: organizer._id,
        name: organizer.name,
        email: organizer.email,
        isVerified: organizer.isVerified
      },
      event: event
        ? {
            id: event._id,
            title: event.title,
            slug: event.slug
          }
        : null
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// 2. ORGANIZER PROTECTED ENDPOINTS: Settings & Analytics
// ============================================================================

/**
 * @desc Get Organizer Chat Settings & Overview Stats
 * @route GET /api/chat/settings
 * @access Private (Organizer)
 */
export const getChatSettings = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select(
      'isChatEnabled chatStatus chatWelcomeMessage chatAutoReply organization name'
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'Organizer user not found' });
    }

    // Calculate live conversation metrics
    const [totalConversations, unreadConversations, visitorCount, exhibitorCount] = await Promise.all([
      ChatConversation.countDocuments({ organizer: req.user.id, status: { $ne: 'archived' } }),
      ChatConversation.countDocuments({ organizer: req.user.id, unreadByOrganizer: { $gt: 0 }, status: { $ne: 'archived' } }),
      ChatConversation.countDocuments({ organizer: req.user.id, participantRole: 'visitor', status: { $ne: 'archived' } }),
      ChatConversation.countDocuments({ organizer: req.user.id, participantRole: 'exhibitor', status: { $ne: 'archived' } })
    ]);

    res.status(200).json({
      success: true,
      settings: {
        isChatEnabled: !!user.isChatEnabled,
        chatStatus: user.chatStatus || 'offline',
        chatWelcomeMessage:
          user.chatWelcomeMessage ||
          'Hello! Welcome to our exhibition desk. How can we assist you today?',
        chatAutoReply: user.chatAutoReply !== false
      },
      stats: {
        totalConversations,
        unreadConversations,
        visitorCount,
        exhibitorCount
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Update Organizer Chat Settings (Enable/Disable, Status, Welcome Message)
 * @route PATCH /api/chat/settings
 * @access Private (Organizer)
 */
export const updateChatSettings = async (req, res, next) => {
  try {
    const { isChatEnabled, chatStatus, chatWelcomeMessage, chatAutoReply } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Organizer user not found' });
    }

    if (isChatEnabled !== undefined) {
      user.isChatEnabled = Boolean(isChatEnabled);
      // Auto-set status to online when enabled, offline when disabled if not specified
      if (chatStatus === undefined) {
        user.chatStatus = user.isChatEnabled ? 'online' : 'offline';
      }
    }

    if (chatStatus !== undefined) {
      user.chatStatus = chatStatus;
      if (chatStatus === 'online') {
        user.isChatEnabled = true;
      }
    }

    if (chatWelcomeMessage !== undefined) {
      user.chatWelcomeMessage = String(chatWelcomeMessage).trim();
    }

    if (chatAutoReply !== undefined) {
      user.chatAutoReply = Boolean(chatAutoReply);
    }

    await user.save();

    // Sync with Organization if linked
    if (user.organization) {
      await Organization.findByIdAndUpdate(user.organization, {
        isChatEnabled: user.isChatEnabled,
        chatStatus: user.chatStatus,
        chatWelcomeMessage: user.chatWelcomeMessage
      }).catch(() => {});
    }

    res.status(200).json({
      success: true,
      message: 'Live Chat settings updated successfully',
      settings: {
        isChatEnabled: user.isChatEnabled,
        chatStatus: user.chatStatus,
        chatWelcomeMessage: user.chatWelcomeMessage,
        chatAutoReply: user.chatAutoReply
      }
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// 3. CONVERSATION MANAGEMENT: Start / Resume / List
// ============================================================================

/**
 * @desc Start or Resume a Chat Conversation (from Visitor or Exhibitor)
 * @route POST /api/chat/conversations
 * @access Public / Authenticated
 */
export const startOrFetchConversation = async (req, res, next) => {
  try {
    const {
      organizerId,
      eventId,
      eventSlug,
      eventTitle,
      participantRole = 'visitor',
      participantName,
      participantEmail,
      participantPhone = '',
      participantCompany = '',
      participantDesignation = '',
      message,
      sessionId
    } = req.body;

    if (!participantName || !participantEmail) {
      return res.status(400).json({
        success: false,
        message: 'Name and Email are required to initiate chat with the organizer.'
      });
    }

    // Resolve organizer
    let resolvedOrganizerId = organizerId;
    let resolvedOrgUser = null;

    if (!resolvedOrganizerId || !mongoose.isValidObjectId(resolvedOrganizerId)) {
      const resolved = await resolveOrganizerUser({
        organizerId,
        eventId,
        slug: eventSlug
      });
      if (resolved.user) {
        resolvedOrganizerId = resolved.user._id;
        resolvedOrgUser = resolved.user;
      }
    } else {
      resolvedOrgUser = await User.findById(resolvedOrganizerId).select('name email isChatEnabled chatStatus chatWelcomeMessage chatAutoReply');
    }

    if (!resolvedOrganizerId) {
      return res.status(404).json({
        success: false,
        message: 'Could not find a valid organizer for this exhibition.'
      });
    }

    // Check if organizer chat is enabled
    if (resolvedOrgUser && !resolvedOrgUser.isChatEnabled) {
      return res.status(403).json({
        success: false,
        isChatEnabled: false,
        message: 'This organizer has temporarily paused live chat. Please use the contact inquiry form.'
      });
    }

    const cleanEmail = participantEmail.toLowerCase().trim();
    const cleanRole = participantRole === 'exhibitor' ? 'exhibitor' : 'visitor';

    // Find existing active conversation between this participant and organizer
    const query = {
      organizer: resolvedOrganizerId,
      participantEmail: cleanEmail,
      status: { $ne: 'archived' }
    };
    if (eventId && mongoose.isValidObjectId(eventId)) {
      query.event = eventId;
    }

    let conversation = await ChatConversation.findOne(query);

    const isNew = !conversation;

    if (!conversation) {
      conversation = new ChatConversation({
        organizer: resolvedOrganizerId,
        event: eventId && mongoose.isValidObjectId(eventId) ? eventId : null,
        eventTitle: eventTitle || '',
        eventSlug: eventSlug || '',
        participantRole: cleanRole,
        participantName: participantName.trim(),
        participantEmail: cleanEmail,
        participantPhone: (participantPhone || '').trim(),
        participantCompany: (participantCompany || '').trim(),
        participantDesignation: (participantDesignation || '').trim(),
        participantUser: req.user?.id || null,
        participantSessionId: sessionId || '',
        messages: []
      });

      // If organizer has auto-reply welcome message enabled, insert welcome message first
      if (resolvedOrgUser && resolvedOrgUser.chatAutoReply !== false) {
        const welcomeText =
          resolvedOrgUser.chatWelcomeMessage ||
          'Hello! Welcome to our exhibition desk. How can we assist you today?';
        conversation.messages.push({
          senderRole: 'organizer',
          senderName: resolvedOrgUser.name || 'Organizer',
          senderId: String(resolvedOrganizerId),
          text: welcomeText,
          timestamp: new Date(),
          read: true
        });
      }
    }

    // Append initial user message if provided
    if (message && message.trim()) {
      conversation.messages.push({
        senderRole: cleanRole,
        senderName: participantName.trim(),
        senderId: req.user?.id || sessionId || cleanEmail,
        text: message.trim(),
        timestamp: new Date(),
        read: false
      });
      conversation.lastMessage = message.trim();
      conversation.lastMessageAt = new Date();
      conversation.unreadByOrganizer = (conversation.unreadByOrganizer || 0) + 1;
    }

    await conversation.save();

    res.status(isNew ? 201 : 200).json({
      success: true,
      isNew,
      conversation
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Get all Conversations for Organizer with filters & search
 * @route GET /api/chat/conversations
 * @access Private (Organizer)
 */
export const getOrganizerConversations = async (req, res, next) => {
  try {
    const { role, status = 'active', search, unreadOnly } = req.query;

    const filter = { organizer: req.user.id };

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (role && role !== 'all') {
      filter.participantRole = role;
    }

    if (unreadOnly === 'true') {
      filter.unreadByOrganizer = { $gt: 0 };
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { participantName: searchRegex },
        { participantEmail: searchRegex },
        { participantCompany: searchRegex },
        { eventTitle: searchRegex },
        { lastMessage: searchRegex }
      ];
    }

    const conversations = await ChatConversation.find(filter)
      .sort({ lastMessageAt: -1 })
      .populate('event', 'title slug banner city venue startDate endDate')
      .lean();

    res.status(200).json({
      success: true,
      count: conversations.length,
      conversations
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Get a single Conversation with full messages
 * @route GET /api/chat/conversations/:id
 * @access Public / Authenticated
 */
export const getConversationById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.query; // 'organizer' | 'participant'

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    const conversation = await ChatConversation.findById(id).populate(
      'event',
      'title slug banner city venue startDate endDate'
    );

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const isOrganizer = req.user && String(conversation.organizer) === String(req.user.id);

    // Auto mark read depending on who is fetching
    if (isOrganizer) {
      conversation.unreadByOrganizer = 0;
      conversation.messages.forEach((msg) => {
        if (msg.senderRole !== 'organizer') msg.read = true;
      });
      await conversation.save();
    } else if (role === 'participant') {
      conversation.unreadByParticipant = 0;
      conversation.messages.forEach((msg) => {
        if (msg.senderRole === 'organizer') msg.read = true;
      });
      await conversation.save();
    }

    res.status(200).json({
      success: true,
      conversation
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Send a new message to a conversation thread
 * @route POST /api/chat/conversations/:id/messages
 * @access Public / Authenticated
 */
export const sendMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { text, senderRole, senderName, sessionId } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Message text cannot be empty' });
    }

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    const conversation = await ChatConversation.findById(id);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const isOrganizer = req.user && String(conversation.organizer) === String(req.user.id);

    const actualSenderRole = isOrganizer ? 'organizer' : (senderRole || conversation.participantRole || 'visitor');
    const actualSenderName = isOrganizer ? (req.user.name || 'Organizer') : (senderName || conversation.participantName);
    const actualSenderId = isOrganizer ? String(req.user.id) : (sessionId || conversation.participantEmail);

    const newMessage = {
      senderRole: actualSenderRole,
      senderName: actualSenderName,
      senderId: actualSenderId,
      text: text.trim(),
      timestamp: new Date(),
      read: false
    };

    conversation.messages.push(newMessage);
    conversation.lastMessage = text.trim();
    conversation.lastMessageAt = new Date();

    if (isOrganizer) {
      conversation.unreadByParticipant = (conversation.unreadByParticipant || 0) + 1;
      conversation.unreadByOrganizer = 0;
    } else {
      conversation.unreadByOrganizer = (conversation.unreadByOrganizer || 0) + 1;
      conversation.unreadByParticipant = 0;
    }

    await conversation.save();

    res.status(200).json({
      success: true,
      message: newMessage,
      conversation
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Update conversation status (active / archived)
 * @route PATCH /api/chat/conversations/:id/status
 * @access Private (Organizer)
 */
export const updateConversationStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'archived', 'closed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const conversation = await ChatConversation.findOne({ _id: id, organizer: req.user.id });
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    conversation.status = status;
    await conversation.save();

    res.status(200).json({
      success: true,
      message: `Conversation marked as ${status}`,
      conversation
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Get Participant Conversations (for visitor/exhibitor user or email)
 * @route GET /api/chat/participant/conversations
 * @access Public / Authenticated
 */
export const getParticipantConversations = async (req, res, next) => {
  try {
    const { email, sessionId } = req.query;

    const orConditions = [];

    if (req.user?.id) {
      orConditions.push({ participantUser: req.user.id });
    }
    if (req.user?.email) {
      orConditions.push({ participantEmail: req.user.email.toLowerCase().trim() });
    }
    if (email) {
      orConditions.push({ participantEmail: email.toLowerCase().trim() });
    }
    if (sessionId) {
      orConditions.push({ participantSessionId: sessionId });
    }

    if (orConditions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Must provide user credentials, email, or sessionId to fetch participant chats.'
      });
    }

    const conversations = await ChatConversation.find({ $or: orConditions })
      .sort({ lastMessageAt: -1 })
      .populate('organizer', 'name email')
      .populate('event', 'title slug banner city venue')
      .lean();

    res.status(200).json({
      success: true,
      conversations
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Get all Organizers with their Expos and Live Chat availability status
 * @route GET /api/chat/organizers-directory
 * @access Public / Authenticated (Visitors & Exhibitors)
 */
export const getOrganizersWithExpos = async (req, res, next) => {
  try {
    const { search, chatOnly } = req.query;

    // 1. Fetch aggregated organizers from directory
    const aggResult = await getAggregatedOrganizers(false);
    const baseOrganizers = Array.isArray(aggResult?.organizers)
      ? aggResult.organizers
      : Array.isArray(aggResult)
      ? aggResult
      : [];

    // 2. Fetch all registered organizer users and organizations from MongoDB
    const [organizerUsers, mongoOrgs] = await Promise.all([
      User.find({ role: { $in: ['organizer', 'super_admin'] } })
        .select('name email phone organization isChatEnabled chatStatus chatWelcomeMessage isVerified company')
        .lean(),
      Organization.find()
        .select('name logo website contact isChatEnabled chatStatus chatWelcomeMessage')
        .lean()
    ]);

    // Build lookup maps
    const userByOrgId = new Map();
    const userByEmail = new Map();
    const userByName = new Map();

    organizerUsers.forEach((u) => {
      if (u.organization) userByOrgId.set(String(u.organization), u);
      if (u.email) userByEmail.set(u.email.toLowerCase().trim(), u);
      if (u.name) userByName.set(u.name.toLowerCase().trim(), u);
    });

    const orgById = new Map();
    mongoOrgs.forEach((o) => {
      orgById.set(String(o._id), o);
    });

    // 3. Enrich each organizer with accurate live chat capabilities
    let enriched = baseOrganizers.map((org) => {
      let matchedUser = null;
      let matchedOrg = null;

      if (org.tenantId && userByOrgId.has(String(org.tenantId))) {
        matchedUser = userByOrgId.get(String(org.tenantId));
      } else if (org.tenantId && orgById.has(String(org.tenantId))) {
        matchedOrg = orgById.get(String(org.tenantId));
      }

      if (!matchedUser && org.email && userByEmail.has(org.email.toLowerCase().trim())) {
        matchedUser = userByEmail.get(org.email.toLowerCase().trim());
      }

      if (!matchedUser && org.name && userByName.has(org.name.toLowerCase().trim())) {
        matchedUser = userByName.get(org.name.toLowerCase().trim());
      }

      // Check if any event has a claimedBy user with chat enabled
      let eventClaimedUser = null;
      if (Array.isArray(org.events)) {
        for (const evt of org.events) {
          if (evt.claimedBy && userByOrgId.has(String(evt.claimedBy))) {
            eventClaimedUser = userByOrgId.get(String(evt.claimedBy));
            break;
          }
        }
      }

      const activeUser = matchedUser || eventClaimedUser;

      const isChatEnabled = activeUser
        ? !!activeUser.isChatEnabled
        : matchedOrg
        ? !!matchedOrg.isChatEnabled
        : false;

      const chatStatus = activeUser
        ? (activeUser.chatStatus || (activeUser.isChatEnabled ? 'online' : 'offline'))
        : matchedOrg
        ? (matchedOrg.chatStatus || 'offline')
        : 'offline';

      const chatWelcomeMessage = activeUser
        ? activeUser.chatWelcomeMessage
        : matchedOrg
        ? matchedOrg.chatWelcomeMessage
        : 'Hello! Welcome to our exhibition desk. How can we assist you today?';

      const resolvedOrganizerId = activeUser
        ? String(activeUser._id)
        : matchedOrg
        ? String(matchedOrg._id)
        : org.tenantId || org.id;

      return {
        ...org,
        organizerId: resolvedOrganizerId,
        isChatEnabled,
        chatStatus,
        chatWelcomeMessage,
        isVerified: activeUser ? !!activeUser.isVerified : true,
        eventsCount: Array.isArray(org.events) ? org.events.length : 0
      };
    });

    // 4. Also include any registered MongoDB Organizer users who might have custom events
    organizerUsers.forEach((u) => {
      const alreadyIncluded = enriched.some(
        (o) =>
          (o.organizerId && String(o.organizerId) === String(u._id)) ||
          (o.email && u.email && o.email.toLowerCase() === u.email.toLowerCase()) ||
          (o.name && u.name && o.name.toLowerCase() === u.name.toLowerCase())
      );

      if (!alreadyIncluded && u.isChatEnabled) {
        enriched.push({
          id: String(u._id),
          organizerId: String(u._id),
          name: u.name,
          shortName: u.name,
          brandColor: '#1E40AF',
          accentColor: '#3B82F6',
          website: '',
          logoUrl: null,
          badge: 'Registered Organizer',
          type: 'independent',
          scope: `${u.name} - Verified Trade Show Organizer`,
          email: u.email,
          phone: u.phone || '',
          isRegisteredTenant: true,
          isChatEnabled: true,
          chatStatus: u.chatStatus || 'online',
          chatWelcomeMessage: u.chatWelcomeMessage || 'Hello! Welcome to our exhibition desk. How can we assist you today?',
          isVerified: !!u.isVerified,
          events: [],
          eventsCount: 0
        });
      }
    });

    // 5. Deduplicate and merge any duplicate organizers by normalized key
    const deduplicatedMap = new Map();
    enriched.forEach((org) => {
      const key = (org.id || org.organizerId || org.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      if (!key) return;

      if (!deduplicatedMap.has(key)) {
        deduplicatedMap.set(key, { ...org, id: key, events: [...(org.events || [])] });
      } else {
        const existing = deduplicatedMap.get(key);
        if (!existing.website && org.website) existing.website = org.website;
        if (!existing.email && org.email) existing.email = org.email;
        if (!existing.phone && org.phone) existing.phone = org.phone;
        if (!existing.logoUrl && org.logoUrl) existing.logoUrl = org.logoUrl;
        if ((!existing.scope || existing.scope.length < (org.scope || '').length) && org.scope) {
          existing.scope = org.scope;
        }
        if (org.isChatEnabled) {
          existing.isChatEnabled = true;
          existing.chatStatus = org.chatStatus || 'online';
          if (org.chatWelcomeMessage) existing.chatWelcomeMessage = org.chatWelcomeMessage;
          if (org.organizerId) existing.organizerId = org.organizerId;
        }

        // Merge events without duplicate slugs/ids
        const existingEventSlugs = new Set(
          (existing.events || []).map((e) => String(e.slug || e.id || e.title).toLowerCase().trim())
        );
        (org.events || []).forEach((evt) => {
          const evtKey = String(evt.slug || evt.id || evt.title).toLowerCase().trim();
          if (evtKey && !existingEventSlugs.has(evtKey)) {
            existingEventSlugs.add(evtKey);
            existing.events.push(evt);
          }
        });
        existing.eventsCount = existing.events.length;
      }
    });

    let mergedList = Array.from(deduplicatedMap.values());

    // 6. Apply filters
    if (chatOnly === 'true') {
      mergedList = mergedList.filter((o) => o.isChatEnabled);
    }

    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      mergedList = mergedList.filter((o) => {
        const matchOrg =
          (o.name && o.name.toLowerCase().includes(q)) ||
          (o.shortName && o.shortName.toLowerCase().includes(q)) ||
          (o.scope && o.scope.toLowerCase().includes(q)) ||
          (o.badge && o.badge.toLowerCase().includes(q));

        const matchEvent = Array.isArray(o.events) && o.events.some((e) =>
          (e.title && e.title.toLowerCase().includes(q)) ||
          (e.city && e.city.toLowerCase().includes(q)) ||
          (e.venue && e.venue.toLowerCase().includes(q)) ||
          (e.category && e.category.toLowerCase().includes(q))
        );

        return matchOrg || matchEvent;
      });
    }

    // Sort: Organizers with Live Chat Online first, then by events count
    mergedList.sort((a, b) => {
      if (a.isChatEnabled && !b.isChatEnabled) return -1;
      if (!a.isChatEnabled && b.isChatEnabled) return 1;
      return (b.eventsCount || 0) - (a.eventsCount || 0);
    });

    res.status(200).json({
      success: true,
      count: mergedList.length,
      organizers: mergedList
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Get all Organizers with their Live Chat enablement status & stats for Super Admin
 * @route GET /api/chat/admin/organizers
 * @access Private (Super Admin)
 */
export const getAdminChatOrganizers = async (req, res, next) => {
  try {
    const { status, search } = req.query; // status: 'all' | 'enabled' | 'online' | 'disabled'

    // 1. Fetch all registered organizer users and organizations from DB
    const [organizerUsers, mongoOrgs, events] = await Promise.all([
      User.find({ role: { $in: ['organizer', 'super_admin', 'event_manager'] } })
        .select('name email phone organization isChatEnabled chatStatus chatWelcomeMessage chatAutoReply isVerified company createdAt lastLogin')
        .populate('organization', 'name logo website')
        .lean(),
      Organization.find()
        .select('name logo website contact isChatEnabled chatStatus chatWelcomeMessage chatAutoReply createdAt')
        .lean(),
      Event.find().select('title organizer organizerName organization claimedBy').lean()
    ]);

    // 2. Fetch conversation statistics grouped by organizer
    const conversationStats = await ChatConversation.aggregate([
      {
        $group: {
          _id: '$organizer',
          totalConversations: { $sum: 1 },
          unreadByOrganizer: { $sum: '$unreadByOrganizer' },
          lastMessageAt: { $max: '$lastMessageAt' }
        }
      }
    ]);

    const statsMap = new Map();
    conversationStats.forEach((s) => {
      statsMap.set(String(s._id), s);
    });

    // 3. Count events per organizer / organization
    const eventsCountByOrg = new Map();
    const eventsCountByUser = new Map();
    events.forEach((e) => {
      if (e.organization) {
        const oId = String(e.organization);
        eventsCountByOrg.set(oId, (eventsCountByOrg.get(oId) || 0) + 1);
      }
      if (e.claimedBy) {
        const uId = String(e.claimedBy);
        eventsCountByUser.set(uId, (eventsCountByUser.get(uId) || 0) + 1);
      }
    });

    // 4. Transform organizer users into standardized admin view
    let list = organizerUsers.map((u) => {
      const uId = String(u._id);
      const orgId = u.organization?._id ? String(u.organization._id) : null;

      const convStat = statsMap.get(uId) || (orgId ? statsMap.get(orgId) : null) || {
        totalConversations: 0,
        unreadByOrganizer: 0,
        lastMessageAt: null
      };

      const eventsCount =
        (eventsCountByUser.get(uId) || 0) +
        (orgId ? (eventsCountByOrg.get(orgId) || 0) : 0);

      return {
        id: uId,
        userId: uId,
        organizationId: orgId,
        name: u.name || 'Unnamed Organizer',
        email: u.email,
        phone: u.phone || '',
        company: u.company || u.organization?.name || 'Independent Organizer',
        role: u.role,
        isVerified: !!u.isVerified,
        isChatEnabled: !!u.isChatEnabled,
        chatStatus: u.chatStatus || (u.isChatEnabled ? 'online' : 'offline'),
        chatWelcomeMessage: u.chatWelcomeMessage || 'Hello! Welcome to our exhibition desk. How can we assist you today?',
        chatAutoReply: u.chatAutoReply !== false,
        organizationName: u.organization?.name || '',
        organizationLogo: u.organization?.logo || null,
        organizationWebsite: u.organization?.website || '',
        eventsCount,
        totalConversations: convStat.totalConversations || 0,
        unreadMessages: convStat.unreadByOrganizer || 0,
        lastMessageAt: convStat.lastMessageAt || null,
        createdAt: u.createdAt,
        lastActive: u.lastLogin || convStat.lastMessageAt || u.createdAt
      };
    });

    // 5. Also include organizations that do not have a dedicated user account yet
    const existingOrgIds = new Set(list.map((item) => item.organizationId).filter(Boolean));
    mongoOrgs.forEach((o) => {
      const oId = String(o._id);
      if (!existingOrgIds.has(oId)) {
        const convStat = statsMap.get(oId) || {
          totalConversations: 0,
          unreadByOrganizer: 0,
          lastMessageAt: null
        };
        const eventsCount = eventsCountByOrg.get(oId) || 0;

        list.push({
          id: oId,
          userId: null,
          organizationId: oId,
          name: o.name,
          email: o.contact?.email || '',
          phone: o.contact?.phone || '',
          company: o.name,
          role: 'organizer',
          isVerified: true,
          isChatEnabled: !!o.isChatEnabled,
          chatStatus: o.chatStatus || (o.isChatEnabled ? 'online' : 'offline'),
          chatWelcomeMessage: o.chatWelcomeMessage || 'Hello! Welcome to our exhibition desk. How can we assist you today?',
          chatAutoReply: o.chatAutoReply !== false,
          organizationName: o.name,
          organizationLogo: o.logo || null,
          organizationWebsite: o.website || '',
          eventsCount,
          totalConversations: convStat.totalConversations || 0,
          unreadMessages: convStat.unreadByOrganizer || 0,
          lastMessageAt: convStat.lastMessageAt || null,
          createdAt: o.createdAt,
          lastActive: convStat.lastMessageAt || o.createdAt
        });
      }
    });

    // Calculate overall stats before filters
    const statsResult = {
      totalOrganizers: list.length,
      chatEnabledCount: list.filter((o) => o.isChatEnabled).length,
      chatOnlineCount: list.filter((o) => o.isChatEnabled && o.chatStatus === 'online').length,
      chatOfflineCount: list.filter((o) => o.isChatEnabled && o.chatStatus === 'offline').length,
      chatDisabledCount: list.filter((o) => !o.isChatEnabled).length,
      totalConversations: list.reduce((sum, o) => sum + o.totalConversations, 0),
      totalUnread: list.reduce((sum, o) => sum + o.unreadMessages, 0)
    };

    // Apply status filter
    if (status === 'enabled') {
      list = list.filter((o) => o.isChatEnabled);
    } else if (status === 'online') {
      list = list.filter((o) => o.isChatEnabled && o.chatStatus === 'online');
    } else if (status === 'disabled') {
      list = list.filter((o) => !o.isChatEnabled);
    }

    // Apply search filter
    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.email.toLowerCase().includes(q) ||
          o.company.toLowerCase().includes(q) ||
          o.organizationName.toLowerCase().includes(q)
      );
    }

    // Sort: Chat enabled & active first
    list.sort((a, b) => {
      if (a.isChatEnabled && !b.isChatEnabled) return -1;
      if (!a.isChatEnabled && b.isChatEnabled) return 1;
      if (b.totalConversations !== a.totalConversations) {
        return b.totalConversations - a.totalConversations;
      }
      return (b.eventsCount || 0) - (a.eventsCount || 0);
    });

    res.status(200).json({
      success: true,
      stats: statsResult,
      count: list.length,
      organizers: list
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Admin toggle or update chat settings for any organizer
 * @route PATCH /api/chat/admin/organizers/:id/toggle
 * @access Private (Super Admin)
 */
export const adminToggleOrganizerChat = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isChatEnabled, chatStatus, chatWelcomeMessage, chatAutoReply } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid organizer ID' });
    }

    // Try finding User
    let user = await User.findById(id);
    let org = null;

    if (user) {
      if (isChatEnabled !== undefined) user.isChatEnabled = isChatEnabled;
      if (chatStatus !== undefined) user.chatStatus = chatStatus;
      if (chatWelcomeMessage !== undefined) user.chatWelcomeMessage = chatWelcomeMessage;
      if (chatAutoReply !== undefined) user.chatAutoReply = chatAutoReply;
      await user.save();

      // If user has organization, also sync organization
      if (user.organization) {
        await Organization.findByIdAndUpdate(user.organization, {
          isChatEnabled: user.isChatEnabled,
          chatStatus: user.chatStatus,
          chatWelcomeMessage: user.chatWelcomeMessage,
          chatAutoReply: user.chatAutoReply
        });
      }

      return res.status(200).json({
        success: true,
        message: `Chat feature ${user.isChatEnabled ? 'enabled' : 'disabled'} for ${user.name}`,
        organizer: {
          id: String(user._id),
          name: user.name,
          isChatEnabled: user.isChatEnabled,
          chatStatus: user.chatStatus,
          chatWelcomeMessage: user.chatWelcomeMessage,
          chatAutoReply: user.chatAutoReply
        }
      });
    }

    // Otherwise try finding Organization
    org = await Organization.findById(id);
    if (org) {
      if (isChatEnabled !== undefined) org.isChatEnabled = isChatEnabled;
      if (chatStatus !== undefined) org.chatStatus = chatStatus;
      if (chatWelcomeMessage !== undefined) org.chatWelcomeMessage = chatWelcomeMessage;
      if (chatAutoReply !== undefined) org.chatAutoReply = chatAutoReply;
      await org.save();

      // Also sync any user attached to this organization
      await User.updateMany(
        { organization: org._id },
        {
          isChatEnabled: org.isChatEnabled,
          chatStatus: org.chatStatus,
          chatWelcomeMessage: org.chatWelcomeMessage,
          chatAutoReply: org.chatAutoReply
        }
      );

      return res.status(200).json({
        success: true,
        message: `Chat feature ${org.isChatEnabled ? 'enabled' : 'disabled'} for ${org.name}`,
        organizer: {
          id: String(org._id),
          name: org.name,
          isChatEnabled: org.isChatEnabled,
          chatStatus: org.chatStatus,
          chatWelcomeMessage: org.chatWelcomeMessage,
          chatAutoReply: org.chatAutoReply
        }
      });
    }

    return res.status(404).json({ success: false, message: 'Organizer user or organization not found' });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Get all Conversations for a specific organizer (Admin inspection)
 * @route GET /api/chat/admin/organizers/:id/conversations
 * @access Private (Super Admin)
 */
export const getAdminOrganizerConversations = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid organizer ID' });
    }

    const conversations = await ChatConversation.find({ organizer: id })
      .sort({ lastMessageAt: -1 })
      .populate('event', 'title slug banner city venue')
      .lean();

    res.status(200).json({
      success: true,
      count: conversations.length,
      conversations
    });
  } catch (error) {
    next(error);
  }
};
