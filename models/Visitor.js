/**
 * @file Visitor.js
 * @description Mongoose schema and model for Event Visitors.
 */

import mongoose from 'mongoose';

const VisitorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Visitor name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Visitor email is required'],
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      required: [true, 'Visitor phone is required'],
      trim: true
    },
    company: String,
    designation: String,
    country: {
      type: String,
      default: 'India'
    },
    qrCode: {
      type: String, // String representation or Cloudinary link
      default: ''
    },
    registrationStatus: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled'],
      default: 'confirmed',
      index: true
    },
    attendanceType: {
      type: String,
      enum: ['in_person', 'virtual'],
      default: 'in_person',
      index: true
    },
    checkInStatus: {
      type: String,
      enum: ['not_checked_in', 'checked_in'],
      default: 'not_checked_in',
      index: true
    },
    checkInTime: {
      type: Date,
      default: null
    },
    virtualJoinStatus: {
      type: String,
      enum: ['not_checked_in', 'checked_in'],
      default: 'not_checked_in',
      index: true
    },
    virtualJoinTime: {
      type: Date,
      default: null
    },
    notes: String,
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

// Ensure unique registration per event
VisitorSchema.index({ event: 1, email: 1 }, { unique: true });

export default mongoose.model('Visitor', VisitorSchema);
