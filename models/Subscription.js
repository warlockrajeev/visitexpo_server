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
    plan: {
      type: String,
      enum: ['free', 'growth', 'enterprise'],
      default: 'free'
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'expired'],
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
      enum: ['monthly', 'annual'],
      default: 'monthly'
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Subscription', SubscriptionSchema);
