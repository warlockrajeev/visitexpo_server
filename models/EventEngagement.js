/**
 * @file EventEngagement.js
 * @description Mongoose schema and model for tracking user Event Interest and Following.
 * Connects real registered platform users and trade visitors to specific exhibitions.
 */

import mongoose from 'mongoose';

const EventEngagementSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    userId: {
      type: String,
      default: '',
      index: true
    },
    userName: {
      type: String,
      required: [true, 'User name is required'],
      trim: true
    },
    userEmail: {
      type: String,
      required: [true, 'User email is required'],
      lowercase: true,
      trim: true,
      index: true
    },
    userPhone: {
      type: String,
      default: '',
      trim: true
    },
    userAvatar: {
      type: String,
      default: ''
    },
    userCompany: {
      type: String,
      default: '',
      trim: true
    },
    userDesignation: {
      type: String,
      default: 'Trade Visitor',
      trim: true
    },
    userRole: {
      type: String,
      default: 'visitor'
    },
    eventSlug: {
      type: String,
      required: [true, 'Event slug is required'],
      lowercase: true,
      trim: true,
      index: true
    },
    eventId: {
      type: String,
      default: '',
      index: true
    },
    eventTitle: {
      type: String,
      required: [true, 'Event title is required'],
      trim: true
    },
    eventCity: {
      type: String,
      default: ''
    },
    eventCountry: {
      type: String,
      default: 'India'
    },
    eventVenue: {
      type: String,
      default: ''
    },
    eventDates: {
      type: String,
      default: ''
    },
    eventCategory: {
      type: String,
      default: 'Trade Show'
    },
    eventImage: {
      type: String,
      default: ''
    },
    organizerId: {
      type: String,
      default: '',
      index: true
    },
    organizerName: {
      type: String,
      default: ''
    },
    type: {
      type: String,
      enum: ['interested', 'follower', 'both'],
      default: 'interested',
      index: true
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true
    },
    passType: {
      type: String,
      default: 'Standard Trade Visitor'
    },
    objective: {
      type: String,
      default: 'Networking, product discovery, and supplier sourcing.'
    },
    isVerifiedUser: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

// Compound index to guarantee one engagement record per user email per event
EventEngagementSchema.index({ userEmail: 1, eventSlug: 1 }, { unique: true });
EventEngagementSchema.index({ eventSlug: 1, status: 1 });
EventEngagementSchema.index({ userId: 1, status: 1 });
EventEngagementSchema.index({ organizerId: 1, status: 1 });

export default mongoose.model('EventEngagement', EventEngagementSchema);
