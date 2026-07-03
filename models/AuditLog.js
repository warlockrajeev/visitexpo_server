/**
 * @file AuditLog.js
 * @description Mongoose schema and model for Platform Audit logging.
 */

import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      index: true
    },
    collectionName: {
      type: String,
      required: true,
      index: true
    },
    recordId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true
    },
    details: mongoose.Schema.Types.Mixed,
    ipAddress: String
  },
  {
    timestamps: { createdAt: true, updatedAt: false } // Only track creation timestamp
  }
);

export default mongoose.model('AuditLog', AuditLogSchema);
