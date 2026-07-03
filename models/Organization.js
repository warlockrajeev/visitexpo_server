/**
 * @file Organization.js
 * @description Mongoose schema and model for Tenant Organizations.
 */

import mongoose from 'mongoose';

const TeamMemberSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['organizer', 'event_manager', 'marketing_manager', 'sales_team', 'support', 'viewer'],
    required: true
  }
});

const OrganizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Organization name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    logo: {
      type: String, // Cloudinary URL
      default: ''
    },
    website: {
      type: String,
      trim: true,
      default: ''
    },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String
    },
    gst: {
      type: String,
      trim: true,
      default: ''
    },
    contact: {
      phone: String,
      email: String
    },
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null
    },
    teamMembers: [TeamMemberSchema]
  },
  {
    timestamps: true
  }
);

// Indexes
OrganizationSchema.index({ name: 1 });

export default mongoose.model('Organization', OrganizationSchema);
