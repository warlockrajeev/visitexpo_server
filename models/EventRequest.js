/**
 * @file EventRequest.js
 * @description Mongoose schema and model for Keynote Speaker Applications, Corporate Group & VIP Delegations,
 * and Partner Hotel & Flight Discount requests submitted from expo pages directly to Admin.
 */

import mongoose from 'mongoose';

const EventRequestSchema = new mongoose.Schema(
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
    eventCity: {
      type: String,
      default: '',
      trim: true
    },
    eventVenue: {
      type: String,
      default: '',
      trim: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    requestType: {
      type: String,
      enum: ['speaker', 'delegation', 'travel_discount'],
      required: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Work email is required'],
      trim: true,
      lowercase: true,
      index: true
    },
    phone: {
      type: String,
      default: '',
      trim: true
    },
    company: {
      type: String,
      default: '',
      trim: true
    },
    designation: {
      type: String,
      default: '',
      trim: true
    },
    // Speaker Application Fields
    sessionTopic: {
      type: String,
      default: '',
      trim: true
    },
    sessionFormat: {
      type: String,
      default: '',
      trim: true
    },
    speakerBio: {
      type: String,
      default: '',
      trim: true
    },
    linkedinUrl: {
      type: String,
      default: '',
      trim: true
    },
    // Corporate Group & VIP Delegation Fields
    teamSize: {
      type: String,
      default: '',
      trim: true
    },
    delegationInterests: {
      type: String,
      default: '',
      trim: true
    },
    preferredDates: {
      type: String,
      default: '',
      trim: true
    },
    // Partner Hotel & Flight Discounts Fields
    travelPreference: {
      type: String,
      default: '',
      trim: true
    },
    guestsCount: {
      type: String,
      default: '',
      trim: true
    },
    checkInDate: {
      type: String,
      default: '',
      trim: true
    },
    checkOutDate: {
      type: String,
      default: '',
      trim: true
    },
    departureCity: {
      type: String,
      default: '',
      trim: true
    },
    // Common Notes & Admin Review Metadata
    message: {
      type: String,
      default: '',
      trim: true
    },
    status: {
      type: String,
      enum: ['new', 'in_progress', 'approved', 'rejected', 'archived'],
      default: 'new',
      index: true
    },
    adminNotes: {
      type: String,
      default: ''
    },
    reviewedByAdmin: {
      type: String,
      default: ''
    },
    respondedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

EventRequestSchema.index({ eventSlug: 1, requestType: 1, status: 1 });
EventRequestSchema.index({ userId: 1, eventSlug: 1, requestType: 1 });
EventRequestSchema.index({
  name: 'text',
  email: 'text',
  company: 'text',
  eventTitle: 'text',
  sessionTopic: 'text',
  message: 'text'
});

export default mongoose.model('EventRequest', EventRequestSchema);

