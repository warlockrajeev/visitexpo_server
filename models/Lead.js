/**
 * @file Lead.js
 * @description Mongoose schema and model for Event Leads (CRM).
 */

import mongoose from 'mongoose';

const ActivitySchema = new mongoose.Schema({
  type: {
    type: String, // E.g., 'email', 'call', 'meeting', 'note'
    required: true
  },
  content: { type: String, required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

const FollowUpSchema = new mongoose.Schema({
  title: { type: String, required: true },
  dateTime: { type: Date, required: true },
  notes: String,
  isCompleted: { type: Boolean, default: false }
});

const LeadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Lead name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Lead email is required'],
      trim: true,
      lowercase: true
    },
    phone: String,
    company: String,
    designation: String,
    country: String,
    leadScore: {
      type: Number,
      default: 0,
      index: true
    },
    source: {
      type: String,
      enum: ['website', 'campaign', 'cold_call', 'referral', 'walk_in'],
      default: 'website',
      index: true
    },
    status: {
      type: String,
      enum: ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'],
      default: 'new',
      index: true
    },
    assignedSales: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    notes: String,
    activityTimeline: [ActivitySchema],
    followUps: [FollowUpSchema],
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Optimize compound index
LeadSchema.index({ event: 1, status: 1 });

export default mongoose.model('Lead', LeadSchema);
