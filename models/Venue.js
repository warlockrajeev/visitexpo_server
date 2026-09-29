/**
 * @file Venue.js
 * @description Mongoose schema for Convention & Exhibition Venue Profiles.
 * Stores venue branding, cover banner, logo thumbnail, photo galleries, hall specifications, and transit data.
 */

import mongoose from 'mongoose';

const venueSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Venue name is required'],
      trim: true
    },
    shortName: {
      type: String,
      trim: true
    },
    tagline: {
      type: String,
      trim: true
    },
    city: {
      type: String,
      trim: true,
      index: true
    },
    state: {
      type: String,
      trim: true
    },
    country: {
      type: String,
      default: 'India',
      trim: true
    },
    address: {
      type: String,
      trim: true
    },
    metro: {
      type: String,
      trim: true
    },
    airportDistance: {
      type: String,
      trim: true
    },
    heroBanner: {
      type: String,
      default: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=1600&auto=format&fit=crop'
    },
    logoThumbnail: {
      type: String,
      default: 'https://images.unsplash.com/photo-1541971875076-8f970d573be6?q=80&w=300&auto=format&fit=crop'
    },
    gallery: {
      type: [String],
      default: []
    },
    overviewDescription: {
      type: String,
      trim: true
    },
    totalArea: {
      type: String,
      trim: true
    },
    builtYear: {
      type: String,
      trim: true
    },
    renovatedYear: {
      type: String,
      trim: true
    },
    meetingRooms: {
      type: String,
      trim: true
    },
    rating: {
      type: Number,
      default: 4.8
    },
    ratingsCount: {
      type: Number,
      default: 500
    },
    followersCount: {
      type: String,
      default: '25K+'
    },
    bestSuited: {
      type: String,
      default: 'Tradeshows & Mega B2B Expos'
    },
    eventsHosted: {
      type: String,
      default: '50+'
    },
    upcomingEventsCount: {
      type: String,
      default: '12+'
    },
    reputationText: {
      type: String,
      default: 'Recognized Event Destination'
    },
    isFeatured: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// Virtual for id
venueSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

venueSchema.set('toJSON', { virtuals: true });
venueSchema.set('toObject', { virtuals: true });

const Venue = mongoose.models.Venue || mongoose.model('Venue', venueSchema);

export default Venue;
