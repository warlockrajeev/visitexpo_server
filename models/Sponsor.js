/**
 * @file Sponsor.js
 * @description Mongoose schema and model for Event Sponsors and Exhibitors.
 */

import mongoose from 'mongoose';

const SponsorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Sponsor name is required'],
      trim: true
    },
    logo: {
      type: String,
      default: ''
    },
    website: {
      type: String,
      trim: true,
      default: ''
    },
    tier: {
      type: String,
      enum: ['platinum', 'gold', 'silver', 'bronze', 'custom'],
      default: 'silver',
      index: true
    },
    isExhibitor: {
      type: Boolean,
      default: false,
      index: true
    },
    boothDetails: {
      boothNumber: String,
      size: String,
      location: String
    },
    contactPerson: {
      name: String,
      email: String,
      phone: String
    },
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

export default mongoose.model('Sponsor', SponsorSchema);
