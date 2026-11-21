/**
 * @file PasswordResetOtp.js
 * @description Stores bcrypt-hashed 6-digit Password Reset OTPs with automatic MongoDB TTL expiration.
 */

import mongoose from 'mongoose';

const PasswordResetOtpSchema = new mongoose.Schema(
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

PasswordResetOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('PasswordResetOtp', PasswordResetOtpSchema);
