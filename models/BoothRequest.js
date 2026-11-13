/**
 * @file BoothRequest.js
 * @description Mongoose schema and model for Exhibition Booth & Inquiry requests routed to Admin.
 */

import mongoose from 'mongoose';

const BoothRequestSchema = new mongoose.Schema(
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
    name: {
      type: String,
      required: [true, 'Requester full name is required'],
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
    requestCategory: {
      type: String,
      enum: ['stall', 'visitor_pass', 'general'],
      default: 'stall',
      index: true
    },
    inquiryType: {
      type: String,
      default: 'Book Stall Space',
      trim: true
    },
    message: {
      type: String,
      default: '',
      trim: true
    },
    status: {
      type: String,
      enum: ['new', 'in_progress', 'responded', 'approved', 'rejected', 'archived'],
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

BoothRequestSchema.index({ eventSlug: 1, requestCategory: 1 });
BoothRequestSchema.index({ name: 'text', email: 'text', company: 'text', eventTitle: 'text', message: 'text' });

export default mongoose.model('BoothRequest', BoothRequestSchema);

