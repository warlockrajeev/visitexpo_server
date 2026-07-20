/**
 * @file Event.js
 * @description Mongoose schema and model for Events.
 */

import mongoose from 'mongoose';

const SpeakerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  designation: String,
  company: String,
  photo: String,
  bio: String
});

const ExhibitorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  logo: String,
  boothNumber: String,
  website: String,
  description: String
});

const EventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Event title is required'],
      trim: true
    },
    slug: {
      type: String,
      required: [true, 'Event slug is required'],
      unique: true,
      trim: true,
      lowercase: true
    },
    description: {
      type: String,
      required: [true, 'Description is required']
    },
    banner: {
      type: String, // Cloudinary URL
      default: ''
    },
    gallery: [String], // Array of Cloudinary URLs
    venue: {
      type: String,
      required: [true, 'Venue is required']
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      index: true
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      default: 'India'
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required']
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required']
    },
    timings: {
      type: String, // E.g. "9:00 AM - 6:00 PM"
      default: ''
    },
    categories: {
      type: [String],
      default: [],
      index: true
    },
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: false,
      default: null,
      index: true
    },
    wpPostId: {
      type: String,
      default: '',
      index: true
    },
    wpUrl: {
      type: String,
      default: ''
    },
    isClaimed: {
      type: Boolean,
      default: false,
      index: true
    },
    claimedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    website: String,
    orgName: { type: String, default: '' },
    orgEmail: { type: String, default: '' },
    orgPhone: { type: String, default: '' },
    orgWebsite: { type: String, default: '' },
    orgDesc: { type: String, default: '' },
    orgLogo: { type: String, default: '' },
    schedules: [
      {
        name: { type: String, default: '' },
        date: { type: String, default: '' }
      }
    ],
    sponsorsList: [
      {
        name: { type: String, default: '' },
        link: { type: String, default: '' },
        logo: { type: String, default: '' },
        tier: { type: String, default: '' }
      }
    ],
    faqsList: [
      {
        question: { type: String, default: '' },
        answer: { type: String, default: '' }
      }
    ],
    contactShortcode: { type: String, default: '' },
    isFreeEvent: { type: Boolean, default: true },
    paidTicketPrice: { type: Number, default: 0 },
    registrationSettings: {
      maxLimit: { type: Number, default: 1000 },
      isOpen: { type: Boolean, default: true },
      formFields: {
        type: [String],
        default: ['name', 'email', 'phone', 'company', 'designation']
      }
    },
    seo: {
      metaTitle: String,
      metaDescription: String,
      keywords: [String]
    },
    speakers: [SpeakerSchema],
    sponsors: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Sponsor'
      }
    ],
    exhibitors: [ExhibitorSchema],
    sessions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Session'
      }
    ],
    status: {
      type: String,
      enum: ['draft', 'published', 'cancelled', 'completed'],
      default: 'draft',
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Compound Index for WordPress widgets sorting by start date and status
EventSchema.index({ status: 1, startDate: 1 });

export default mongoose.model('Event', EventSchema);
