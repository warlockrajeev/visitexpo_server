/**
 * @file SupportTicket.js
 * @description Mongoose schema and model for Support Helpdesk Tickets raised by clients/organizers to system admins.
 */

import mongoose from 'mongoose';

const SupportTicketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    reporterName: {
      type: String,
      required: true
    },
    reporterEmail: {
      type: String,
      required: true
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization'
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event'
    },
    title: {
      type: String,
      required: [true, 'Ticket title is required'],
      trim: true
    },
    description: {
      type: String,
      required: [true, 'Ticket description is required']
    },
    category: {
      type: String,
      enum: ['technical', 'billing', 'event_setup', 'exhibitor_issue', 'other'],
      default: 'technical'
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium'
    },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
      index: true
    },
    responses: [
      {
        sender: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        senderName: {
          type: String,
          required: true
        },
        senderRole: {
          type: String,
          default: 'user'
        },
        message: {
          type: String,
          required: true
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ],
    resolutionNotes: {
      type: String,
      default: ''
    },
    resolvedAt: {
      type: Date
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('SupportTicket', SupportTicketSchema);
