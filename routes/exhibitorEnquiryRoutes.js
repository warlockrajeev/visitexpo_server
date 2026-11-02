import express from 'express';
import { createHash, randomBytes } from 'crypto';
import ExhibitorEnquiry from '../models/ExhibitorEnquiry.js';
import ContactMessage from '../models/ContactMessage.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { protect, authorize } from '../middlewares/auth.js';
import { sendEmail } from '../services/emailService.js';
import { getPromotionTrackingBaseUrl } from '../services/promotionEmailService.js';

const router = express.Router();
const CREDIT_COST = 10;
const CLIENT_URL = process.env.CLIENT_URL || 'https://client.visitexpo.in';
const TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
const ORGANIZER_ROLES = ['organizer', 'event_manager'];

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);

const addBusinessDays = (date, days) => {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0 && result.getDay() !== 6) added += 1;
  }
  return result;
};

const getEnquiryStatus = (enquiry, now = new Date()) => {
  if (enquiry.deliveryStatus === 'draft') return 'draft';
  if (enquiry.deliveryStatus === 'canceled') return 'canceled';
  if (enquiry.deliveryStatus === 'failed') return 'failed';
  if (enquiry.deliveryStatus === 'pending') return 'pending';
  if (enquiry.acceptedAt) return 'accepted';
  if (enquiry.rejectedAt) return 'rejected';
  if (enquiry.firstReplyAt) return 'replied';
  if (enquiry.followUpDueAt && new Date(enquiry.followUpDueAt) <= now) return 'no_response';
  if (enquiry.viewedAt) return 'viewed';
  if (enquiry.deliveryStatus === 'delivered') return 'delivered';
  return 'sent';
};

const toEnquiryResponse = (enquiry) => {
  const item = enquiry.toObject ? enquiry.toObject() : enquiry;
  delete item.trackingTokenHashes;
  return {
    ...item,
    status: getEnquiryStatus(item),
    responseStatus: item.deliveryStatus === 'draft'
      ? 'draft'
      : item.deliveryStatus === 'canceled'
        ? 'canceled'
        : item.acceptedAt
      ? 'accepted'
      : item.rejectedAt
        ? 'rejected'
        : item.firstReplyAt
          ? 'replied'
          : item.followUpDueAt && new Date(item.followUpDueAt) <= new Date()
            ? 'no_response'
            : 'pending'
  };
};

const validateMessage = (message, { initial = false } = {}) => {
  if (typeof message !== 'string' || !message.trim()) return 'A message is required.';
  const trimmed = message.trim();
  if (trimmed.length > 5000) return 'Messages cannot exceed 5,000 characters.';
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return 'HTML tags are not permitted in messages.';
  if (initial) {
    const words = trimmed.split(/\s+/).filter((word) => /[a-zA-Z]{2,}/.test(word));
    if (trimmed.length < 100 || trimmed.length > 300 || words.length < 10) {
      return 'The first enquiry must contain 100–300 characters and at least 10 words.';
    }
    if (/(.)\1{4,}/.test(trimmed)) return 'Excessive repeated characters detected. Please write a genuine B2B enquiry.';
    const nonSpace = trimmed.replace(/\s+/g, '');
    const letters = trimmed.match(/[a-zA-Z]/g) || [];
    if (!letters.length || letters.length / nonSpace.length < 0.6) {
      return 'Message must consist of genuine text and words, not symbols or random characters.';
    }
    const uniqueWords = new Set(words.filter((word) => /[a-zA-Z]{2,}/.test(word)).map((word) => word.toLowerCase()));
    if (uniqueWords.size < Math.min(6, Math.floor(words.length * 0.4))) {
      return 'Please avoid repetitive words and write a meaningful B2B enquiry.';
    }
  }
  return null;
};

const makeTrackingToken = () => randomBytes(32).toString('hex');
const hashTrackingToken = (token) => createHash('sha256').update(token).digest('hex');
const getPixelUrl = (enquiryId, token) =>
  `${getPromotionTrackingBaseUrl()}/exhibitors/enquiries/open/${enquiryId}/${token}`;

const buildEmail = ({ enquiry, message, senderRole, trackingUrl }) => {
  const senderName = senderRole === 'organizer' ? enquiry.organizerName : enquiry.exhibitorName;
  const recipientName = senderRole === 'organizer'
    ? enquiry.exhibitorContactPerson || enquiry.exhibitorName
    : enquiry.organizerName;
  const replyUrl = `${CLIENT_URL}${senderRole === 'organizer' ? '/exhibitor-inquiries' : '/campaigns/exhibitor-discovery'}`;
  const html = [
    `<p>Hello ${escapeHtml(recipientName)},</p>`,
    `<p>${escapeHtml(senderName)} sent you a message about <strong>${escapeHtml(enquiry.inquiryType)}</strong>.</p>`,
    `<blockquote style="border-left:3px solid #d1d5db;padding-left:12px;white-space:pre-wrap">${escapeHtml(message)}</blockquote>`,
    `<p><a href="${replyUrl}">Open VisitExpo to continue this conversation</a></p>`,
    trackingUrl ? `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:none">` : ''
  ].join('');
  return { html, text: `${senderName} wrote:\n\n${message}\n\nContinue this conversation: ${replyUrl}` };
};

const sendEnquiryEmail = async ({ enquiry, message, senderRole, trackingUrl }) => {
  const recipient = senderRole === 'organizer' ? enquiry.exhibitorEmail : enquiry.organizerEmail;
  const subject = `VisitExpo enquiry: ${enquiry.inquiryType} — ${enquiry.exhibitorName}`;
  const content = buildEmail({ enquiry, message, senderRole, trackingUrl });
  return sendEmail({ to: recipient, subject, ...content });
};

const isOrganizerOwner = (enquiry, userId) => String(enquiry.organizer) === String(userId);
const isExhibitorRecipient = (enquiry, email) =>
  String(enquiry.exhibitorEmail || '').toLowerCase() === String(email || '').toLowerCase();

export const createExhibitorEnquiry = async (req, res, next) => {
  let chargedUserId;
  let enquiry;
  let emailAccepted = false;
  try {
    const validationError = validateMessage(req.body.message, { initial: true });
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const exhibitorEmail = String(req.body.exhibitorEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(exhibitorEmail)) {
      return res.status(400).json({ success: false, error: 'A valid exhibitor email address is required.' });
    }

    const user = await User.findById(req.user.id).select('name email company credits');
    if (!user) return res.status(404).json({ success: false, error: 'Organizer account not found.' });

    await User.updateOne(
      { _id: user._id, credits: { $exists: false } },
      { $set: { credits: 100 } }
    );
    const chargedUser = await User.findOneAndUpdate(
      { _id: user._id, credits: { $gte: CREDIT_COST } },
      { $inc: { credits: -CREDIT_COST } },
      { new: true }
    ).select('credits');
    if (!chargedUser) {
      return res.status(400).json({ success: false, error: `Insufficient credits. ${CREDIT_COST} credits are required.` });
    }
    chargedUserId = user._id;

    const trackingToken = makeTrackingToken();
    const sentAt = new Date();
    enquiry = await ExhibitorEnquiry.create({
      organizer: user._id,
      organizerName: user.name,
      organizerEmail: user.email,
      organizerCompany: user.company || '',
      exhibitorId: String(req.body.exhibitorId || ''),
      exhibitorName: String(req.body.exhibitorName || '').trim() || 'Exhibitor',
      exhibitorContactPerson: String(req.body.exhibitorContactPerson || '').trim(),
      exhibitorEmail,
      exhibitorPhone: String(req.body.exhibitorPhone || '').trim(),
      exhibitorCountry: String(req.body.country || '').trim(),
      exhibitorWebsite: String(req.body.exhibitorWebsite || '').trim(),
      exhibitorIndustry: String(req.body.industry || '').trim(),
      exhibitorLogo: String(req.body.exhibitorLogo || ''),
      inquiryType: String(req.body.inquiryType || 'B2B Trade Partnership').trim(),
      creditsCharged: CREDIT_COST,
      deliveryStatus: 'pending',
      sendLockUntil: new Date(Date.now() + 15 * 60 * 1000),
      sentAt,
      followUpDueAt: addBusinessDays(sentAt, 4),
      trackingTokenHashes: [hashTrackingToken(trackingToken)],
      messages: [{
        senderRole: 'organizer',
        senderId: user._id,
        senderName: user.name,
        senderEmail: user.email,
        message: req.body.message.trim(),
        deliveryStatus: 'pending',
        sentAt
      }]
    });

    const emailResult = await sendEnquiryEmail({
      enquiry,
      message: req.body.message.trim(),
      senderRole: 'organizer',
      trackingUrl: getPixelUrl(enquiry._id, trackingToken)
    });
    emailAccepted = emailResult.success;

    if (!emailResult.success) {
      await User.updateOne({ _id: chargedUserId }, { $inc: { credits: CREDIT_COST } });
      chargedUserId = null;
      await ExhibitorEnquiry.updateOne(
        { _id: enquiry._id },
        { $set: { deliveryStatus: 'failed', creditsRefunded: CREDIT_COST, sendLockUntil: null } }
      );
      return res.status(502).json({
        success: false,
        error: 'The enquiry email could not be accepted by the mail server. Credits were returned.',
        details: emailResult.error
      });
    }

    const deliveredAt = new Date();
    await ExhibitorEnquiry.updateOne(
      { _id: enquiry._id },
      {
        $set: {
          deliveryStatus: 'delivered',
          sendLockUntil: null,
          deliveredAt,
          sentAt: deliveredAt,
          'messages.0.deliveryStatus': 'delivered',
          'messages.0.sentAt': deliveredAt
        }
      }
    );

    return res.status(201).json({
      success: true,
      message: `Enquiry sent to ${enquiry.exhibitorName}.`,
      data: {
        enquiryId: enquiry._id,
        remainingCredits: chargedUser.credits,
        creditsCharged: CREDIT_COST
      }
    });
  } catch (error) {
    if (chargedUserId && !emailAccepted) {
      await User.updateOne({ _id: chargedUserId }, { $inc: { credits: CREDIT_COST } });
    }
    if (enquiry) {
      if (emailAccepted) {
        const deliveredAt = new Date();
        await ExhibitorEnquiry.updateOne(
          { _id: enquiry._id },
          {
            $set: {
              deliveryStatus: 'delivered',
              sendLockUntil: null,
              deliveredAt,
              sentAt: deliveredAt,
              'messages.0.deliveryStatus': 'delivered',
              'messages.0.sentAt': deliveredAt
            }
          }
        );
      } else {
        await ExhibitorEnquiry.updateOne(
          { _id: enquiry._id, deliveryStatus: 'pending' },
          { $set: { deliveryStatus: 'failed', creditsRefunded: CREDIT_COST, sendLockUntil: null } }
        );
      }
    }
    next(error);
  }
};

router.get('/open/:id/:token', async (req, res, next) => {
  try {
    const tokenHash = hashTrackingToken(req.params.token);
    await ExhibitorEnquiry.updateOne(
      {
        _id: req.params.id,
        trackingTokenHashes: tokenHash,
        viewedAt: null
      },
      { $set: { viewedAt: new Date() } }
    );
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'Content-Type': 'image/gif'
    });
    return res.status(200).send(TRACKING_PIXEL);
  } catch (error) {
    return next(error);
  }
});

router.post('/', protect, authorize(...ORGANIZER_ROLES), createExhibitorEnquiry);

router.post('/drafts', protect, authorize(...ORGANIZER_ROLES), async (req, res, next) => {
  try {
    const exhibitorEmail = String(req.body.exhibitorEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(exhibitorEmail)) {
      return res.status(400).json({ success: false, error: 'A valid exhibitor email address is required.' });
    }
    const user = await User.findById(req.user.id).select('name email company');
    if (!user) return res.status(404).json({ success: false, error: 'Organizer account not found.' });

    const enquiry = await ExhibitorEnquiry.create({
      organizer: user._id,
      organizerName: user.name,
      organizerEmail: user.email,
      organizerCompany: user.company || '',
      exhibitorId: String(req.body.exhibitorId || ''),
      exhibitorName: String(req.body.exhibitorName || '').trim() || 'Exhibitor',
      exhibitorContactPerson: String(req.body.exhibitorContactPerson || '').trim(),
      exhibitorEmail,
      exhibitorPhone: String(req.body.exhibitorPhone || '').trim(),
      exhibitorCountry: String(req.body.country || '').trim(),
      exhibitorWebsite: String(req.body.exhibitorWebsite || '').trim(),
      exhibitorIndustry: String(req.body.industry || '').trim(),
      exhibitorLogo: String(req.body.exhibitorLogo || ''),
      inquiryType: String(req.body.inquiryType || 'B2B Trade Partnership').trim(),
      creditsCharged: 0,
      deliveryStatus: 'draft',
      messages: [{
        senderRole: 'organizer',
        senderId: user._id,
        senderName: user.name,
        senderEmail: user.email,
        message: String(req.body.message || '').trim(),
        deliveryStatus: 'draft'
      }]
    });
    return res.status(201).json({ success: true, data: { enquiry: toEnquiryResponse(enquiry) } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/draft', protect, authorize(...ORGANIZER_ROLES), async (req, res, next) => {
  try {
    const message = String(req.body.message || '').trim();
    if (message.length > 5000) {
      return res.status(400).json({ success: false, error: 'Messages cannot exceed 5,000 characters.' });
    }
    const exhibitorEmail = String(req.body.exhibitorEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(exhibitorEmail)) {
      return res.status(400).json({ success: false, error: 'A valid exhibitor email address is required.' });
    }
    const enquiry = await ExhibitorEnquiry.findOneAndUpdate(
      { _id: req.params.id, organizer: req.user.id, deliveryStatus: 'draft', deletedAt: null },
      {
        $set: {
          exhibitorId: String(req.body.exhibitorId || ''),
          exhibitorName: String(req.body.exhibitorName || '').trim() || 'Exhibitor',
          exhibitorContactPerson: String(req.body.exhibitorContactPerson || '').trim(),
          exhibitorEmail,
          exhibitorPhone: String(req.body.exhibitorPhone || '').trim(),
          exhibitorCountry: String(req.body.country || '').trim(),
          exhibitorWebsite: String(req.body.exhibitorWebsite || '').trim(),
          exhibitorIndustry: String(req.body.industry || '').trim(),
          exhibitorLogo: String(req.body.exhibitorLogo || ''),
          inquiryType: String(req.body.inquiryType || 'B2B Trade Partnership').trim(),
          'messages.0.message': message
        }
      },
      { new: true, runValidators: true }
    ).lean();
    if (!enquiry) return res.status(404).json({ success: false, error: 'Draft not found or it has already been sent.' });
    return res.status(200).json({ success: true, data: { enquiry: toEnquiryResponse(enquiry) } });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/send', protect, authorize(...ORGANIZER_ROLES), async (req, res, next) => {
  let enquiry;
  let charged = false;
  let emailAccepted = false;
  try {
    const existing = await ExhibitorEnquiry.findOne({
      _id: req.params.id,
      organizer: req.user.id,
      deliveryStatus: 'draft',
      deletedAt: null
    });
    if (!existing) return res.status(404).json({ success: false, error: 'Draft not found or it has already been sent.' });
    const message = String(existing.messages[0]?.message || '').trim();
    const validationError = validateMessage(message, { initial: true });
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const sentAt = new Date();
    const trackingToken = makeTrackingToken();
    enquiry = await ExhibitorEnquiry.findOneAndUpdate(
      { _id: existing._id, organizer: req.user.id, deliveryStatus: 'draft' },
      {
        $set: {
          deliveryStatus: 'pending',
          creditsCharged: 0,
          creditsRefunded: 0,
          sendLockUntil: new Date(Date.now() + 15 * 60 * 1000),
          sentAt,
          followUpDueAt: addBusinessDays(sentAt, 4),
          trackingTokenHashes: [hashTrackingToken(trackingToken)],
          'messages.0.deliveryStatus': 'pending',
          'messages.0.sentAt': sentAt
        }
      },
      { new: true }
    );
    if (!enquiry) return res.status(409).json({ success: false, error: 'This draft is already being sent.' });

    await User.updateOne(
      { _id: req.user.id, credits: { $exists: false } },
      { $set: { credits: 100 } }
    );
    const chargedUser = await User.findOneAndUpdate(
      { _id: req.user.id, credits: { $gte: CREDIT_COST } },
      { $inc: { credits: -CREDIT_COST } },
      { new: true }
    ).select('credits');
    if (!chargedUser) {
      await ExhibitorEnquiry.updateOne(
        { _id: enquiry._id, deliveryStatus: 'pending' },
        {
          $set: {
            deliveryStatus: 'draft',
            creditsCharged: 0,
            sendLockUntil: null,
            sentAt: null,
            followUpDueAt: null,
            trackingTokenHashes: [],
            'messages.0.deliveryStatus': 'draft',
            'messages.0.sentAt': null
          }
        }
      );
      return res.status(400).json({ success: false, error: `Insufficient credits. ${CREDIT_COST} credits are required.` });
    }
    charged = true;
    await ExhibitorEnquiry.updateOne(
      { _id: enquiry._id, deliveryStatus: 'pending' },
      { $set: { creditsCharged: CREDIT_COST } }
    );

    const emailResult = await sendEnquiryEmail({
      enquiry,
      message,
      senderRole: 'organizer',
      trackingUrl: getPixelUrl(enquiry._id, trackingToken)
    });
    emailAccepted = emailResult.success;
    if (!emailResult.success) {
      await User.updateOne({ _id: req.user.id }, { $inc: { credits: CREDIT_COST } });
      charged = false;
      await ExhibitorEnquiry.updateOne(
        { _id: enquiry._id },
        { $set: { deliveryStatus: 'failed', creditsRefunded: CREDIT_COST, sendLockUntil: null } }
      );
      return res.status(502).json({
        success: false,
        error: 'The enquiry email could not be accepted by the mail server. Credits were returned.',
        details: emailResult.error
      });
    }

    const deliveredAt = new Date();
    await ExhibitorEnquiry.updateOne(
      { _id: enquiry._id },
      {
        $set: {
          deliveryStatus: 'delivered',
          sendLockUntil: null,
          deliveredAt,
          sentAt: deliveredAt,
          'messages.0.deliveryStatus': 'delivered',
          'messages.0.sentAt': deliveredAt
        }
      }
    );
    return res.status(200).json({
      success: true,
      message: `Enquiry sent to ${enquiry.exhibitorName}.`,
      data: { enquiryId: enquiry._id, remainingCredits: chargedUser.credits, creditsCharged: CREDIT_COST }
    });
  } catch (error) {
    if (enquiry && charged && !emailAccepted) {
      await User.updateOne({ _id: req.user.id }, { $inc: { credits: CREDIT_COST } });
      await ExhibitorEnquiry.updateOne(
        { _id: enquiry._id, deliveryStatus: 'pending' },
        { $set: { deliveryStatus: 'failed', creditsRefunded: CREDIT_COST, sendLockUntil: null } }
      );
    }
    return next(error);
  }
});

router.post('/:id/cancel', protect, authorize(...ORGANIZER_ROLES), async (req, res, next) => {
  try {
    const now = new Date();
    const cancellable = {
      _id: req.params.id,
      organizer: req.user.id,
      deliveryStatus: 'pending',
      deletedAt: null,
      $or: [{ sendLockUntil: null }, { sendLockUntil: { $lte: now } }]
    };
    const pending = await ExhibitorEnquiry.findOne(cancellable).select('creditsCharged creditsRefunded');
    if (!pending) {
      return res.status(409).json({
        success: false,
        error: 'Only a pending enquiry that is not actively being sent can be canceled.'
      });
    }
    const refundAmount = Math.max(
      0,
      Number(pending.creditsCharged || 0) - Number(pending.creditsRefunded || 0)
    );
    const enquiry = await ExhibitorEnquiry.findOneAndUpdate(
      cancellable,
      {
        $set: {
          deliveryStatus: 'canceled',
          creditsRefunded: Number(pending.creditsRefunded || 0) + refundAmount,
          sendLockUntil: null
        }
      },
      { new: true }
    );
    if (!enquiry) {
      return res.status(409).json({
        success: false,
        error: 'Only a pending enquiry that is not actively being sent can be canceled.'
      });
    }
    if (refundAmount > 0) {
      await User.updateOne({ _id: req.user.id }, { $inc: { credits: refundAmount } });
    }
    const user = await User.findById(req.user.id).select('credits');
    return res.status(200).json({
      success: true,
      data: { enquiry: toEnquiryResponse(enquiry), remainingCredits: user?.credits }
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', protect, authorize(...ORGANIZER_ROLES), async (req, res, next) => {
  try {
    const enquiry = await ExhibitorEnquiry.findOneAndUpdate(
      { _id: req.params.id, organizer: req.user.id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { new: true }
    ).lean();
    if (!enquiry) return res.status(404).json({ success: false, error: 'Enquiry not found.' });
    return res.status(200).json({
      success: true,
      message: 'Enquiry removed from your active list. Delivery and credit history were retained.'
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/sent', protect, authorize(...ORGANIZER_ROLES), async (req, res, next) => {
  try {
    const query = { organizer: req.user.id, deletedAt: null };
    if (req.query.archived === 'true') query.archivedAt = { $ne: null };
    else query.archivedAt = null;
    if (req.query.country) {
      const country = String(req.query.country).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.exhibitorCountry = new RegExp(country, 'i');
    }
    if (req.query.type) query.inquiryType = String(req.query.type);
    if (req.query.dateFrom || req.query.dateTo) {
      query.sentAt = {};
      if (req.query.dateFrom) query.sentAt.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) {
        const dateTo = new Date(req.query.dateTo);
        dateTo.setHours(23, 59, 59, 999);
        query.sentAt.$lte = dateTo;
      }
    }

    const legacyQuery = {
      source: 'exhibitor_discovery',
      email: String(req.user.email || '').toLowerCase()
    };
    if (query.sentAt) {
      legacyQuery.createdAt = {};
      if (query.sentAt.$gte) legacyQuery.createdAt.$gte = query.sentAt.$gte;
      if (query.sentAt.$lte) legacyQuery.createdAt.$lte = query.sentAt.$lte;
    }

    const [enquiries, allEnquiries, legacyRecords] = await Promise.all([
      ExhibitorEnquiry.find(query).sort({ sentAt: -1 }).lean(),
      ExhibitorEnquiry.find({ organizer: req.user.id }).lean(),
      query.archivedAt ? [] : ContactMessage.find(legacyQuery).sort({ createdAt: -1 }).lean()
    ]);
    const currentItems = enquiries.map(toEnquiryResponse);
    const legacyItems = legacyRecords.map((record) => ({
      _id: `legacy-${record._id}`,
      isLegacy: true,
      organizerName: record.name,
      organizerEmail: record.email,
      organizerCompany: record.meta?.senderCompany || '',
      exhibitorId: record.meta?.exhibitorId || '',
      exhibitorName: record.meta?.exhibitorName || 'Exhibitor',
      exhibitorContactPerson: '',
      exhibitorEmail: record.meta?.exhibitorEmail || '',
      exhibitorPhone: '',
      exhibitorCountry: record.meta?.country || '',
      exhibitorWebsite: '',
      exhibitorIndustry: record.meta?.industry || '',
      exhibitorLogo: record.meta?.exhibitorLogo || '',
      inquiryType: record.meta?.inquiryType || 'B2B Trade Partnership',
      messages: [{
        _id: String(record._id),
        senderRole: 'organizer',
        senderName: record.name,
        senderEmail: record.email,
        message: record.message,
        sentAt: record.createdAt,
        deliveryStatus: 'unknown'
      }],
      creditsCharged: Number(record.meta?.creditsCharged || 0),
      deliveryStatus: 'unknown',
      sentAt: record.createdAt,
      viewedAt: null,
      firstReplyAt: null,
      status: 'legacy',
      responseStatus: 'unknown',
      archivedAt: null
    }));
    const items = [...currentItems, ...legacyItems].sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const statusFilter = String(req.query.status || '').toLowerCase();
    const filteredItems = statusFilter
      ? items.filter((item) => statusFilter === 'pending'
        ? item.responseStatus === 'pending'
        : item.status === statusFilter)
      : items;

    const successful = allEnquiries
      .filter((item) => item.deliveryStatus === 'delivered')
      .map(toEnquiryResponse);
    const replied = successful.filter((item) => item.firstReplyAt || item.acceptedAt || item.rejectedAt);
    const stats = {
      totalSent: successful.length,
      delivered: successful.length,
      viewed: successful.filter((item) => item.viewedAt).length,
      replied: successful.filter((item) => item.firstReplyAt && !item.acceptedAt && !item.rejectedAt).length,
      accepted: successful.filter((item) => item.acceptedAt).length,
      rejected: successful.filter((item) => item.rejectedAt).length,
      pending: successful.filter((item) => item.responseStatus === 'pending').length,
      creditsSpent: allEnquiries.reduce(
        (total, item) => total + Math.max(0, Number(item.creditsCharged || 0) - Number(item.creditsRefunded || 0)),
        0
      ),
      responseRate: successful.length ? Math.round((replied.length / successful.length) * 100) : 0
    };

    return res.status(200).json({ success: true, data: { enquiries: filteredItems, stats } });
  } catch (error) {
    return next(error);
  }
});

router.get('/received', protect, authorize('exhibitor'), async (req, res, next) => {
  try {
    const recipientQuery = {
      exhibitorEmail: String(req.user.email || '').toLowerCase(),
      deliveryStatus: 'delivered'
    };
    await ExhibitorEnquiry.updateMany(
      { ...recipientQuery, viewedAt: null },
      { $set: { viewedAt: new Date() } }
    );
    const enquiries = await ExhibitorEnquiry.find(recipientQuery).sort({ sentAt: -1 }).lean();
    return res.status(200).json({
      success: true,
      data: { enquiries: enquiries.map(toEnquiryResponse) }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', protect, async (req, res, next) => {
  try {
    const enquiry = await ExhibitorEnquiry.findById(req.params.id).lean();
    if (!enquiry) return res.status(404).json({ success: false, error: 'Enquiry not found.' });

    const isOrganizer = isOrganizerOwner(enquiry, req.user.id) && ORGANIZER_ROLES.includes(req.user.role);
    const isExhibitor = req.user.role === 'exhibitor' && isExhibitorRecipient(enquiry, req.user.email);
    if (isOrganizer && enquiry.deletedAt) {
      return res.status(404).json({ success: false, error: 'Enquiry not found.' });
    }
    if (!isOrganizer && !isExhibitor) {
      return res.status(403).json({ success: false, error: 'You are not authorized to view this enquiry.' });
    }
    if (enquiry.deliveryStatus === 'draft' && !isOrganizer) {
      return res.status(404).json({ success: false, error: 'Enquiry not found.' });
    }
    return res.status(200).json({ success: true, data: { enquiry: toEnquiryResponse(enquiry) } });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/messages', protect, async (req, res, next) => {
  try {
    const validationError = validateMessage(req.body.message);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const enquiry = await ExhibitorEnquiry.findById(req.params.id);
    if (!enquiry) return res.status(404).json({ success: false, error: 'Enquiry not found.' });

    const senderRole = ORGANIZER_ROLES.includes(req.user.role) ? 'organizer' : req.user.role;
    const isOrganizer = senderRole === 'organizer' && isOrganizerOwner(enquiry, req.user.id);
    const isExhibitor = senderRole === 'exhibitor' && isExhibitorRecipient(enquiry, req.user.email);
    if (isOrganizer && enquiry.deletedAt) {
      return res.status(404).json({ success: false, error: 'Enquiry not found.' });
    }
    if (!isOrganizer && !isExhibitor) {
      return res.status(403).json({ success: false, error: 'You are not authorized to reply to this enquiry.' });
    }
    if (enquiry.deliveryStatus !== 'delivered') {
      return res.status(409).json({ success: false, error: 'Only delivered enquiries can have a conversation.' });
    }

    const sender = await User.findById(req.user.id).select('name email');
    if (!sender) return res.status(404).json({ success: false, error: 'Your account could not be found.' });

    let trackingToken;
    if (isOrganizer) {
      trackingToken = makeTrackingToken();
      enquiry.trackingTokenHashes.push(hashTrackingToken(trackingToken));
    }

    const message = {
      senderRole,
      senderId: sender._id,
      senderName: sender.name,
      senderEmail: sender.email,
      message: req.body.message.trim(),
      sentAt: new Date()
    };
    enquiry.messages.push(message);
    if (isExhibitor) {
      enquiry.firstReplyAt = enquiry.firstReplyAt || message.sentAt;
      enquiry.followUpDueAt = null;
      enquiry.reminderClaimedAt = null;
      enquiry.reminderSentAt = null;
    } else {
      enquiry.followUpDueAt = addBusinessDays(message.sentAt, 4);
      enquiry.reminderClaimedAt = null;
      enquiry.reminderSentAt = null;
    }
    await enquiry.save();

    const emailResult = await sendEnquiryEmail({
      enquiry,
      message: message.message,
      senderRole,
      trackingUrl: trackingToken ? getPixelUrl(enquiry._id, trackingToken) : undefined
    });
    await ExhibitorEnquiry.updateOne(
      { _id: enquiry._id, 'messages._id': message._id },
      { $set: { 'messages.$.deliveryStatus': emailResult.success ? 'delivered' : 'failed' } }
    );

    if (isExhibitor) {
      await Notification.create({
        user: enquiry.organizer,
        title: `New reply from ${enquiry.exhibitorName}`,
        message: `${sender.name} replied to your exhibitor enquiry.`,
        type: 'in_app',
        metadata: {
          eventType: 'exhibitor_enquiry_reply',
          enquiryId: enquiry._id,
          url: `${CLIENT_URL}/campaigns/exhibitor-discovery`
        }
      });
    }

    return res.status(201).json({
      success: true,
      data: {
        enquiry: toEnquiryResponse(await ExhibitorEnquiry.findById(enquiry._id).lean()),
        emailDelivered: emailResult.success
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/follow-up', protect, authorize(...ORGANIZER_ROLES), async (req, res, next) => {
  try {
    const enquiry = await ExhibitorEnquiry.findOne({
      _id: req.params.id,
      organizer: req.user.id,
      deletedAt: null
    });
    if (!enquiry) return res.status(404).json({ success: false, error: 'Enquiry not found.' });
    if (enquiry.deliveryStatus !== 'delivered') {
      return res.status(409).json({ success: false, error: 'Only delivered enquiries can be followed up.' });
    }
    if (enquiry.firstReplyAt || enquiry.acceptedAt || enquiry.rejectedAt) {
      return res.status(409).json({ success: false, error: 'This enquiry has already received a response.' });
    }
    req.body.message = String(req.body.message || `Following up on my enquiry about ${enquiry.inquiryType}. Please let me know if you would like to discuss this further.`);
    const validationError = validateMessage(req.body.message);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const sender = await User.findById(req.user.id).select('name email');
    if (!sender) return res.status(404).json({ success: false, error: 'Your account could not be found.' });
    const trackingToken = makeTrackingToken();
    enquiry.trackingTokenHashes.push(hashTrackingToken(trackingToken));
    const message = {
      senderRole: 'organizer',
      senderId: sender._id,
      senderName: sender.name,
      senderEmail: sender.email,
      message: req.body.message.trim(),
      sentAt: new Date()
    };
    enquiry.messages.push(message);
    enquiry.followUpDueAt = addBusinessDays(message.sentAt, 4);
    enquiry.reminderClaimedAt = null;
    enquiry.reminderSentAt = null;
    await enquiry.save();

    const emailResult = await sendEnquiryEmail({
      enquiry,
      message: message.message,
      senderRole: 'organizer',
      trackingUrl: getPixelUrl(enquiry._id, trackingToken)
    });
    await ExhibitorEnquiry.updateOne(
      { _id: enquiry._id, 'messages._id': message._id },
      { $set: { 'messages.$.deliveryStatus': emailResult.success ? 'delivered' : 'failed' } }
    );

    return res.status(emailResult.success ? 201 : 502).json({
      success: emailResult.success,
      error: emailResult.success ? undefined : 'The follow-up email could not be accepted by the mail server.',
      data: {
        enquiry: toEnquiryResponse(await ExhibitorEnquiry.findById(enquiry._id).lean()),
        emailDelivered: emailResult.success
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/decision', protect, authorize('exhibitor'), async (req, res, next) => {
  try {
    const decision = String(req.body.decision || '').toLowerCase();
    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, error: 'Decision must be accepted or rejected.' });
    }
    const enquiry = await ExhibitorEnquiry.findOne({
      _id: req.params.id,
      exhibitorEmail: String(req.user.email || '').toLowerCase(),
      deliveryStatus: 'delivered'
    });
    if (!enquiry) return res.status(404).json({ success: false, error: 'Enquiry not found.' });

    const now = new Date();
    enquiry.acceptedAt = decision === 'accepted' ? now : null;
    enquiry.rejectedAt = decision === 'rejected' ? now : null;
    enquiry.firstReplyAt = enquiry.firstReplyAt || now;
    enquiry.followUpDueAt = null;
    enquiry.reminderClaimedAt = null;
    enquiry.reminderSentAt = null;
    await enquiry.save();

    await Notification.create({
      user: enquiry.organizer,
      title: `Enquiry ${decision} by ${enquiry.exhibitorName}`,
      message: `${enquiry.exhibitorName} ${decision} your enquiry.`,
      type: 'in_app',
      metadata: {
        eventType: `exhibitor_enquiry_${decision}`,
        enquiryId: enquiry._id,
        url: `${CLIENT_URL}/campaigns/exhibitor-discovery`
      }
    });

    const emailResult = await sendEmail({
      to: enquiry.organizerEmail,
      subject: `Enquiry ${decision}: ${enquiry.exhibitorName}`,
      text: `${enquiry.exhibitorName} ${decision} your enquiry.`,
      html: `<p>${escapeHtml(enquiry.exhibitorName)} ${decision} your enquiry.</p><p><a href="${CLIENT_URL}/campaigns/exhibitor-discovery">View enquiry conversation</a></p>`
    });
    if (!emailResult.success) {
      console.warn(`[ExhibitorEnquiry] Decision email notification failed for ${enquiry._id}: ${emailResult.error}`);
    }

    return res.status(200).json({ success: true, data: { enquiry: toEnquiryResponse(enquiry) } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/archive', protect, authorize(...ORGANIZER_ROLES), async (req, res, next) => {
  try {
    const archivedAt = req.body.archived === false ? null : new Date();
    const enquiry = await ExhibitorEnquiry.findOneAndUpdate(
      { _id: req.params.id, organizer: req.user.id, deletedAt: null },
      { $set: { archivedAt } },
      { new: true }
    ).lean();
    if (!enquiry) return res.status(404).json({ success: false, error: 'Enquiry not found.' });
    return res.status(200).json({ success: true, data: { enquiry: toEnquiryResponse(enquiry) } });
  } catch (error) {
    return next(error);
  }
});

export default router;
