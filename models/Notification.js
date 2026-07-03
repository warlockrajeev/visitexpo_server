/**
 * @file Notification.js
 * @description Mongoose schema and model for In-app/Email system notifications.
 */

import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['email', 'push', 'in_app'],
      default: 'in_app'
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    metadata: mongoose.Schema.Types.Mixed
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Notification', NotificationSchema);
