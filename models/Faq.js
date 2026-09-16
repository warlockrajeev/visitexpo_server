/**
 * @file Faq.js
 * @description Mongoose schema and model for Frequently Asked Questions (FAQ).
 * Supports categorization (General, Organizers, Exhibitors, Visitors),
 * custom ordering, and active/inactive visibility status.
 */

import mongoose from 'mongoose';

const FaqSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: [true, 'FAQ question is required'],
      trim: true,
      maxlength: 500
    },
    answer: {
      type: String,
      required: [true, 'FAQ answer is required'],
      trim: true
    },
    category: {
      type: String,
      default: 'General',
      trim: true,
      index: true
    },
    order: {
      type: Number,
      default: 0,
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound index for efficient public query & order sorting
FaqSchema.index({ isActive: 1, order: 1, createdAt: 1 });

const Faq = mongoose.models.Faq || mongoose.model('Faq', FaqSchema);

export default Faq;
