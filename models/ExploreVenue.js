import mongoose from 'mongoose';

const ExploreVenueSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Venue name is required'],
      trim: true,
      maxlength: [150, 'Venue name cannot exceed 150 characters']
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true
    },
    state: {
      type: String,
      trim: true,
      default: ''
    },
    country: {
      type: String,
      trim: true,
      default: 'India'
    },
    totalEvents: {
      type: Number,
      min: 0,
      default: 0
    },
    upcomingEvents: {
      type: Number,
      min: 0,
      default: 0
    },
    searchTerm: {
      type: String,
      trim: true,
      default: ''
    },
    imageUrl: {
      type: String,
      trim: true,
      default: ''
    },
    displayOrder: {
      type: Number,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  { timestamps: true }
);

ExploreVenueSchema.index({ slug: 1 }, { unique: true });

export default mongoose.model('ExploreVenue', ExploreVenueSchema);
