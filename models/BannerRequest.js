/**
 * @file BannerRequest.js
 * @description Mongoose model for Organizer Landing Page Banner Spotlight promotion requests and approvals.
 * Exclusive feature for Growth Plan Organizers.
 */

import mongoose from 'mongoose';

const BannerRequestSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: [true, 'Event reference is required']
    },
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Organizer reference is required']
    },
    headline: {
      type: String,
      trim: true,
      maxlength: [160, 'Headline cannot exceed 160 characters'],
      default: ''
    },
    subheadline: {
      type: String,
      trim: true,
      maxlength: [300, 'Subheadline cannot exceed 300 characters'],
      default: ''
    },
    bannerImage: {
      type: String,
      trim: true,
      default: ''
    },
    ctaText: {
      type: String,
      trim: true,
      maxlength: [50, 'CTA text cannot exceed 50 characters'],
      default: 'Explore Exhibition'
    },
    ctaLink: {
      type: String,
      trim: true,
      default: ''
    },
    badgeText: {
      type: String,
      trim: true,
      maxlength: [50, 'Badge text cannot exceed 50 characters'],
      default: 'Featured Spotlight'
    },
    slot: {
      type: String,
      enum: ['landing_hero_slider', 'category_banner', 'city_banner'],
      default: 'landing_hero_slider'
    },
    requestedDays: {
      type: Number,
      min: 1,
      max: 90,
      default: 14
    },
    startDate: {
      type: Date,
      default: null
    },
    endDate: {
      type: Date,
      default: null
    },
    priority: {
      type: Number,
      default: 1,
      min: 1,
      max: 100
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'paused', 'expired'],
      default: 'pending',
      index: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    adminNotes: {
      type: String,
      trim: true,
      default: ''
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    reviewedAt: {
      type: Date,
      default: null
    },
    impressions: {
      type: Number,
      default: 0
    },
    clicks: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// Indexes for fast querying of active approved banners
BannerRequestSchema.index({ status: 1, isActive: 1, priority: -1 });
BannerRequestSchema.index({ organizer: 1, createdAt: -1 });
BannerRequestSchema.index({ event: 1 });

const BannerRequest = mongoose.models.BannerRequest || mongoose.model('BannerRequest', BannerRequestSchema);

export default BannerRequest;
