/**
 * @file FeaturedOrganizer.js
 * @description Mongoose model for Featured Event Organizers showcase and Enterprise organizer applications.
 */

import mongoose from 'mongoose';

const FeaturedOrganizerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Organizer name is required'],
      trim: true,
      maxlength: [120, 'Organizer name cannot exceed 120 characters']
    },
    shortName: {
      type: String,
      trim: true,
      maxlength: [60, 'Short name cannot exceed 60 characters'],
      default: ''
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      index: true
    },
    logoUrl: {
      type: String,
      trim: true,
      default: ''
    },
    website: {
      type: String,
      trim: true,
      default: ''
    },
    brandColor: {
      type: String,
      trim: true,
      default: '#0284C7'
    },
    accentColor: {
      type: String,
      trim: true,
      default: '#38BDF8'
    },
    badge: {
      type: String,
      trim: true,
      default: 'Featured Organizer',
      maxlength: [50, 'Badge cannot exceed 50 characters']
    },
    scope: {
      type: String,
      trim: true,
      default: ''
    },
    category: {
      type: String,
      trim: true,
      default: 'Trade & Industry'
    },
    eventsCount: {
      type: Number,
      default: 0,
      min: 0
    },
    displayOrder: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    // Applicant details (when applied from Enterprise Organizer Dashboard)
    applicantUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    applicantOrganization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null
    },
    applicantEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    applicantPhone: {
      type: String,
      trim: true,
      default: ''
    },
    applicationNotes: {
      type: String,
      trim: true,
      default: ''
    },
    // Admin review details
    adminReviewNotes: {
      type: String,
      trim: true,
      default: ''
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    reviewedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Auto-generate slug before saving
FeaturedOrganizerSchema.pre('save', function (next) {
  if (!this.slug && this.name) {
    this.slug = (this.shortName || this.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

export default mongoose.model('FeaturedOrganizer', FeaturedOrganizerSchema);
