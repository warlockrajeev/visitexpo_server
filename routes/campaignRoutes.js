/**
 * @file campaignRoutes.js
 * @description Marketing campaigns routing and broadcast simulator.
 */

import express from 'express';
import Campaign from '../models/Campaign.js';
import Visitor from '../models/Visitor.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// Require organizer/manager auth
router.use(protect);
router.use(authorize('super_admin', 'organizer', 'event_manager', 'marketing_manager'));

// @desc    Get all campaigns for an event
// @route   GET /api/campaigns
router.get('/', async (req, res, next) => {
  try {
    const { eventId } = req.query;

    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Event ID parameter is required' });
    }

    const campaigns = await Campaign.find({ event: eventId })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: campaigns
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Create marketing campaign draft
// @route   POST /api/campaigns
router.post('/', async (req, res, next) => {
  try {
    const { eventId, title, channel, subject, body } = req.body;

    if (!eventId || !title || !channel || !body) {
      return res.status(400).json({
        success: false,
        error: 'Event ID, Campaign Title, Channel, and Body content are required'
      });
    }

    // Determine target recipient count based on active registrations
    const recipientCount = await Visitor.countDocuments({ event: eventId });

    const campaign = await Campaign.create({
      title,
      channel,
      status: 'draft',
      content: {
        subject: channel === 'email' ? (subject || title) : undefined,
        body
      },
      targetAudience: {
        recipientCount
      },
      event: eventId,
      createdBy: req.user.id
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

// @desc    Broadcast / Send Campaign (Simulated metrics generation)
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

    // Determine target count
    const recipientCount = await Visitor.countDocuments({ event: campaign.event });
    
    // Simulate campaign metrics based on channel
    let openRate = 0.25; // 25% avg
    let clickRate = 0.08; // 8% avg
    let convRate = 0.02; // 2% avg

    if (campaign.channel === 'whatsapp') {
      openRate = 0.90; // 90% WhatsApp open
      clickRate = 0.20;
      convRate = 0.05;
    } else if (campaign.channel === 'sms') {
      openRate = 0.70;
      clickRate = 0.05;
      convRate = 0.01;
    }

    const sentCount = recipientCount || 12; // Fallback to 12 if no visitors registered
    const openCount = Math.round(sentCount * openRate);
    const clickCount = Math.round(openCount * (clickRate / openRate));
    const conversionCount = Math.round(clickCount * (convRate / clickRate));

    // Update status to Completed and save simulated figures
    campaign.status = 'completed';
    campaign.targetAudience.recipientCount = sentCount;
    campaign.sentCount = sentCount;
    campaign.openCount = openCount;
    campaign.clickCount = clickCount;
    campaign.conversionCount = conversionCount;

    await campaign.save();

    res.status(200).json({
      success: true,
      message: 'Campaign broadcast simulation completed successfully',
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
