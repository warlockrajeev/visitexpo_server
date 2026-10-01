import express from 'express';
import OrganizerSupportConversation from '../models/OrganizerSupportConversation.js';
import User from '../models/User.js';
import { authorize, protect } from '../middlewares/auth.js';

const router = express.Router();
const MAX_MESSAGE_LENGTH = 4000;

function getMessageText(body) {
  return typeof body?.text === 'string' ? body.text.trim() : '';
}

function validateMessage(text, res) {
  if (!text) {
    res.status(400).json({ success: false, error: 'Message cannot be empty' });
    return false;
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ success: false, error: `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters` });
    return false;
  }
  return true;
}

router.use(protect);

router.get('/conversation', authorize('organizer'), async (req, res, next) => {
  try {
    const conversation = await OrganizerSupportConversation.findOne({ organizer: req.user.id })
      .populate('organizer', 'name email')
      .lean();

    if (conversation?.unreadByOrganizer) {
      await OrganizerSupportConversation.updateOne(
        { _id: conversation._id },
        { $set: { unreadByOrganizer: 0, 'messages.$[message].read': true } },
        { arrayFilters: [{ 'message.senderRole': 'admin' }] }
      );
      conversation.unreadByOrganizer = 0;
      conversation.messages = conversation.messages.map((message) =>
        message.senderRole === 'admin' ? { ...message, read: true } : message
      );
    }

    res.status(200).json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
});

router.post('/conversation/messages', authorize('organizer'), async (req, res, next) => {
  try {
    const text = getMessageText(req.body);
    if (!validateMessage(text, res)) return;

    let conversation = await OrganizerSupportConversation.findOne({ organizer: req.user.id });
    if (!conversation) {
      conversation = new OrganizerSupportConversation({ organizer: req.user.id });
    }

    const sender = await User.findById(req.user.id).select('name email');
    conversation.messages.push({
      senderRole: 'organizer',
      senderId: req.user.id,
      senderName: sender?.name || sender?.email || 'Organizer',
      text,
      timestamp: new Date()
    });
    conversation.lastMessage = text;
    conversation.lastMessageAt = new Date();
    conversation.unreadByAdmin += 1;
    conversation.status = 'open';
    await conversation.save();
    await conversation.populate('organizer', 'name email');

    res.status(200).json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
});

router.get('/admin/conversations', authorize('super_admin', 'sub_admin', 'admin'), async (req, res, next) => {
  try {
    const conversations = await OrganizerSupportConversation.find()
      .populate('organizer', 'name email')
      .sort({ lastMessageAt: -1 })
      .lean();
    res.status(200).json({ success: true, conversations });
  } catch (error) {
    next(error);
  }
});

router.get('/admin/conversations/:id', authorize('super_admin', 'sub_admin', 'admin'), async (req, res, next) => {
  try {
    const conversation = await OrganizerSupportConversation.findById(req.params.id)
      .populate('organizer', 'name email');
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    conversation.unreadByAdmin = 0;
    conversation.messages.forEach((message) => {
      if (message.senderRole === 'organizer') message.read = true;
    });
    await conversation.save();
    res.status(200).json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/conversations/:id/messages', authorize('super_admin', 'sub_admin', 'admin'), async (req, res, next) => {
  try {
    const text = getMessageText(req.body);
    if (!validateMessage(text, res)) return;

    const conversation = await OrganizerSupportConversation.findById(req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const sender = await User.findById(req.user.id).select('name email');
    conversation.messages.push({
      senderRole: 'admin',
      senderId: req.user.id,
      senderName: sender?.name || sender?.email || 'VisitExpo Support',
      text,
      timestamp: new Date()
    });
    conversation.lastMessage = text;
    conversation.lastMessageAt = new Date();
    conversation.unreadByOrganizer += 1;
    conversation.status = 'open';
    await conversation.save();
    await conversation.populate('organizer', 'name email');

    res.status(200).json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
});

export default router;