import mongoose from 'mongoose';

/**
 * @file DeletedOrganizer.js
 * @description Mongoose schema for organizers deleted by Super Admin.
 * Used to permanently filter out deleted trade fair organizers and tenant accounts.
 */

const DeletedOrganizerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    slugId: {
      type: String,
      required: true,
      index: true
    },
    deletedAt: {
      type: Date,
      default: Date.now
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    reason: {
      type: String,
      default: 'Deleted by Super Admin'
    }
  },
  { timestamps: true }
);

export default mongoose.models.DeletedOrganizer || mongoose.model('DeletedOrganizer', DeletedOrganizerSchema);
