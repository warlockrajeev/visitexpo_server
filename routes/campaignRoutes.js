/**
 * @file campaignRoutes.js
 * @description Marketing campaigns routing, Growth Plan email promotions, and audience dispatch.
 */

import express from 'express';
import Campaign from '../models/Campaign.js';
import Event from '../models/Event.js';
import { protect, authorize } from '../middlewares/auth.js';
import {
  hasGrowthPromotionAccess,
  getTargetAudienceForEvent
} from '../services/promotionAudienceService.js';
import {
  sendPromotionEmail,
  dispatchCampaignBatch,
  buildPromotionEmailHtml,
  getPromotionTrackingBaseUrl
} from '../services/promotionEmailService.js';
import campaignTrackingRoutes from './campaignTrackingRoutes.js';

const router = express.Router();

const withCampaignAnalytics = (campaign) => {
  const data = campaign.toObject ? campaign.toObject() : campaign;
  const recipients = data.recipientsLog || [];
  const deliveredRecipients = recipients.filter((recipient) => recipient.status === 'sent');
  const uniqueDeliveredEmails = new Set(
    deliveredRecipients.map((recipient) => recipient.email.toLowerCase())
  );

  return {
    ...data,
    sentCount: deliveredRecipients.length,
    deliveredCount: deliveredRecipients.length,
    failedCount: recipients.filter((recipient) => recipient.status === 'failed').length,
    openCount: deliveredRecipients.filter((recipient) => recipient.openedAt).length,
    clickCount: deliveredRecipients.filter((recipient) => recipient.clickedAt).length,
    conversionCount: deliveredRecipients.reduce(
      (count, recipient) => count + (recipient.conversionOrderIds?.length || (recipient.convertedAt ? 1 : 0)),
      0
    ),
    targetAudience: {
      ...data.targetAudience,
      recipientCount: data.status === 'draft'
        ? (data.targetAudience?.recipientCount || 0)
        : uniqueDeliveredEmails.size
    },
    recipientsLog: recipients.map((recipient) => {
      const safeRecipient = { ...recipient };
      delete safeRecipient.trackingTokenHash;
      delete safeRecipient.conversionOrderIds;
      return safeRecipient;
    })
  };
};

const persistRecipientResult = async (campaignId, recipient) => {
  const increments = recipient.status === 'sent'
    ? { sentCount: 1, deliveredCount: 1 }
    : { failedCount: 1 };
  const result = await Campaign.updateOne(
    { _id: campaignId, status: 'sending' },
    { $push: { recipientsLog: recipient }, $inc: increments }
  );

  if (result.matchedCount !== 1) {
    throw new Error('Campaign stopped while recipient delivery was in progress');
  }
};

const dispatchAndPersistCampaign = async ({ campaign, event, organizer, recipients }) => {
  let batchResult;
  try {
    batchResult = await dispatchCampaignBatch({
      campaign,
      event,
      organizer,
      recipients,
      delayMs: 250,
      trackingBaseUrl: getPromotionTrackingBaseUrl(),
      onRecipientResult: (recipient) => persistRecipientResult(campaign._id, recipient)
    });
  } catch (error) {
    await Campaign.updateOne(
      { _id: campaign._id, status: 'sending' },
      { $set: { status: 'failed', sentAt: new Date() } }
    );
    throw error;
  }

  const updatedCampaign = await Campaign.findByIdAndUpdate(
    campaign._id,
    {
      $set: {
        status: batchResult.deliveredCount > 0 ? 'completed' : 'failed',
        sentAt: new Date()
      }
    },
    { new: true }
  ).select('+recipientsLog.conversionOrderIds');

  return {
    batchResult,
    campaign: withCampaignAnalytics(updatedCampaign)
  };
};


router.use('/track', campaignTrackingRoutes);

// Require organizer/manager auth
router.use(protect);
router.use(authorize('super_admin', 'organizer', 'event_manager', 'marketing_manager', 'admin'));

// @desc    Check whether logged-in organizer has Growth Plan access for email promotions
// @route   GET /api/campaigns/growth-access
router.get('/growth-access', async (req, res, next) => {
  try {
    const hasGrowth = await hasGrowthPromotionAccess(req.user);
    res.status(200).json({
      success: true,
      hasGrowthPlan: hasGrowth,
      plan: req.user.plan || 'free',
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        plan: req.user.plan
      },
      features: {
        emailPromotions: hasGrowth,
        customSMTP: 'promotion@client.visitexpo.in',
        targetAudiences: ['leads', 'visitors', 'followers', 'interested']
      }
    });
  } catch (error) {
    next(error);
  }
});

router.use(async (req, res, next) => {
  try {
    if (!(await hasGrowthPromotionAccess(req.user))) {
      return res.status(403).json({
        success: false,
        error: 'Growth Plan Required',
        message: 'Marketing Campaigns are available only with an active Growth Plan add-on.'
      });
    }
    next();
  } catch (error) {
    next(error);
  }
});

// @desc    Get Target Audience count and breakdown for an event
// @route   GET /api/campaigns/target-audience
router.get('/target-audience', async (req, res, next) => {
  try {
    const { eventId, audiences } = req.query;

    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Event ID parameter is required' });
    }

    const audienceTypes = audiences
      ? audiences.split(',').map(s => s.trim().toLowerCase())
      : ['leads', 'visitors', 'followers', 'interested'];

    const audienceData = await getTargetAudienceForEvent({
      organizerUser: req.user,
      eventId,
      audienceTypes
    });

    res.status(200).json({
      success: true,
      data: audienceData
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Send a single test promotional email to organizer's test inbox
// @route   POST /api/campaigns/send-test
router.post('/send-test', async (req, res, next) => {
  try {
    const hasGrowth = await hasGrowthPromotionAccess(req.user);
    if (!hasGrowth) {
      return res.status(403).json({
        success: false,
        error: 'Growth Plan Required',
        message: 'Promotional Email Broadcasting is exclusively available on the Organizer Growth Plan.'
      });
    }

    const {
      eventId,
      title,
      subject,
      preheader,
      headline,
      body,
      ctaText,
      ctaUrl,
      bannerUrl,
      templateType,
      testEmail
    } = req.body;

    const targetEmail = testEmail || req.user.email;
    if (!targetEmail || !body) {
      return res.status(400).json({
        success: false,
        error: 'Target test email and body content are required'
      });
    }

    let event = null;
    if (eventId) {
      event = await Event.findById(eventId);
    }

    const campaignMock = {
      title: title || 'Test Campaign Preview',
      content: {
        subject: subject || title || 'Test Promotion Preview',
        preheader: preheader || 'Test Preview',
        headline: headline || subject || 'Exhibition Preview',
        body,
        ctaText: ctaText || 'View Exhibition Passes',
        ctaUrl,
        bannerUrl,
        templateType: templateType || 'modern'
      }
    };

    const html = buildPromotionEmailHtml({
      campaign: campaignMock,
      event,
      organizer: req.user,
      recipientName: req.user.name || 'Organizer Preview',
      recipientType: 'test'
    });

    const sendRes = await sendPromotionEmail({
      to: targetEmail,
      subject: `[TEST PREVIEW] ${subject || title || 'VisitExpo Promotion'}`,
      html,
      replyTo: req.user.email
    });

    if (!sendRes.success) {
      return res.status(500).json({
        success: false,
        error: `Failed to dispatch test email: ${sendRes.error}`
      });
    }

    res.status(200).json({
      success: true,
      message: `Test preview email successfully delivered to ${targetEmail} via promotion@client.visitexpo.in`,
      messageId: sendRes.messageId
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Dispatch live Promotional Email Campaign to target audience (Leads, Visitors, Followers, Interested)
// @route   POST /api/campaigns/send-promotion
router.post('/send-promotion', async (req, res, next) => {
  try {
    const hasGrowth = await hasGrowthPromotionAccess(req.user);
    if (!hasGrowth) {
      return res.status(403).json({
        success: false,
        error: 'Growth Plan Required',
        message: 'Promotional Email Broadcasting to leads, visitors, and followers is an exclusive Growth Plan feature.'
      });
    }

    const {
      eventId,
      title,
      subject,
      preheader,
      headline,
      body,
      ctaText,
      ctaUrl,
      bannerUrl,
      templateType,
      audienceTypes = ['leads', 'visitors', 'followers', 'interested']
    } = req.body;

    if (!eventId || !title || !body) {
      return res.status(400).json({
        success: false,
        error: 'Event ID, Campaign Title, and Message Body are required'
      });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // 1. Gather and deduplicate recipients across selected audiences
    const audienceData = await getTargetAudienceForEvent({
      organizerUser: req.user,
      eventId,
      audienceTypes
    });

    if (!audienceData.recipients || audienceData.recipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No recipients found matching selected audiences for this exhibition. Add leads or visitors first.'
      });
    }

    // 2. Create Campaign in DB with sending state
    const campaign = await Campaign.create({
      title,
      channel: 'email',
      status: 'sending',
      content: {
        subject: subject || title,
        preheader: preheader || '',
        headline: headline || subject || title,
        body,
        ctaText: ctaText || 'View Exhibition Passes',
        ctaUrl: ctaUrl || '',
        bannerUrl: bannerUrl || event.bannerImage || '',
        templateType: templateType || 'modern'
      },
      targetAudience: {
        audienceTypes,
        recipientCount: audienceData.totalUnique,
        breakdown: audienceData.breakdown
      },
      senderEmail: process.env.PROMOTION_SMTP_USER || 'promotion@client.visitexpo.in',
      senderHost: process.env.PROMOTION_SMTP_HOST || 'nexus.herosite.pro',
      isGrowthPlanPromotion: true,
      event: eventId,
      createdBy: req.user._id
    });

    // 3. Dispatch batch through promotion@client.visitexpo.in
    const { batchResult, campaign: campaignAnalytics } = await dispatchAndPersistCampaign({
      campaign,
      event,
      organizer: req.user,
      recipients: audienceData.recipients
    });

    res.status(201).json({
      success: true,
      message: `Promotional email campaign dispatched! Successfully delivered to ${batchResult.deliveredCount} recipients.`,
      campaign: {
        ...campaignAnalytics,
        senderEmail: campaign.senderEmail,
        recipientsSummary: batchResult.recipientsLog.map(r => ({
          name: r.name,
          email: r.email,
          audienceType: r.audienceType,
          status: r.status
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get all campaigns (optionally filtered by eventId or organizer)
// @route   GET /api/campaigns
router.get('/', async (req, res, next) => {
  try {
    const { eventId } = req.query;
    const filter = {};

    if (eventId) {
      filter.event = eventId;
    }

    // Organizers only see their own campaigns unless super_admin / admin
    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
      filter.createdBy = req.user._id;
    }

    const campaigns = await Campaign.find(filter)
      .select('+recipientsLog.conversionOrderIds')
      .populate('createdBy', 'name email company')
      .populate('event', 'title slug city bannerImage dates')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: campaigns.map(withCampaignAnalytics)
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get single campaign with full recipient delivery log
// @route   GET /api/campaigns/:id
router.get('/:id', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .select('+recipientsLog.conversionOrderIds')
      .populate('createdBy', 'name email company organization plan')
      .populate('event', 'title slug city venue dates bannerImage');

    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    // Authorization check
    if (
      req.user.role !== 'super_admin' &&
      req.user.role !== 'admin' &&
      campaign.createdBy._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    res.status(200).json({
      success: true,
      data: withCampaignAnalytics(campaign)
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Create marketing campaign draft
// @route   POST /api/campaigns
router.post('/', async (req, res, next) => {
  try {
    const { eventId, title, channel = 'email', subject, body } = req.body;

    const trimmedTitle = String(title || '').trim();
    const trimmedBody = String(body || '').trim();

    if (!eventId || !trimmedTitle || !trimmedBody) {
      return res.status(400).json({
        success: false,
        error: 'Event ID, Campaign Title, and Body content are required'
      });
    }

    if (channel !== 'email') {
      return res.status(400).json({
        success: false,
        error: 'Only email campaigns are supported because delivery and engagement tracking require email events.'
      });
    }

    if (trimmedTitle.length < 3 || !/[a-zA-Z0-9]/.test(trimmedTitle)) {
      return res.status(400).json({
        success: false,
        error: 'Campaign Title must be at least 3 characters and contain letters or numbers'
      });
    }

    if (channel === 'email' && subject) {
      const trimmedSubject = String(subject).trim();
      if (trimmedSubject && (trimmedSubject.length < 3 || !/[a-zA-Z0-9]/.test(trimmedSubject))) {
        return res.status(400).json({
          success: false,
          error: 'Subject Line must be at least 3 characters and contain letters or numbers'
        });
      }
    }

    if (trimmedBody.length < 10 || !/[a-zA-Z0-9]/.test(trimmedBody)) {
      return res.status(400).json({
        success: false,
        error: 'Message Body must be at least 10 characters and contain readable text'
      });
    }

    const audienceTypes = ['leads', 'visitors', 'followers', 'interested'];
    const audienceData = await getTargetAudienceForEvent({
      organizerUser: req.user,
      eventId,
      audienceTypes
    });

    const campaign = await Campaign.create({
      title: trimmedTitle,
      channel,
      status: 'draft',
      content: {
        subject: (subject && String(subject).trim()) || trimmedTitle,
        body: trimmedBody
      },
      targetAudience: {
        audienceTypes,
        recipientCount: audienceData.totalUnique,
        breakdown: audienceData.breakdown
      },
      event: eventId,
      createdBy: req.user._id
    });

    res.status(201).json({
      success: true,
      message: 'Campaign draft created successfully',
      campaign
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Send an email campaign and record recipient delivery/engagement events
// @route   POST /api/campaigns/:id/send
router.post('/:id/send', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    if (
      req.user.role !== 'super_admin' &&
      req.user.role !== 'admin' &&
      campaign.createdBy.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (campaign.status !== 'draft') {
      return res.status(400).json({ success: false, error: 'Only draft campaigns can be sent.' });
    }
    if (campaign.channel !== 'email') {
      return res.status(400).json({
        success: false,
        error: 'Only email campaigns can be sent because other delivery channels are not configured.'
      });
    }

    const event = await Event.findById(campaign.event);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Campaign event not found' });
    }

    const audienceTypes = campaign.targetAudience?.audienceTypes?.length
      ? campaign.targetAudience.audienceTypes
      : ['leads', 'visitors', 'followers', 'interested'];
    const audienceData = await getTargetAudienceForEvent({
      organizerUser: req.user,
      eventId: campaign.event,
      audienceTypes
    });

    if (!audienceData.recipients.length) {
      return res.status(400).json({
        success: false,
        error: 'No eligible email recipients were found for this campaign.'
      });
    }

    const sendingCampaign = await Campaign.findOneAndUpdate(
      { _id: campaign._id, status: 'draft' },
      {
        $set: {
          status: 'sending',
          'targetAudience.recipientCount': audienceData.totalUnique,
          'targetAudience.breakdown': audienceData.breakdown,
          'targetAudience.audienceTypes': audienceTypes
        }
      },
      { new: true }
    );
    if (!sendingCampaign) {
      return res.status(409).json({ success: false, error: 'Campaign is no longer available to send.' });
    }

    const { campaign: campaignAnalytics, batchResult } = await dispatchAndPersistCampaign({
      campaign: sendingCampaign,
      event,
      organizer: req.user,
      recipients: audienceData.recipients
    });

    res.status(200).json({
      success: true,
      message: `Campaign dispatch completed for ${batchResult.deliveredCount} recipients.`,
      campaign: campaignAnalytics
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete campaign draft
// @route   DELETE /api/campaigns/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    if (
      req.user.role !== 'super_admin' &&
      campaign.createdBy.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (campaign.status === 'sending') {
      return res.status(409).json({ success: false, error: 'Campaign delivery is still in progress.' });
    }

    await Campaign.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Campaign deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
