import mongoose from 'mongoose';

const venueReportSchema = new mongoose.Schema(
  {
    venueId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    venueName: {
      type: String,
      required: true,
      trim: true
    },
    venueAddress: {
      type: String,
      default: '',
      trim: true
    },
    category: {
      type: String,
      required: true,
      enum: ['venue_name', 'address_location', 'coordinates', 'contact_information', 'facilities', 'other']
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },
    imageUrl: {
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

venueReportSchema.index({ createdAt: -1 });

export default mongoose.models.VenueReport || mongoose.model('VenueReport', venueReportSchema);
