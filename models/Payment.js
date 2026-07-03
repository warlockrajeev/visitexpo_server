/**
 * @file Payment.js
 * @description Mongoose schema and model for Payment Logs.
 */

import mongoose from 'mongoose';

const PaymentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'INR'
    },
    gateway: {
      type: String,
      required: true // E.g., 'stripe', 'razorpay'
    },
    transactionId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    status: {
      type: String,
      enum: ['pending', 'successful', 'failed', 'refunded'],
      default: 'pending'
    },
    gatewayPayload: mongoose.Schema.Types.Mixed
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Payment', PaymentSchema);
