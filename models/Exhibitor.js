/**
 * @file Exhibitor.js
 * @description Mongoose schema and model for Event Exhibitors.
 */

import mongoose from 'mongoose';

const StaffSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: String
});

const ExhibitorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Exhibitor company name is required'],
      trim: true
    },
    description: {
      type: String,
      required: [true, 'Description is required']
    },
    logo: {
      type: String, // Logo image URL (Cloudinary or placeholder)
      default: ''
    },
    website: {
      type: String,
      default: ''
    },
    contactEmail: {
      type: String,
      required: [true, 'Contact email is required'],
      trim: true,
      lowercase: true
    },
    contactPhone: {
      type: String,
      required: [true, 'Contact phone is required'],
      trim: true
    },
    boothNumber: {
      type: String,
      default: ''
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true
    },
    staff: [StaffSchema],
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true
    },
    attendanceType: {
      type: String,
      enum: ['in_person', 'virtual', 'hybrid'],
      default: 'in_person',
      index: true
    },
    productCategories: {
      type: [String],
      default: []
    },
    wpSource: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

// Ensure unique company registration per event
ExhibitorSchema.index({ event: 1, name: 1 }, { unique: true });

export default mongoose.model('Exhibitor', ExhibitorSchema);
