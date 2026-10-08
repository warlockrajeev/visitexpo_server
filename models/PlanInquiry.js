/**
 * @file PlanInquiry.js
 * @description Mongoose schema and model for organizer plan upgrades, prospective research requests, and growth top-ups.
 */

import mongoose from 'mongoose';

const PlanInquirySchema = new mongoose.Schema(
  {
    planId: {
      type: String,
      required: true,
      index: true
    },
    planName: {
      type: String,
      required: true
    },
    billingCycle: {
      type: String,
      enum: ['quarterly', 'yearly', 'free_corporate', 'free_general', 'top_up', 'custom', 'proposed_validation'],
      default: 'quarterly'
    },
    organizerName: {
      type: String,
      required: [true, 'Contact person name is required'],
      trim: true
    },
    organizationName: {
      type: String,
      required: [true, 'Organization or Company name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      trim: true,
      lowercase: true,
      index: true
    },
    emailType: {
      type: String,
      enum: ['corporate', 'general'],
      default: 'general'
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true
    },
    city: {
      type: String,
      default: ''
    },
    eventType: {
      type: String,
      default: 'Trade Show / B2B'
    },
    eventName: {
      type: String,
      default: ''
    },
    selectedGrowthServices: [{
      type: String
    }],
    estimatedBudget: {
      type: String,
      default: ''
    },
    message: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['new', 'contacted', 'in_discussion', 'converted', 'rejected'],
      default: 'new',
      index: true
    },
    adminNotes: {
      type: String,
      default: ''
    },
    assignedTo: {
      type: String,
      default: ''
    },
    respondedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

PlanInquirySchema.index({ createdAt: -1 });

export default mongoose.model('PlanInquiry', PlanInquirySchema);
