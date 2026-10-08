/**
 * @file Subscription.js
 * @description Mongoose schema and model for tenant plan subscriptions.
 */

import mongoose from 'mongoose';

const SubscriptionSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    plan: {
      type: String,
      enum: ['free', 'starter', 'enterprise', 'growth'],
      default: 'free'
    },
    emailType: {
      type: String,
      enum: ['corporate', 'general'],
      default: 'corporate'
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'expired', 'payment_pending'],
      default: 'active'
    },
    startDate: {
      type: Date,
      default: Date.now
    },
    endDate: {
      type: Date,
      required: true
    },
    price: {
      type: Number,
      default: 0
    },
    paymentCycle: {
      type: String,
      enum: ['monthly', 'quarterly', 'annual', 'one_time'],
      default: 'quarterly'
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Subscription', SubscriptionSchema);
