/**
 * @file Review.js
 * @description Mongoose schema and model for User Reviews on exhibitions/expos.
 * Supports admin moderation (pending → approved/rejected/featured) and landing page showcase.
 */

import mongoose from 'mongoose';

const ReviewSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Reviewer name is required'],
      trim: true,
      maxlength: 120
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    role: {
      type: String,
      default: 'Verified Trade Buyer',
      trim: true
    },
    title: {
      type: String,
      default: 'Trade Professional',
      trim: true
    },
    company: {
      type: String,
      default: '',
      trim: true
    },
    avatar: {
      type: String,
      default: ''
    },
    eventTitle: {
      type: String,
      required: [true, 'Event title is required'],
      trim: true
    },
    eventSlug: {
      type: String,
      default: '',
      trim: true,
      lowercase: true
    },
    venue: {
      type: String,
      default: '',
      trim: true
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      default: 5
    },
    headline: {
      type: String,
      default: '',
      trim: true,
      maxlength: 300
    },
    review: {
      type: String,
      required: [true, 'Review text is required'],
      trim: true,
      maxlength: 2000
    },
    tags: {
      type: [String],
      default: []
    },
    helpfulCount: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'featured'],
      default: 'pending'
    },
    isFeaturedOnLanding: {
      type: Boolean,
      default: false
    },
    reviewedByAdmin: {
      type: String,
      default: ''
    },
    reviewedAt: {
      type: Date,
      default: null
    },
    submittedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Indexes for efficient queries
ReviewSchema.index({ status: 1 });
ReviewSchema.index({ isFeaturedOnLanding: 1 });
ReviewSchema.index({ eventSlug: 1 });
ReviewSchema.index({ rating: -1 });
ReviewSchema.index({ createdAt: -1 });

export default mongoose.model('Review', ReviewSchema);
