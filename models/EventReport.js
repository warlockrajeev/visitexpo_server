import mongoose from 'mongoose';

const eventReportSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    eventSlug: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    eventTitle: {
      type: String,
      required: true,
      trim: true
    },
    eventLocation: {
      type: String,
      default: '',
      trim: true
    },
    category: {
      type: String,
      required: true,
      enum: [
        'incorrect_dates',
        'wrong_venue_or_location',
        'cancelled_or_postponed',
        'misleading_or_spam',
        'broken_links_or_media',
        'other'
      ]
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },
    userId: {
      type: String,
      default: '',
      trim: true
    },
    userEmail: {
      type: String,
      default: '',
      trim: true
    },
    userName: {
      type: String,
      default: '',
      trim: true
    },
    status: {
      type: String,
      enum: ['pending', 'reviewing', 'resolved', 'dismissed'],
      default: 'pending',
      index: true
    },
    adminNotes: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000
    }
  },
  { timestamps: true }
);

eventReportSchema.index({ createdAt: -1 });

export default mongoose.models.EventReport || mongoose.model('EventReport', eventReportSchema);
