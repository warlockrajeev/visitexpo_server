/**
 * @file Category.js
 * @description Mongoose model for event industry categories, supporting both default and user-defined custom categories.
 */

import mongoose from 'mongoose';

const CategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    isCustom: {
      type: Boolean,
      default: true
    },
    description: {
      type: String,
      default: ''
    },
    scope: {
      type: String,
      default: ''
    },
    subSectors: {
      type: [String],
      default: []
    },
    icon: {
      type: String,
      default: 'Tag'
    },
    color: {
      type: String,
      default: '#f59e0b'
    },
    topHubs: {
      type: [String],
      default: ['New Delhi', 'Mumbai', 'Bengaluru']
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.models.Category || mongoose.model('Category', CategorySchema);
