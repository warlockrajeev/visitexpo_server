/**
 * @file Campaign.js
 * @description Mongoose schema and model for Marketing Campaigns & Email Promotions.
 */

import mongoose from 'mongoose';

const RecipientLogSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    name: {
      type: String,
      default: ''
    },
    audienceType: {
      type: String,
      enum: ['lead', 'visitor', 'follower', 'interested', 'test', 'other'],
      default: 'visitor'
    },
    status: {
      type: String,
      enum: ['sent', 'failed'],
      default: 'sent'
    },
    error: {
      type: String,
      default: null
    },
    sentAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const CampaignSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Campaign title is required'],
      trim: true
    },
    channel: {
      type: String,
      enum: ['email', 'whatsapp', 'sms'],
      default: 'email',
      required: true
    },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sending', 'completed', 'failed'],
      default: 'draft',
      index: true
    },
    content: {
      subject: String, // For Email campaigns
      preheader: String, // Preview text snippet
      headline: String, // Prominent card title
      body: { type: String, required: true },
      ctaText: { type: String, default: 'View Exhibition Passes' },
      ctaUrl: { type: String, default: '' },
      bannerUrl: { type: String, default: '' },
      templateType: {
        type: String,
        enum: ['modern', 'invitation', 'showcase', 'earlybird', 'announcement', 'custom'],
        default: 'modern'
      }
    },
    targetAudience: {
      audienceTypes: {
        type: [String],
        default: ['leads', 'visitors', 'followers', 'interested']
      },
      recipientCount: { type: Number, default: 0 },
      breakdown: {
        leads: { type: Number, default: 0 },
        visitors: { type: Number, default: 0 },
        followers: { type: Number, default: 0 },
        interested: { type: Number, default: 0 }
      },
      filters: mongoose.Schema.Types.Mixed
    },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    openCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    conversionCount: { type: Number, default: 0 },
    senderEmail: {
      type: String,
      default: 'promotion@client.visitexpo.in'
    },
    senderHost: {
      type: String,
      default: 'nexus.herosite.pro'
    },
    isGrowthPlanPromotion: {
      type: Boolean,
      default: true,
      index: true
    },
    recipientsLog: [RecipientLogSchema],
    sentAt: {
      type: Date,
      default: null
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

CampaignSchema.index({ createdAt: -1 });
CampaignSchema.index({ createdBy: 1, createdAt: -1 });
CampaignSchema.index({ event: 1, createdAt: -1 });

export default mongoose.model('Campaign', CampaignSchema);
