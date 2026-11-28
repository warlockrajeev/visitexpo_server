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
    excerpt: {
      type: String,
      default: ''
    },
    banner: {
      type: String, // Cloudinary URL
      default: ''
    },
    bannerAlt: {
      type: String,
      default: ''
    },
    bannerWidth: {
      type: Number,
      default: 1200
    },
    bannerHeight: {
      type: Number,
      default: 630
    },
    gallery: [String], // Array of Cloudinary URLs
    brochurePdf: {
      type: String,
      default: ''
    },
    promoVideoUrl: {
      type: String,
      default: ''
    },
    socials: {
      facebook: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      instagram: { type: String, default: '' },
      twitter: { type: String, default: '' },
      youtube: { type: String, default: '' }
    },
    venue: {
      type: String,
      required: [true, 'Venue is required']
    },
    address: {
      type: String,
      default: ''
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      index: true
    },
    state: {
      type: String,
      default: ''
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      default: 'INDIA'
    },
    lat: {
      type: Number,
      default: null,
      validate: {
        validator: v => v === null || v === undefined || (typeof v === 'number' && !Number.isNaN(v) && v >= -90 && v <= 90),
        message: 'Latitude must be between -90 and 90'
      }
    },
    lng: {
      type: Number,
      default: null,
      validate: {
        validator: v => v === null || v === undefined || (typeof v === 'number' && !Number.isNaN(v) && v >= -180 && v <= 180),
        message: 'Longitude must be between -180 and 180'
      }
    },
    startDate: {
      type: Date,
      required: [
        function () {
          return !this.dateTBA;
        },
        'Start date is required'
      ]
    },
    endDate: {
      type: Date,
      required: [
        function () {
          return !this.dateTBA;
        },
        'End date is required'
      ],
      validate: {
        validator: function (value) {
          if (this?.dateTBA) return true;
          if (!value) return false;
          const end = new Date(value);
          if (Number.isNaN(end.getTime())) return false;
          let startRaw = this?.startDate;
          if (!startRaw && typeof this?.getUpdate === 'function') {
            const upd = this.getUpdate();
            startRaw = upd?.startDate || upd?.$set?.startDate;
          }
          if (!startRaw) return true;
          const start = new Date(startRaw);
          if (Number.isNaN(start.getTime())) return true;
          return end.getTime() >= start.getTime();
        },
        message: 'End date must be greater than or equal to start date'
      }
    },
    isPostponed: {
      type: Boolean,
      default: false,
      index: true
    },
    dateTBA: {
      type: Boolean,
      default: false,
      index: true
    },
    postponedReason: {
      type: String,
      default: ''
    },
    originalStartDate: {
      type: Date,
      default: null
    },
    originalEndDate: {
      type: Date,
      default: null
    },
    postponedAt: {
      type: Date,
      default: null
    },
    timings: {
      type: String, // E.g. "10:00 AM - 6:00 PM"
      default: ''
    },
    industry: {
      type: String,
      default: '',
      index: true
    },
    categories: {
      type: [String],
      default: [],
      index: true
    },
    tags: {
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
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
    wpTerms: {
      categories: { type: [Number], default: [] },
      location: { type: [Number], default: [] },
      tags: { type: [Number], default: [] }
    },
    wpSyncedAt: {
      type: Date,
      default: null
    },
    syncError: {
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
    claimedAt: {
      type: Date,
      default: null,
      index: true
    },
    claimRequests: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        submittedAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
      }
    ],
    website: String,
    orgName: { type: String, default: '' },
    orgEmail: { type: String, default: '' },
    orgPhone: { type: String, default: '' },
    orgWebsite: { type: String, default: '' },
    orgDesc: { type: String, default: '' },
    orgLogo: { type: String, default: '' },
    claimProof: { type: String, default: '' },
    claimNotes: { type: String, default: '' },
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
    ticketingMode: {
      type: String,
      enum: ['free', 'paid', 'free_then_paid'],
      default: 'free'
    },
    isFreeEvent: { type: Boolean, default: true },
    freePassQuota: { type: Number, default: 0, min: 0 },
    freePassUntil: { type: Date, default: null },
    freePassClaimedCount: { type: Number, default: 0, min: 0 },
    paidTicketPrice: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    registrationSettings: {
      maxLimit: { type: Number, default: 1000 },
      isOpen: { type: Boolean, default: true },
      formFields: {
        type: [String],
        default: ['name', 'email', 'phone', 'company', 'designation']
      }
    },
    seo: {
      metaTitle: { type: String, default: '' },
      metaDescription: { type: String, default: '' },
      keywords: [String],
      focusKeyword: { type: String, default: '' },
      canonicalUrl: { type: String, default: '' },
      ogTitle: { type: String, default: '' },
      ogDescription: { type: String, default: '' },
      ogImage: { type: String, default: '' }
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
    eventType: {
      type: String,
      enum: ['physical', 'virtual', 'hybrid'],
      default: 'physical',
      index: true
    },
    livestream: {
      enabled: { type: Boolean, default: false },
      provider: {
        type: String,
        enum: ['youtube', 'vimeo', 'zoom', 'agora', '100ms', 'custom'],
        default: 'youtube'
      },
      streamUrl: { type: String, default: '' },
      zoomMeetingId: { type: String, default: '' },
      zoomPasscode: { type: String, default: '' },
      agoraChannel: { type: String, default: '' },
      status: {
        type: String,
        enum: ['upcoming', 'live', 'ended'],
        default: 'upcoming'
      },
      liveViewerCount: { type: Number, default: 0 }
    },
    virtualSettings: {
      enableVirtualBooths: { type: Boolean, default: false },
      enableLiveChat: { type: Boolean, default: false },
      allowVirtualRegistration: { type: Boolean, default: false },
      recordedSessionsUrl: { type: String, default: '' }
    },
    virtualAttendanceStats: {
      totalVirtualVisitors: { type: Number, default: 0 },
      liveStreamViews: { type: Number, default: 0 },
      sessionAttendeesCount: { type: Number, default: 0 },
      boothVisitsCount: { type: Number, default: 0 }
    },
    virtualBooths: [
      {
        exhibitorName: { type: String, default: '' },
        boothNumber: { type: String, default: '' },
        logo: { type: String, default: '' },
        banner: { type: String, default: '' },
        tagline: { type: String, default: '' },
        description: { type: String, default: '' },
        videoUrl: { type: String, default: '' },
        website: { type: String, default: '' },
        contactEmail: { type: String, default: '' },
        contactPhone: { type: String, default: '' },
        liveChatEnabled: { type: Boolean, default: true },
        products: [
          {
            name: { type: String, default: '' },
            description: { type: String, default: '' },
            price: { type: String, default: '' },
            category: { type: String, default: '' },
            image: { type: String, default: '' },
            brochureUrl: { type: String, default: '' }
          }
        ],
        boothVisits: { type: Number, default: 0 }
      }
    ],
    status: {
      type: String,
      enum: ['draft', 'published', 'cancelled', 'completed'],
      default: 'draft',
      index: true
    },
    rejectionReason: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

// Compound Index for WordPress widgets sorting by start date and status
EventSchema.index({ status: 1, startDate: 1 });
// Compound Index for admin moderation queues and event history sorted by latest update
EventSchema.index({ status: 1, isClaimed: 1, updatedAt: -1 });

export default mongoose.model('Event', EventSchema);
