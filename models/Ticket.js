/**
 * @file Ticket.js
 * @description Mongoose schema and model for Event Tickets.
 */

import mongoose from 'mongoose';

const TicketSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Ticket name is required'],
      trim: true
    },
    description: String,
    type: {
      type: String,
      enum: ['free', 'paid', 'vip'],
      default: 'free'
    },
    price: {
      type: Number,
      default: 0,
      min: [0, 'Price cannot be negative']
    },
    currency: {
      type: String,
      default: 'INR'
    },
    salesStart: {
      type: Date,
      default: null
    },
    salesEnd: {
      type: Date,
      default: null
    },
    minQuantity: {
      type: Number,
      default: 1,
      min: 1
    },
    maxQuantity: {
      type: Number,
      default: 10,
      min: -1
    },
    perUserLimit: {
      type: Number,
      default: 10,
      min: -1
    },
    benefits: {
      type: [String],
      default: []
    },
    accessDetails: {
      type: String,
      default: '',
      maxlength: 1000
    },
    visibility: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
      index: true
    },
    refundPolicy: {
      type: String,
      default: '',
      maxlength: 1000
    },
    capacity: {
      type: Number,
      required: [true, 'Ticket capacity is required'],
      min: [-1, 'Capacity must be positive or -1 for unlimited']
    },
    soldCount: {
      type: Number,
      default: 0
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['active', 'paused', 'sold_out'],
      default: 'active',
      index: true
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Ticket', TicketSchema);
