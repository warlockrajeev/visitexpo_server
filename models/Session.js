/**
 * @file Session.js
 * @description Mongoose schema and model for Event Agenda Sessions.
 */

import mongoose from 'mongoose';

const SessionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Session title is required'],
      trim: true
    },
    description: String,
    speakers: [
      {
        name: String,
        designation: String,
        company: String
      }
    ],
    startTime: {
      type: Date,
      required: [true, 'Start time is required']
    },
    endTime: {
      type: Date,
      required: [true, 'End time is required']
    },
    hallName: String,
    capacity: Number,
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Order sessions chronologically per event
SessionSchema.index({ event: 1, startTime: 1 });

export default mongoose.model('Session', SessionSchema);
