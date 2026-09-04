/**
 * @file ContactMessage.js
 * @description Mongoose schema and model for inquiries submitted via the VisitExpo landing page contact form.
 */

import mongoose from 'mongoose';

const ContactMessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['Organizer', 'Exhibitor', 'Visitor', 'Other'],
      default: 'Organizer',
      index: true
    },
    name: {
      type: String,
      required: [true, 'Sender name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      trim: true,
      lowercase: true,
      index: true
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    message: {
      type: String,
      required: [true, 'Message content is required'],
      trim: true
    },
    status: {
      type: String,
      enum: ['new', 'in_progress', 'responded', 'archived'],
      default: 'new',
      index: true
    },
    adminNotes: {
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

// Index for fast text searches
ContactMessageSchema.index({ name: 'text', email: 'text', message: 'text' });

export default mongoose.model('ContactMessage', ContactMessageSchema);
