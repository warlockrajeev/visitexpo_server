import mongoose from 'mongoose';

/**
 * @file DeletedEvent.js
 * @description Mongoose schema for events permanently deleted by Super Admin.
 * Used to filter out deleted exhibitions across WordPress synchronization,
 * category breakdowns, and platform event directories.
 */

const DeletedEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      index: true
    },
    slug: {
      type: String,
      index: true
    },
    title: {
      type: String,
      trim: true
    },
    wpPostId: {
      type: String,
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

export default mongoose.models.DeletedEvent || mongoose.model('DeletedEvent', DeletedEventSchema);
