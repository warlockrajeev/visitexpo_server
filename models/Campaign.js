/**
 * @file Campaign.js
 * @description Mongoose schema and model for Marketing Campaigns.
 */

import mongoose from 'mongoose';

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
      body: { type: String, required: true }
    },
    targetAudience: {
      filters: mongoose.Schema.Types.Mixed, // Query filters for targets
      recipientCount: { type: Number, default: 0 }
    },
    sentCount: { type: Number, default: 0 },
    openCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    conversionCount: { type: Number, default: 0 },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Campaign', CampaignSchema);
