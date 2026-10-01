/**
 * @file ChatConversation.js
 * @description Mongoose schema and model for Live Chat Conversations between Organizers and Visitors/Exhibitors.
 */

import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema(
  {
    senderRole: {
      type: String,
      enum: ['organizer', 'visitor', 'exhibitor', 'system'],
      required: true
    },
    senderName: {
      type: String,
      required: true,
      trim: true
    },
    senderId: {
      type: String,
      default: ''
    },
    text: {
      type: String,
      required: true,
      trim: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    read: {
      type: Boolean,
      default: false
    }
  },
  { _id: true }
);

const ChatConversationSchema = new mongoose.Schema(
  {
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      default: null,
      index: true
    },
    eventTitle: {
      type: String,
      default: '',
      trim: true
    },
    eventSlug: {
      type: String,
      default: '',
      trim: true
    },
    participantRole: {
      type: String,
      enum: ['visitor', 'exhibitor'],
      default: 'visitor',
      index: true
    },
    participantName: {
      type: String,
      required: [true, 'Participant name is required'],
      trim: true
    },
    participantEmail: {
      type: String,
      required: [true, 'Participant email is required'],
      lowercase: true,
      trim: true,
      index: true
    },
    participantPhone: {
      type: String,
      default: '',
      trim: true
    },
    participantCompany: {
      type: String,
      default: '',
      trim: true
    },
    participantDesignation: {
      type: String,
      default: '',
      trim: true
    },
    participantUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    participantSessionId: {
      type: String,
      default: '',
      index: true
    },
    lastMessage: {
      type: String,
      default: ''
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    unreadByOrganizer: {
      type: Number,
      default: 0
    },
    unreadByParticipant: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['active', 'archived', 'closed'],
      default: 'active',
      index: true
    },
    messages: [MessageSchema]
  },
  {
    timestamps: true
  }
);

// Compound indexes for optimized querying
ChatConversationSchema.index({ organizer: 1, lastMessageAt: -1 });
ChatConversationSchema.index({ organizer: 1, participantEmail: 1 });
ChatConversationSchema.index({ participantEmail: 1, lastMessageAt: -1 });

export default mongoose.model('ChatConversation', ChatConversationSchema);
