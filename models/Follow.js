/**
 * @file Follow.js
 * @description Mongoose schema & model for persistent User-to-User and User-to-Event follow relationships.
 */

import mongoose from 'mongoose';

const FollowSchema = new mongoose.Schema(
  {
    followerUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    followerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },
    followerName: {
      type: String,
      trim: true,
      default: 'VisitExpo User'
    },
    followerCompany: {
      type: String,
      trim: true,
      default: ''
    },
    followerRole: {
      type: String,
      trim: true,
      default: 'visitor'
    },
    targetType: {
      type: String,
      enum: ['user', 'event'],
      default: 'user',
      index: true
    },
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    targetEmail: {
      type: String,
      lowercase: true,
      trim: true,
      default: '',
      index: true
    },
    targetName: {
      type: String,
      trim: true,
      default: ''
    },
    targetCompany: {
      type: String,
      trim: true,
      default: ''
    },
    targetRole: {
      type: String,
      trim: true,
      default: ''
    },
    targetEventSlug: {
      type: String,
      lowercase: true,
      trim: true,
      default: '',
      index: true
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true
    }
  },
  {
    timestamps: true
  }
);

FollowSchema.index({ followerUser: 1, targetUser: 1, targetType: 1 });
FollowSchema.index({ followerUser: 1, targetEmail: 1, targetType: 1 });

const Follow = mongoose.models.Follow || mongoose.model('Follow', FollowSchema);
export default Follow;

