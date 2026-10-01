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
    sessionType: {
      type: String,
      enum: ['in_person', 'virtual', 'hybrid'],
      default: 'hybrid'
    },
    streamProvider: {
      type: String,
      enum: ['zoom', 'agora', '100ms', 'youtube', 'vimeo', 'custom'],
      default: 'zoom'
    },
    streamUrl: {
      type: String,
      default: ''
    },
    zoomMeetingId: {
      type: String,
      default: ''
    },
    zoomPasscode: {
      type: String,
      default: ''
    },
    agoraChannel: {
      type: String,
      default: ''
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    isLiveNow: {
      type: Boolean,
      default: false
    },
    virtualAttendeesCount: {
      type: Number,
      default: 0
    },
    virtualAttendees: [
      {
        visitorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Visitor'
        },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        name: String,
        email: String,
        joinedAt: {
          type: Date,
          default: Date.now
        },
        viewerTimezone: String
      }
    ],
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
