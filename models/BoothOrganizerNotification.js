/**
 * @file BoothOrganizerNotification.js
 * @description Audit log for count-only Booth Request summary emails sent by Admin to Event Organizers.
 */

import mongoose from 'mongoose';

const BoothOrganizerNotificationSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      default: null,
      index: true
    },
    eventSlug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true
    },
    eventTitle: {
      type: String,
      required: true,
      trim: true
    },
    organizerName: {
      type: String,
      default: '',
      trim: true
    },
    organizerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true
    },
    countScope: {
      type: String,
      enum: ['all', 'stall'],
      default: 'all'
    },
    reportedCount: {
      type: Number,
      required: true,
      min: 0
    },
    totalRequestCount: {
      type: Number,
      default: 0,
      min: 0
    },
    stallCount: {
      type: Number,
      default: 0,
      min: 0
    },
    visitorPassCount: {
      type: Number,
      default: 0,
      min: 0
    },
    generalCount: {
      type: Number,
      default: 0,
      min: 0
    },
    subject: {
      type: String,
      default: '',
      trim: true
    },
    customNote: {
      type: String,
      default: '',
      trim: true
    },
    sentByAdmin: {
      type: String,
      default: 'admin',
      trim: true
    },
    status: {
      type: String,
      enum: ['sent', 'failed'],
      default: 'sent',
      index: true
    },
    messageId: {
      type: String,
      default: ''
    },
    errorMessage: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

BoothOrganizerNotificationSchema.index({ eventSlug: 1, createdAt: -1 });

export default mongoose.model('BoothOrganizerNotification', BoothOrganizerNotificationSchema);
