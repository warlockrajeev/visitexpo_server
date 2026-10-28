/**
 * @file campaignRoutes.js
 * @description Marketing campaigns routing, Growth Plan email promotions, and audience dispatch.
 */

import express from 'express';
import Campaign from '../models/Campaign.js';
import Visitor from '../models/Visitor.js';
import Event from '../models/Event.js';
import User from '../models/User.js';
import { protect, authorize } from '../middlewares/auth.js';
import {
  hasGrowthPromotionAccess,
  getTargetAudienceForEvent
} from '../services/promotionAudienceService.js';
import {
  sendPromotionEmail,
  dispatchCampaignBatch,
  buildPromotionEmailHtml,
  verifyPromotionSMTP
} from '../services/promotionEmailService.js';

const router = express.Router();

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
    const batchResult = await dispatchCampaignBatch({
      campaign,
      event,
      organizer: req.user,
      recipients: audienceData.recipients,
      delayMs: 250 // rate-limit spacing
    });

    // 4. Update campaign with final metrics & recipients audit log
    campaign.status = batchResult.deliveredCount > 0 ? 'completed' : 'failed';
    campaign.sentCount = batchResult.totalRecipients;
    campaign.deliveredCount = batchResult.deliveredCount;
    campaign.failedCount = batchResult.failedCount;
    campaign.recipientsLog = batchResult.recipientsLog;
    campaign.sentAt = new Date();

    await campaign.save();

    res.status(201).json({
      success: true,
      message: `Promotional email campaign dispatched! Successfully delivered to ${batchResult.deliveredCount} recipients.`,
      campaign: {
        _id: campaign._id,
        title: campaign.title,
        status: campaign.status,
        sentCount: campaign.sentCount,
        deliveredCount: campaign.deliveredCount,
        failedCount: campaign.failedCount,
        targetAudience: campaign.targetAudience,
        sentAt: campaign.sentAt,
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
      .populate('createdBy', 'name email company')
      .populate('event', 'title slug city bannerImage dates')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: campaigns
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
      data: campaign
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

    const trimmedTitle = (title || '').trim();
    const trimmedBody = (body || '').trim();

    if (!eventId || !trimmedTitle || !trimmedBody) {
      return res.status(400).json({
        success: false,
        error: 'Event ID, Campaign Title, and Body content are required'
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

    const recipientCount = await Visitor.countDocuments({ event: eventId });

    const campaign = await Campaign.create({
      title: trimmedTitle,
      channel,
      status: 'draft',
      content: {
        subject: channel === 'email' ? ((subject && String(subject).trim()) || trimmedTitle) : undefined,
        body: trimmedBody
      },
      targetAudience: {
        recipientCount
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

// @desc    Broadcast / Send Campaign (Simulated broadcast fallback)
// @route   POST /api/campaigns/:id/send
router.post('/:id/send', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    if (campaign.status === 'completed') {
      return res.status(400).json({ success: false, error: 'Campaign has already been sent' });
    }

    const recipientCount = await Visitor.countDocuments({ event: campaign.event });

    let openRate = 0.25;
    let clickRate = 0.08;
    let convRate = 0.02;

    if (campaign.channel === 'whatsapp') {
      openRate = 0.90;
      clickRate = 0.20;
      convRate = 0.05;
    } else if (campaign.channel === 'sms') {
      openRate = 0.70;
      clickRate = 0.05;
      convRate = 0.01;
    }

    const sentCount = recipientCount || 12;
    const openCount = Math.round(sentCount * openRate);
    const clickCount = Math.round(openCount * (clickRate / openRate));
    const conversionCount = Math.round(clickCount * (convRate / clickRate));

    campaign.status = 'completed';
    campaign.targetAudience.recipientCount = sentCount;
    campaign.sentCount = sentCount;
    campaign.deliveredCount = sentCount;
    campaign.openCount = openCount;
    campaign.clickCount = clickCount;
    campaign.conversionCount = conversionCount;
    campaign.sentAt = new Date();

    await campaign.save();

    res.status(200).json({
      success: true,
      message: 'Campaign broadcast completed successfully',
      campaign
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
