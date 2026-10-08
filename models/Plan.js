/**
 * @file Plan.js
 * @description Mongoose schema and model for VisitExpo Organizer Pricing Plans and Growth Top-ups.
 */

import mongoose from 'mongoose';

const PlanFeatureSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    included: { type: Boolean, default: true },
    detail: { type: String, default: '' },
    highlight: { type: Boolean, default: false }
  },
  { _id: false }
);

const DetailedComparisonSchema = new mongoose.Schema(
  {
    featureKey: { type: String, required: true },
    label: { type: String, required: true },
    category: {
      type: String,
      enum: ['Lead Intelligence', 'Ticketing & Commerce', 'Operations & Validation', 'Promotion & Support'],
      default: 'Lead Intelligence'
    },
    value: { type: String, required: true },
    status: {
      type: String,
      enum: ['available', 'unavailable', 'limited', 'paid_extra', 'advanced'],
      default: 'available'
    },
    tooltip: { type: String, default: '' }
  },
  { _id: false }
);

const GrowthServiceSchema = new mongoose.Schema({
  serviceId: { type: String, required: true },
  name: { type: String, required: true },
  category: {
    type: String,
    enum: ['Digital & Ads', 'Direct Outreach', 'Platform Spotlight', 'Comprehensive Promotion'],
    default: 'Digital & Ads'
  },
  pricingModel: { type: String, default: 'Starting from ₹1,000' },
  priceStartsAt: { type: Number, default: 1000 },
  unit: { type: String, default: 'Point-wise / Campaign' },
  description: { type: String, default: '' },
  deliverables: [{ type: String }],
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
});

const PlanSchema = new mongoose.Schema(
  {
    planId: {
      type: String,
      required: [true, 'Plan ID identifier is required'],
      unique: true,
      trim: true,
      lowercase: true
    },
    name: {
      type: String,
      required: [true, 'Plan name is required'],
      trim: true
    },
    tagline: {
      type: String,
      default: ''
    },
    description: {
      type: String,
      default: ''
    },
    badge: {
      type: String,
      default: ''
    },
    badgeColor: {
      type: String,
      default: 'bg-primary text-black'
    },
    pricing: {
      corporateEmailPrice: { type: Number, default: 0 },
      generalEmailPrice: { type: Number, default: 0 },
      quarterlyPrice: { type: Number, default: 0 },
      yearlyPrice: { type: Number, default: 0 },
      proposedEventResearchPrice: { type: Number, default: 4999 },
      currency: { type: String, default: 'INR' },
      currencySymbol: { type: String, default: '₹' },
      billingNote: { type: String, default: '' }
    },
    highlights: [{ type: String }],
    features: [PlanFeatureSchema],
    comparisonDetails: [DetailedComparisonSchema],
    growthServices: [GrowthServiceSchema],
    isActive: {
      type: Boolean,
      default: true
    },
    isPopular: {
      type: Boolean,
      default: false
    },
    sortOrder: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// Helpful index
PlanSchema.index({ planId: 1 });
PlanSchema.index({ isActive: 1, sortOrder: 1 });

export default mongoose.model('Plan', PlanSchema);
