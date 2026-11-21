/**
 * @file EmailOtpVerification.js
 * @description Stores hashed 6-digit registration Email OTP codes with automatic TTL expiry.
 */

import mongoose from 'mongoose';

const EmailOtpVerificationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    codeHash: {
      type: String,
      required: true
    },
    attempts: {
      type: Number,
      default: 0
    },
    lastSentAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      required: true
    }
  },
  { timestamps: true }
);

// MongoDB TTL index: automatically purge expired OTP records
EmailOtpVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('EmailOtpVerification', EmailOtpVerificationSchema);
