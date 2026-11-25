/**
 * @file UserActivity.js
 * @description Mongoose schema and model for comprehensive platform-wide user activity tracking
 * (page visits, event card clicks, expo views, interest/follow/bookmark toggles, pass requests,
 * form interactions & submissions, search queries, and authentication events).
 */

import mongoose from 'mongoose';

const UserActivitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    sessionId: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    userName: {
      type: String,
      default: 'Guest Visitor',
      trim: true
    },
    userEmail: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
      index: true
    },
    userPhone: {
      type: String,
      default: '',
      trim: true
    },
    userRole: {
      type: String,
      default: 'guest',
      lowercase: true,
      trim: true,
      index: true
    },
    userCompany: {
      type: String,
      default: '',
      trim: true
    },
    activityType: {
      type: String,
      required: [true, 'Activity type is required'],
      trim: true,
      index: true
    },
    category: {
      type: String,
      default: 'navigation',
      trim: true,
      index: true
    },
    actionLabel: {
      type: String,
      required: [true, 'Action label is required'],
      trim: true
    },
    description: {
      type: String,
      default: '',
      trim: true
    },
    pagePath: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    pageTitle: {
      type: String,
      default: '',
      trim: true
    },
    referrerPath: {
      type: String,
      default: '',
      trim: true
    },
    targetEvent: {
      eventId: { type: String, default: '' },
      title: { type: String, default: '' },
      slug: { type: String, default: '', lowercase: true, trim: true },
      category: { type: String, default: '' },
      city: { type: String, default: '' }
    },
    formInfo: {
      formName: { type: String, default: '' },
      formId: { type: String, default: '' },
      status: { type: String, default: '' },
      fieldsSummary: { type: mongoose.Schema.Types.Mixed, default: null }
    },
    elementInfo: {
      tag: { type: String, default: '' },
      text: { type: String, default: '' },
      href: { type: String, default: '' },
      ariaLabel: { type: String, default: '' }
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    ipAddress: {
      type: String,
      default: ''
    },
    userAgent: {
      type: String,
      default: ''
    },
    source: {
      type: String,
      default: 'client_tracker',
      index: true
    },
    sourceRefId: {
      type: String,
      default: '',
      index: true
    }
  },
  {
    timestamps: true
  }
);

UserActivitySchema.index({ createdAt: -1 });
// Smart Partial TTL: automatically expire anonymous guest logs after 14 days while preserving registered user history
UserActivitySchema.index(
  { createdAt: 1 },
  {
    name: 'guest_activity_ttl_14d',
    expireAfterSeconds: 14 * 24 * 60 * 60,
    partialFilterExpression: { userRole: 'guest' }
  }
);
UserActivitySchema.index({ userEmail: 1, createdAt: -1 });
UserActivitySchema.index({ activityType: 1, createdAt: -1 });
UserActivitySchema.index({ 'targetEvent.slug': 1, createdAt: -1 });
UserActivitySchema.index({ pagePath: 1, createdAt: -1 });

export default mongoose.models.UserActivity || mongoose.model('UserActivity', UserActivitySchema);
