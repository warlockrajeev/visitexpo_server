/**
 * @file planRoutes.js
 * @description API endpoints for VisitExpo Organizer Pricing Plans, Comparison Matrix, Growth Services, and Inquiries.
 */

import express from 'express';
import Plan from '../models/Plan.js';
import PlanInquiry from '../models/PlanInquiry.js';
import Subscription from '../models/Subscription.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import { isCorporateEmail } from '../utils/emailValidator.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

export const DEFAULT_OFFICIAL_PLANS = [
  {
    planId: 'free',
    name: 'Free Organizer',
    tagline: 'Start listing your events and build your presence on VisitExpo.',
    description: 'Start listing your events and build your presence on VisitExpo.',
    badge: 'Get Started',
    badgeColor: 'bg-orange-50 text-orange-700 border border-orange-200',
    pricing: {
      corporateEmailPrice: 0,
      generalEmailPrice: 1499,
      quarterlyPrice: 0,
      yearlyPrice: 0,
      proposedEventResearchPrice: 4999,
      currency: 'INR',
      currencySymbol: '₹',
      billingNote: 'Free registration (corporate email) · Paid registration for general email (₹1,499)'
    },
    bestFor: [
      'You are new to VisitExpo',
      'Want to list your first event',
      'Want basic visibility on platform'
    ],
    keyInclusions: [
      'Free registration (corporate email)',
      'Paid registration for general email (₹1,499)',
      'Limited event claiming',
      'Create & publish events'
    ],
    highlights: [
      'Free registration (corporate email)',
      'Paid registration for general email (₹1,499)',
      'Limited event claiming',
      'Create & publish events'
    ],
    features: [
      { title: 'Free Registration (Work Email)', included: true, detail: '₹0 for corporate domain, ₹1,499 for general' },
      { title: 'Claim Any Number of Expos', included: true, detail: 'Limit 3 expo claims per day' },
      { title: 'Create & Publish Events', included: true, detail: 'New, upcoming & prospective B2B/B2C expos' },
      { title: 'Token Ticket Demand Test', included: true, detail: '1 / 10 nominal token response activation' },
      { title: 'Lead Counts & Interest Volume', included: true, detail: 'Real-time counters visible (details masked)' },
      { title: 'Full Ticket Monetization', included: false, detail: 'Unlocked in paid plans' },
      { title: 'Lead Details Unmasked', included: false, detail: 'Unlocked in paid plans' },
      { title: 'Lead CSV/Excel Export', included: false, detail: 'Unlocked in Enterprise' }
    ],
    comparisonDetails: [
      { featureKey: 'detailed_lead_access', label: 'Detailed Lead Access', category: 'Lead Intelligence', value: 'Masked (Counts & volume visible)', status: 'limited' },
      { featureKey: 'lead_crm', label: 'Lead CRM', category: 'Lead Intelligence', value: 'Basic operational counters', status: 'limited' },
      { featureKey: 'lead_export', label: 'Lead Export', category: 'Lead Intelligence', value: 'Not Available', status: 'unavailable' },
      { featureKey: 'lead_search', label: 'Lead Search & Filtering', category: 'Lead Intelligence', value: 'Basic', status: 'limited' },
      { featureKey: 'visitor_exhibitor_vendor_leads', label: 'Visitor / Exhibitor / Vendor Leads', category: 'Lead Intelligence', value: 'Masked', status: 'limited' },
      { featureKey: 'venue_designer_organizer_leads', label: 'Venue / Designer / Organizer Leads', category: 'Lead Intelligence', value: 'Masked', status: 'limited' },
      { featureKey: 'ticket_platform_expo_mgmt_leads', label: 'Ticket Platform / Expo Mgmt Leads', category: 'Lead Intelligence', value: 'Masked', status: 'limited' },
      { featureKey: 'paid_ticket_selling', label: 'Paid Ticket Selling', category: 'Ticketing & Commerce', value: 'Not included (1/10 demand test only)', status: 'unavailable' },
      { featureKey: 'payment_gateway', label: 'Payment Gateway', category: 'Ticketing & Commerce', value: 'Not included', status: 'unavailable' },
      { featureKey: 'ticket_sales_analytics', label: 'Ticket Sales Analytics', category: 'Ticketing & Commerce', value: 'Demand stats only', status: 'limited' },
      { featureKey: 'exhibitor_management', label: 'Exhibitor Management', category: 'Operations & Validation', value: 'Basic', status: 'limited' },
      { featureKey: 'proposed_expo_validation', label: 'Proposed Expo Validation', category: 'Operations & Validation', value: '4,999 per proposed event', status: 'paid_extra' },
      { featureKey: 'interest_analysis', label: 'Interest Analysis', category: 'Operations & Validation', value: 'Basic volume', status: 'limited' },
      { featureKey: 'demand_analysis', label: 'B2B / B2C Demand Analysis', category: 'Operations & Validation', value: 'Basic', status: 'limited' },
      { featureKey: 'active_events', label: 'Active Events', category: 'Operations & Validation', value: 'Unlimited', status: 'available' },
      { featureKey: 'marketing_campaigns', label: 'Marketing Campaigns', category: 'Promotion & Support', value: 'Growth Plan (Paid separately)', status: 'paid_extra' },
      { featureKey: 'priority_search', label: 'Priority Search / Featured Placement', category: 'Promotion & Support', value: 'No (Organic)', status: 'unavailable' },
      { featureKey: 'support', label: 'Support', category: 'Promotion & Support', value: 'Community & Email', status: 'limited' }
    ],
    growthServices: [],
    isActive: true,
    isPopular: false,
    sortOrder: 1
  },
  {
    planId: 'starter',
    name: 'Organizer Starter',
    tagline: 'Get more leads and unlock valuable organizer tools.',
    description: 'Get more leads and unlock valuable organizer tools.',
    badge: '👑 Most Popular →',
    badgeColor: 'bg-red-600 text-white font-semibold',
    pricing: {
      corporateEmailPrice: 0,
      generalEmailPrice: 0,
      quarterlyPrice: 14999,
      yearlyPrice: 49999,
      proposedEventResearchPrice: 0,
      currency: 'INR',
      currencySymbol: '₹',
      billingNote: '₹14,999 per quarter · ₹49,999 per year (Save 17%)'
    },
    bestFor: [
      'You organize one or a few events',
      'Want genuine leads and contacts',
      'Need tools to manage your events'
    ],
    keyInclusions: [
      'Everything in Free plan',
      'Detailed lead access',
      'Basic lead management (CRM)',
      'Advanced event search',
      'Visitor, exhibitor & vendor leads',
      'In-dashboard lead CRM & pipeline'
    ],
    highlights: [
      'Everything in Free plan',
      'Detailed lead access',
      'Basic lead management (CRM)',
      'Advanced event search',
      'Visitor, exhibitor & vendor leads',
      'In-dashboard lead CRM & pipeline'
    ],
    features: [
      { title: 'Everything in Free Plan', included: true, detail: 'All claiming & prospective event features' },
      { title: 'Full Unmasked Lead Access', included: true, detail: 'Visitor, exhibitor, vendor & partner leads' },
      { title: 'Operational Lead CRM', included: true, detail: 'Basic pipeline tracking and follow-up stages' },
      { title: 'Paid Ticket Selling Unlocked', included: true, detail: 'Monetize delegate passes & visitor tickets' },
      { title: 'Integrated Payment Gateway', included: true, detail: 'Instant bank settlements support' },
      { title: 'Ticket Sales Analytics', included: true, detail: 'Basic transactions and revenue metrics' },
      { title: 'Proposed Expo Validation Allowance', included: true, detail: 'Test ideas with included allowance' },
      { title: 'Unlimited Active Events', included: true, detail: 'Manage as many expos as you run' },
      { title: 'Priority Support', included: true, detail: 'Fast-track response via email & dashboard' },
      { title: 'Lead CSV/Excel Export', included: false, detail: 'Unlocked in Enterprise' },
      { title: 'Featured Top Placement', included: false, detail: 'Available in Enterprise' }
    ],
    comparisonDetails: [
      { featureKey: 'detailed_lead_access', label: 'Detailed Lead Access', category: 'Lead Intelligence', value: 'Full', status: 'available' },
      { featureKey: 'lead_crm', label: 'Lead CRM', category: 'Lead Intelligence', value: 'Basic operational CRM', status: 'available' },
      { featureKey: 'lead_export', label: 'Lead Export', category: 'Lead Intelligence', value: 'Not Available', status: 'unavailable' },
      { featureKey: 'lead_search', label: 'Lead Search & Filtering', category: 'Lead Intelligence', value: 'Ok', status: 'available' },
      { featureKey: 'visitor_exhibitor_vendor_leads', label: 'Visitor / Exhibitor / Vendor Leads', category: 'Lead Intelligence', value: 'Unlocked', status: 'available' },
      { featureKey: 'venue_designer_organizer_leads', label: 'Venue / Designer / Organizer Leads', category: 'Lead Intelligence', value: 'Unlocked', status: 'available' },
      { featureKey: 'ticket_platform_expo_mgmt_leads', label: 'Ticket Platform / Expo Mgmt Leads', category: 'Lead Intelligence', value: 'Unlocked', status: 'available' },
      { featureKey: 'paid_ticket_selling', label: 'Paid Ticket Selling', category: 'Ticketing & Commerce', value: 'Unlocked', status: 'available' },
      { featureKey: 'payment_gateway', label: 'Payment Gateway', category: 'Ticketing & Commerce', value: 'Ok', status: 'available' },
      { featureKey: 'ticket_sales_analytics', label: 'Ticket Sales Analytics', category: 'Ticketing & Commerce', value: 'Basic', status: 'available' },
      { featureKey: 'exhibitor_management', label: 'Exhibitor Management', category: 'Operations & Validation', value: 'Basic', status: 'available' },
      { featureKey: 'proposed_expo_validation', label: 'Proposed Expo Validation', category: 'Operations & Validation', value: 'Limited allowance', status: 'available' },
      { featureKey: 'interest_analysis', label: 'Interest Analysis', category: 'Operations & Validation', value: 'Basic', status: 'available' },
      { featureKey: 'demand_analysis', label: 'B2B / B2C Demand Analysis', category: 'Operations & Validation', value: 'Basic', status: 'available' },
      { featureKey: 'active_events', label: 'Active Events', category: 'Operations & Validation', value: 'Unlimited', status: 'available' },
      { featureKey: 'marketing_campaigns', label: 'Marketing Campaigns', category: 'Promotion & Support', value: 'Growth Plan', status: 'paid_extra' },
      { featureKey: 'priority_search', label: 'Priority Search / Featured Placement', category: 'Promotion & Support', value: 'No', status: 'unavailable' },
      { featureKey: 'support', label: 'Support', category: 'Promotion & Support', value: 'Priority', status: 'available' }
    ],
    growthServices: [],
    isActive: true,
    isPopular: true,
    sortOrder: 2
  },
  {
    planId: 'enterprise',
    name: 'Organizer Enterprise',
    tagline: 'Advanced tools for multiple expos and enterprise operations.',
    description: 'Advanced tools for multiple expos and enterprise operations.',
    badge: 'For Large Organizers',
    badgeColor: 'bg-blue-50 text-blue-700 border border-blue-200',
    pricing: {
      corporateEmailPrice: 0,
      generalEmailPrice: 0,
      quarterlyPrice: 89999,
      yearlyPrice: 299999,
      proposedEventResearchPrice: 0,
      currency: 'INR',
      currencySymbol: '₹',
      billingNote: '₹89,999 per quarter · ₹2,99,999 per year (Save 17%)'
    },
    bestFor: [
      'You manage multiple expos',
      'Need advanced analytics & tools',
      'Require API and bulk export options'
    ],
    keyInclusions: [
      'Everything in Starter plan',
      'Advanced CRM & analytics',
      'Multiple expos management',
      'Developer API & webhooks',
      'Unlimited lead report export (CSV & Excel)',
      'Advanced search & filtering'
    ],
    highlights: [
      'Everything in Starter plan',
      'Advanced CRM & analytics',
      'Multiple expos management',
      'Developer API & webhooks',
      'Unlimited lead report export (CSV & Excel)',
      'Advanced search & filtering'
    ],
    features: [
      { title: 'Everything in Starter Plan', included: true, detail: 'All operational & ticketing features' },
      { title: 'Full + Advanced Lead Intelligence', included: true, detail: 'Search database, intent score & analytics' },
      { title: 'Advanced CRM + API Access', included: true, detail: 'Full REST API keys for your custom ERP / CRM' },
      { title: 'Unlimited Lead Export', included: true, detail: 'Instant CSV & Excel downloads with zero restrictions' },
      { title: 'Venue, Designer & Organizer Database', included: true, detail: 'Full searchable partner & supplier database' },
      { title: 'Private / Custom Payment Gateway', included: true, detail: 'Route funds through your enterprise merchant IDs' },
      { title: 'Advanced Ticket Sales Analytics', included: true, detail: 'Cohort retention, delegate breakdowns, custom reports' },
      { title: 'Advance Exhibitor Management', included: true, detail: 'Booth mapping, exhibitor logins & QR scanner' },
      { title: 'Multiple Proposed Expo Validations', included: true, detail: 'Run multiple idea tests with dedicated campaigns' },
      { title: 'Detailed Category Demand Analysis', included: true, detail: 'In-depth market intelligence across B2B & B2C' },
      { title: 'Priority Search & Featured Placement', included: true, detail: 'Top expo display and side search promotion' },
      { title: 'Faster Priority VIP Support', included: true, detail: 'Dedicated Account Manager & phone escalation SLA' }
    ],
    comparisonDetails: [
      { featureKey: 'detailed_lead_access', label: 'Detailed Lead Access', category: 'Lead Intelligence', value: 'Full + advanced', status: 'advanced' },
      { featureKey: 'lead_crm', label: 'Lead CRM', category: 'Lead Intelligence', value: 'Advanced CRM + API', status: 'advanced' },
      { featureKey: 'lead_export', label: 'Lead Export', category: 'Lead Intelligence', value: 'Unlimited', status: 'advanced' },
      { featureKey: 'lead_search', label: 'Lead Search & Filtering', category: 'Lead Intelligence', value: 'Advanced', status: 'advanced' },
      { featureKey: 'visitor_exhibitor_vendor_leads', label: 'Visitor / Exhibitor / Vendor Leads', category: 'Lead Intelligence', value: 'Full + analytics', status: 'advanced' },
      { featureKey: 'venue_designer_organizer_leads', label: 'Venue / Designer / Organizer Leads', category: 'Lead Intelligence', value: 'Full + analytics + Search Database', status: 'advanced' },
      { featureKey: 'ticket_platform_expo_mgmt_leads', label: 'Ticket Platform / Expo Mgmt Leads', category: 'Lead Intelligence', value: 'Full + analytics', status: 'advanced' },
      { featureKey: 'paid_ticket_selling', label: 'Paid Ticket Selling', category: 'Ticketing & Commerce', value: 'Advanced / private payment Gateway Integration', status: 'advanced' },
      { featureKey: 'payment_gateway', label: 'Payment Gateway', category: 'Ticketing & Commerce', value: 'Ok', status: 'advanced' },
      { featureKey: 'ticket_sales_analytics', label: 'Ticket Sales Analytics', category: 'Ticketing & Commerce', value: 'Advanced', status: 'advanced' },
      { featureKey: 'exhibitor_management', label: 'Exhibitor Management', category: 'Operations & Validation', value: 'Advance', status: 'advanced' },
      { featureKey: 'proposed_expo_validation', label: 'Proposed Expo Validation', category: 'Operations & Validation', value: 'Multiple Events', status: 'advanced' },
      { featureKey: 'interest_analysis', label: 'Interest Analysis', category: 'Operations & Validation', value: 'Detailed category-wise', status: 'advanced' },
      { featureKey: 'demand_analysis', label: 'B2B / B2C Demand Analysis', category: 'Operations & Validation', value: 'Advance', status: 'advanced' },
      { featureKey: 'active_events', label: 'Active Events', category: 'Operations & Validation', value: 'Unlimited', status: 'advanced' },
      { featureKey: 'marketing_campaigns', label: 'Marketing Campaigns', category: 'Promotion & Support', value: 'Growth Plan', status: 'paid_extra' },
      { featureKey: 'priority_search', label: 'Priority Search / Featured Placement', category: 'Promotion & Support', value: 'Available', status: 'advanced' },
      { featureKey: 'support', label: 'Support', category: 'Promotion & Support', value: 'Faster priority', status: 'advanced' }
    ],
    growthServices: [],
    isActive: true,
    isPopular: false,
    sortOrder: 3
  },
  {
    planId: 'growth',
    name: 'Organizer Growth',
    tagline: 'Boost your event visibility with our promotion services.',
    description: 'Boost your event visibility with our promotion services.',
    badge: 'Marketing Engine',
    badgeColor: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    pricing: {
      corporateEmailPrice: 0,
      generalEmailPrice: 0,
      quarterlyPrice: 1000,
      yearlyPrice: 0,
      proposedEventResearchPrice: 4999,
      currency: 'INR',
      currencySymbol: '₹',
      billingNote: 'From ₹1,000 per top-up pack'
    },
    bestFor: [
      'You want more visibility & reach',
      'Need targeted promotion for events',
      'Want flexible, pay-as-you-go options'
    ],
    keyInclusions: [
      'Top-up packs from ₹1,000',
      'Use across 13 promotion channels',
      'Flexible point-wise pricing',
      'Google listing & search visibility',
      'Social media optimization (SMO)',
      'Paid lead generation options'
    ],
    highlights: [
      'Top-up packs from ₹1,000',
      'Use across 13 promotion channels',
      'Flexible point-wise pricing',
      'Google listing & search visibility',
      'Social media optimization (SMO)',
      'Paid lead generation options'
    ],
    features: [
      { title: 'Top-Up Packs from ₹1,000', included: true, detail: 'Flexible scale with zero lock-in' },
      { title: '13 Specialized Marketing Channels', included: true, detail: 'Digital, messaging, voice and on-site display' },
      { title: 'Targeted Buyer Acquisition', included: true, detail: 'Drive verified attendees and booth buyers' },
      { title: 'Real-Time ROI Campaign Analytics', included: true, detail: 'Inspect clicks, deliveries and converted inquiries' }
    ],
    comparisonDetails: [],
    growthServices: [
      {
        serviceId: 'google_listing',
        name: 'Google Listing',
        category: 'Digital & Ads',
        pricingModel: 'Paid separately / Custom',
        priceStartsAt: 2500,
        unit: 'per listing campaign',
        description: 'Get your exhibition indexed and highlighted with Google Knowledge Panel, Google Maps business integration, and local event search.',
        deliverables: ['Google Business Listing configuration', 'Rich Event Snippets Schema markup', 'Search Console indexing boost'],
        isActive: true,
        sortOrder: 1
      },
      {
        serviceId: 'paid_lead_gen_smo',
        name: 'Paid Lead Generation / SMO',
        category: 'Digital & Ads',
        pricingModel: 'Point-wise / Campaign',
        priceStartsAt: 5000,
        unit: 'per campaign',
        description: 'Targeted buyer and exhibitor lead acquisition across LinkedIn, Instagram, Facebook, and industry networks.',
        deliverables: ['High-converting ad copy & creatives', 'Targeted B2B/B2C audience segmentation', 'Direct lead delivery to your CRM'],
        isActive: true,
        sortOrder: 2
      },
      {
        serviceId: 'seo_digital_marketing',
        name: 'SEO / Digital Marketing',
        category: 'Digital & Ads',
        pricingModel: 'Starting from ₹3,000',
        priceStartsAt: 3000,
        unit: 'per month',
        description: 'Comprehensive search engine optimization for your expo landing pages to capture top Google rankings for industry keywords.',
        deliverables: ['High-volume industry keyword targeting', 'Backlink authority syndication', 'Organic ranking monitoring'],
        isActive: true,
        sortOrder: 3
      },
      {
        serviceId: 'ai_promotion',
        name: 'AI Promotion',
        category: 'Digital & Ads',
        pricingModel: 'Point-wise / From ₹1,500',
        priceStartsAt: 1500,
        unit: 'per campaign',
        description: 'AI-driven delegate recommendation matching, smart content generation, and automated audience personalization.',
        deliverables: ['Algorithmic buyer-seller matchmaking', 'Automated personalized outreach copy', 'AI sentiment & engagement scoring'],
        isActive: true,
        sortOrder: 4
      },
      {
        serviceId: 'sms_promotion',
        name: 'SMS Promotion',
        category: 'Direct Outreach',
        pricingModel: 'Point-wise (₹0.25 - ₹0.40 per SMS)',
        priceStartsAt: 1000,
        unit: 'per 2,500 SMS',
        description: 'Direct DLT-approved transactional & promotional SMS alerts sent to pre-vetted trade delegates in your city.',
        deliverables: ['100% DLT compliant delivery', 'Custom sender ID option', 'Delivery status & click tracking'],
        isActive: true,
        sortOrder: 5
      },
      {
        serviceId: 'whatsapp_broadcast',
        name: 'WhatsApp Broadcast Promotion',
        category: 'Direct Outreach',
        pricingModel: 'Point-wise (₹0.85 per message)',
        priceStartsAt: 2000,
        unit: 'per 2,000 msgs',
        description: 'Official WhatsApp Business API rich broadcast messages with interactive buttons, event brochures, and fast-track RSVP links.',
        deliverables: ['Green tick verified API gateway', 'Rich media brochure & CTA buttons', 'Interactive auto-reply flow'],
        isActive: true,
        sortOrder: 6
      },
      {
        serviceId: 'email_promotion',
        name: 'Email Promotion',
        category: 'Direct Outreach',
        pricingModel: 'Point-wise / From ₹1,500',
        priceStartsAt: 1500,
        unit: 'per 10,000 emails',
        description: 'Direct HTML newsletter campaigns delivered to segmented VisitExpo trade subscribers across specific industry sectors.',
        deliverables: ['Dedicated SMTP warm routing', 'Responsive newsletter layout', 'Open & click attribution reporting'],
        isActive: true,
        sortOrder: 7
      },
      {
        serviceId: 'ivr_promotion',
        name: 'IVR Promotion',
        category: 'Direct Outreach',
        pricingModel: 'Point-wise (Voice broadcast)',
        priceStartsAt: 2500,
        unit: 'per 2,000 calls',
        description: 'Automated interactive voice response calls with pre-recorded celebrity or organizer invites and 1-key confirmation.',
        deliverables: ['High-throughput automated calling', 'Custom recorded studio voiceover', 'Key-press attendee confirmation logs'],
        isActive: true,
        sortOrder: 8
      },
      {
        serviceId: 'push_notifications',
        name: 'VisitExpo Push Notifications',
        category: 'Platform Spotlight',
        pricingModel: 'Starting from ₹1,000',
        priceStartsAt: 1000,
        unit: 'per broadcast',
        description: 'Instant mobile and web push notifications delivered to active VisitExpo delegates searching for events in your region.',
        deliverables: ['Delivered directly to mobile & browser lock screens', 'Instant deep-link to event ticketing', 'High click-through rate (CTR)'],
        isActive: true,
        sortOrder: 9
      },
      {
        serviceId: 'website_banner_popup',
        name: 'Website Banner / Popup',
        category: 'Platform Spotlight',
        pricingModel: 'Starting from ₹3,500',
        priceStartsAt: 3500,
        unit: 'per week',
        description: 'High-impact homepage hero banner or targeted category exit popup spotlighting your upcoming exhibition.',
        deliverables: ['Prime visual real estate on visitexpo.in', 'Geotargeted by user city/state', 'Direct CTA clickthrough tracking'],
        isActive: true,
        sortOrder: 10
      },
      {
        serviceId: 'side_expo_display_search',
        name: 'Side Expo Display in Search',
        category: 'Platform Spotlight',
        pricingModel: 'Starting from ₹2,500',
        priceStartsAt: 2500,
        unit: 'per 2 weeks',
        description: 'Prominent side banner placement displayed beside search results when visitors browse expos in your category.',
        deliverables: ['Always-in-view sticky sidebar display', 'Contextual category matching', 'Branded badge & CTA'],
        isActive: true,
        sortOrder: 11
      },
      {
        serviceId: 'top_expo_display',
        name: 'Top Expo Display',
        category: 'Platform Spotlight',
        pricingModel: 'Starting from ₹5,000',
        priceStartsAt: 5000,
        unit: 'per week',
        description: 'Pinned top placement (#1 featured position) on city and category expo listings with "Featured Exhibition" badge.',
        deliverables: ['#1 pinned search position', 'Featured glowing border & badge', 'Maximum footfall and inquiry volume'],
        isActive: true,
        sortOrder: 12
      },
      {
        serviceId: 'member_external_audience',
        name: 'Member + External Audience Promotion',
        category: 'Comprehensive Promotion',
        pricingModel: 'Paid separately; targeting rules finalized',
        priceStartsAt: 10000,
        unit: 'per campaign',
        description: 'Syndicated promotion combining VisitExpo registered delegates with external audited industry databases and chamber of commerce networks.',
        deliverables: ['Audited industry member lists', 'Custom geography & trade turnover targeting', 'Dedicated campaign manager'],
        isActive: true,
        sortOrder: 13
      }
    ],
    isActive: true,
    isPopular: false,
    sortOrder: 4
  }
];

// Helper: seed default official plans if DB is empty or backfill simplified descriptions
export const seedDefaultPlansIfEmpty = async () => {
  const count = await Plan.countDocuments();
  if (count === 0) {
    await Plan.insertMany(DEFAULT_OFFICIAL_PLANS);
    console.log('[Plan Service] Initialized 4 default official plans (Free, Starter, Enterprise, Growth).');
  } else {
    // Ensure all official core plans have the latest simplified descriptions and inclusions
    for (const planData of DEFAULT_OFFICIAL_PLANS) {
      await Plan.updateOne(
        { planId: planData.planId },
        {
          $set: {
            tagline: planData.tagline,
            description: planData.description,
            badge: planData.badge,
            bestFor: planData.bestFor,
            keyInclusions: planData.keyInclusions
          }
        }
      );
    }
  }
};

// ==========================================
// PUBLIC ROUTES
// ==========================================

// @desc    Get all active plans for public display on website
// @route   GET /api/plans
router.get('/', async (req, res, next) => {
  try {
    await seedDefaultPlansIfEmpty();

    const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1 });

    res.status(200).json({
      success: true,
      data: plans
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get single plan details by planId
// @route   GET /api/plans/:planId
router.get('/:planId', async (req, res, next) => {
  try {
    const { planId } = req.params;
    let plan = await Plan.findOne({ planId: planId.toLowerCase() });

    if (!plan) {
      // Check default fallback
      plan = DEFAULT_OFFICIAL_PLANS.find(p => p.planId === planId.toLowerCase());
    }

    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    res.status(200).json({
      success: true,
      data: plan
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Submit plan inquiry, upgrade request, prospective research, or growth top-up
// @route   POST /api/plans/inquire
router.post('/inquire', async (req, res, next) => {
  try {
    const {
      planId,
      planName,
      billingCycle,
      organizerName,
      organizationName,
      email,
      emailType,
      phone,
      city,
      eventType,
      eventName,
      selectedGrowthServices,
      estimatedBudget,
      message
    } = req.body;

    if (!organizerName || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and phone number are required.'
      });
    }

    // Auto-detect corporate vs general email if not specified
    let detectedEmailType = emailType;
    if (!detectedEmailType && email) {
      const domain = email.split('@')[1]?.toLowerCase();
      const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'rediffmail.com', 'zoho.com'];
      detectedEmailType = freeProviders.includes(domain) ? 'general' : 'corporate';
    }

    const inquiry = await PlanInquiry.create({
      planId: planId || 'starter',
      planName: planName || (planId === 'enterprise' ? 'Organizer Enterprise' : planId === 'growth' ? 'Organizer Growth' : planId === 'free' ? 'Free Organizer' : 'Organizer Starter'),
      billingCycle: billingCycle || 'quarterly',
      organizerName,
      organizationName: organizationName || 'Individual Organizer',
      email,
      emailType: detectedEmailType || 'general',
      phone,
      city: city || '',
      eventType: eventType || 'Trade Show / B2B',
      eventName: eventName || '',
      selectedGrowthServices: Array.isArray(selectedGrowthServices) ? selectedGrowthServices : [],
      estimatedBudget: estimatedBudget || '',
      message: message || '',
      status: 'new'
    });

    res.status(201).json({
      success: true,
      message: 'Your inquiry has been received! Our exhibition team will get in touch shortly.',
      data: inquiry
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// ADMIN PROTECTED ROUTES
// ==========================================

// @desc    Admin: Get all plans (including inactive) + stats
// @route   GET /api/plans/admin/all
router.get('/admin/all', protect, authorize('super_admin', 'sub_admin', 'subadmin', 'admin'), async (req, res, next) => {
  try {
    await seedDefaultPlansIfEmpty();

    const plans = await Plan.find().sort({ sortOrder: 1 });
    
    // Aggregates for Admin Dashboard
    const totalInquiries = await PlanInquiry.countDocuments();
    const newInquiries = await PlanInquiry.countDocuments({ status: 'new' });
    const activeSubscriptions = await Subscription.countDocuments({ status: 'active' });

    res.status(200).json({
      success: true,
      data: plans,
      stats: {
        totalPlans: plans.length,
        activePlans: plans.filter(p => p.isActive).length,
        totalInquiries,
        newInquiries,
        activeSubscriptions
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Create new custom plan tier
// @route   POST /api/plans/admin
router.post('/admin', protect, authorize('super_admin', 'sub_admin', 'subadmin', 'admin'), async (req, res, next) => {
  try {
    const { planId, name, tagline, description, badge, badgeColor, pricing, highlights, features, comparisonDetails, growthServices, isActive, isPopular, sortOrder } = req.body;

    if (!planId || !name) {
      return res.status(400).json({ success: false, message: 'Plan ID and name are required.' });
    }

    const existing = await Plan.findOne({ planId: planId.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: `A plan with ID "${planId}" already exists.` });
    }

    const newPlan = await Plan.create({
      planId: planId.toLowerCase(),
      name,
      tagline: tagline || '',
      description: description || '',
      badge: badge || '',
      badgeColor: badgeColor || 'bg-primary text-black',
      pricing: pricing || {},
      highlights: highlights || [],
      features: features || [],
      comparisonDetails: comparisonDetails || [],
      growthServices: growthServices || [],
      isActive: isActive !== false,
      isPopular: !!isPopular,
      sortOrder: sortOrder || 99
    });

    res.status(201).json({
      success: true,
      message: 'New pricing plan created successfully.',
      data: newPlan
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Update existing plan
// @route   PUT /api/plans/admin/:id
router.put('/admin/:id', protect, authorize('super_admin', 'sub_admin', 'subadmin', 'admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (updates.name !== undefined && !updates.name.trim()) {
      return res.status(400).json({ success: false, message: 'Plan name cannot be empty.' });
    }

    if (updates.pricing) {
      const {
        corporateEmailPrice,
        generalEmailPrice,
        quarterlyPrice,
        yearlyPrice,
        proposedEventResearchPrice
      } = updates.pricing;

      const prices = [
        { key: 'Corporate Email Price', val: corporateEmailPrice },
        { key: 'General Email Price', val: generalEmailPrice },
        { key: 'Quarterly Price', val: quarterlyPrice },
        { key: 'Yearly Price', val: yearlyPrice },
        { key: 'Proposed Event Research Price', val: proposedEventResearchPrice }
      ];

      for (const p of prices) {
        if (p.val !== undefined && p.val !== null && p.val !== '') {
          const num = Number(p.val);
          if (isNaN(num) || num < 0) {
            return res.status(400).json({
              success: false,
              message: `${p.key} cannot be a negative number or invalid value.`
            });
          }
        }
      }
    }

    const plan = await Plan.findByIdAndUpdate(id, updates, { new: true, runValidators: true });

    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }

    res.status(200).json({
      success: true,
      message: `Plan "${plan.name}" updated successfully.`,
      data: plan
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Toggle active status or delete custom plan
// @route   DELETE /api/plans/admin/:id
router.delete('/admin/:id', protect, authorize('super_admin', 'sub_admin', 'subadmin', 'admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const plan = await Plan.findById(id);

    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }

    // Protect official core plans from permanent deletion (deactivate instead)
    if (['free', 'starter', 'enterprise', 'growth'].includes(plan.planId)) {
      plan.isActive = !plan.isActive;
      await plan.save();
      return res.status(200).json({
        success: true,
        message: `Official plan "${plan.name}" active status set to ${plan.isActive}.`,
        data: plan
      });
    }

    await Plan.findByIdAndDelete(id);
    res.status(200).json({
      success: true,
      message: `Plan "${plan.name}" permanently deleted.`
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Reset / Re-seed official default plans
// @route   POST /api/plans/admin/seed-defaults
router.post('/admin/seed-defaults', protect, authorize('super_admin', 'sub_admin', 'subadmin', 'admin'), async (req, res, next) => {
  try {
    for (const planData of DEFAULT_OFFICIAL_PLANS) {
      await Plan.findOneAndUpdate(
        { planId: planData.planId },
        { $set: planData },
        { upsert: true, new: true }
      );
    }

    const updatedPlans = await Plan.find().sort({ sortOrder: 1 });

    res.status(200).json({
      success: true,
      message: 'Official VisitExpo pricing plans have been successfully seeded and restored to defaults.',
      data: updatedPlans
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Get all organizer plan inquiries & top-up requests
// @route   GET /api/plans/admin/inquiries
router.get('/admin/inquiries', protect, authorize('super_admin', 'sub_admin', 'subadmin', 'admin'), async (req, res, next) => {
  try {
    const { status, planId, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }
    if (planId && planId !== 'all') {
      query.planId = planId;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [inquiries, total] = await Promise.all([
      PlanInquiry.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      PlanInquiry.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: inquiries,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Update plan inquiry status or add admin notes
// @route   PATCH /api/plans/admin/inquiries/:id
router.patch('/admin/inquiries/:id', protect, authorize('super_admin', 'sub_admin', 'subadmin', 'admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const inquiry = await PlanInquiry.findById(id);
    if (!inquiry) {
      return res.status(404).json({ success: false, message: 'Inquiry record not found.' });
    }

    if (status) inquiry.status = status;
    if (adminNotes !== undefined) inquiry.adminNotes = adminNotes;
    if (status === 'contacted' || status === 'converted') {
      inquiry.respondedAt = new Date();
    }

    await inquiry.save();

    res.status(200).json({
      success: true,
      message: 'Inquiry record updated successfully.',
      data: inquiry
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Search users for plan assignment
// @route   GET /api/plans/admin/users
router.get('/admin/users', protect, authorize('super_admin', 'sub_admin', 'subadmin', 'admin'), async (req, res, next) => {
  try {
    const { q, role, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (role && role !== 'all') {
      filter.role = role;
    }

    if (q && q.trim()) {
      const regex = new RegExp(q.trim(), 'i');
      filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('name email role isVerified emailType plan planStatus isPlanActive planPaidAmount organization phone city createdAt')
        .populate('organization', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: users,
      total
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Assign plan to any user with optional no-charge general mail waiver
// @route   POST /api/plans/admin/assign-plan
router.post('/admin/assign-plan', protect, authorize('super_admin', 'sub_admin', 'subadmin', 'admin'), async (req, res, next) => {
  try {
    const {
      userId,
      userIds,
      planId = 'free',
      billingCycle = 'yearly',
      noChargeForGeneralMail = true,
      price = 0,
      isVerified = true,
      upgradeRoleToOrganizer = true,
      adminNotes = '',
      durationDays
    } = req.body;

    const targetUserIds = Array.isArray(userIds) && userIds.length > 0
      ? userIds
      : (userId ? [userId] : []);

    if (targetUserIds.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one User ID is required.' });
    }

    // Ensure Custom Duration cannot be negative
    const parsedDurationDays = durationDays !== undefined && durationDays !== '' && durationDays !== null
      ? Math.max(0, Number(durationDays))
      : undefined;

    const targetPlanId = planId || 'free';

    // Calculate final price: if corporate or noChargeForGeneralMail is true, price is 0
    let finalPrice = price !== undefined ? Math.max(0, Number(price)) : 0;
    if (noChargeForGeneralMail && targetPlanId === 'free') {
      finalPrice = 0;
    }

    // Calculate duration
    let durationMs;
    if (parsedDurationDays && parsedDurationDays > 0) {
      durationMs = parsedDurationDays * 24 * 60 * 60 * 1000;
    } else if (billingCycle === 'lifetime' || targetPlanId === 'free') {
      durationMs = 10 * 365 * 24 * 60 * 60 * 1000; // 10 years
    } else if (billingCycle === 'yearly') {
      durationMs = 365 * 24 * 60 * 60 * 1000;
    } else {
      durationMs = 90 * 24 * 60 * 60 * 1000; // quarterly
    }

    const assignedUsers = [];
    let lastSubscription = null;

    for (const uId of targetUserIds) {
      const user = await User.findById(uId);
      if (!user) continue;

      const isCorporate = isCorporateEmail(user.email);

      // Upgrade role to organizer if requested
      if (upgradeRoleToOrganizer && user.role !== 'organizer') {
        user.role = 'organizer';
      }

      user.plan = targetPlanId;
      user.planStatus = 'active';
      user.isPlanActive = true;
      if (isVerified) {
        user.isVerified = true;
      }
      user.emailType = isCorporate ? 'corporate' : 'general';
      user.planPaidAmount = finalPrice;
      await user.save();

      // Ensure Organization exists for organizer
      let orgId = user.organization;
      if (!orgId) {
        const org = await Organization.create({
          name: `${(user.name || 'User').trim()}'s Organization`,
          contact: { email: user.email, phone: user.phone || '' },
          teamMembers: [{ user: user._id, role: user.role }]
        });
        orgId = org._id;
        user.organization = orgId;
        await user.save();
      }

      // Create or update subscription record
      lastSubscription = await Subscription.findOneAndUpdate(
        { organization: orgId },
        {
          organization: orgId,
          user: user._id,
          plan: targetPlanId,
          emailType: user.emailType,
          status: 'active',
          price: finalPrice,
          paymentCycle: billingCycle === 'lifetime' ? 'one_time' : billingCycle,
          startDate: new Date(),
          endDate: new Date(Date.now() + durationMs),
          adminNotes: adminNotes || `Assigned by admin ${req.user?.name || 'Super Admin'} (No charge for general mail: ${noChargeForGeneralMail ? 'Yes' : 'No'})`
        },
        { upsert: true, new: true }
      );

      assignedUsers.push({
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: user.plan
      });
    }

    if (assignedUsers.length === 0) {
      return res.status(404).json({ success: false, message: 'No valid users found to assign plan.' });
    }

    const message = assignedUsers.length === 1
      ? `Plan "${targetPlanId.toUpperCase()}" assigned successfully to ${assignedUsers[0].name} (${assignedUsers[0].email}). ${noChargeForGeneralMail ? 'No charge applied for general mail (Fee waived: ₹0).' : ''}`
      : `Plan "${targetPlanId.toUpperCase()}" assigned successfully to ${assignedUsers.length} users. ${noChargeForGeneralMail ? 'No charge applied for general mail (Fee waived: ₹0).' : ''}`;

    res.status(200).json({
      success: true,
      message,
      data: {
        count: assignedUsers.length,
        users: assignedUsers,
        user: assignedUsers[0],
        subscription: lastSubscription
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: Toggle global "No charge for general mail" on Free Organizer Plan
// @route   POST /api/plans/admin/toggle-general-mail-charge
router.post('/admin/toggle-general-mail-charge', protect, authorize('super_admin', 'sub_admin', 'subadmin', 'admin'), async (req, res, next) => {
  try {
    const noCharge = req.body.noCharge !== undefined 
      ? !!req.body.noCharge 
      : (req.body.makeFree !== undefined 
          ? !!req.body.makeFree 
          : Number(req.body.price) === 0);
    const targetPrice = noCharge ? 0 : 1499;

    const updatedPlan = await Plan.findOneAndUpdate(
      { planId: 'free' },
      { $set: { 'pricing.generalEmailPrice': targetPrice } },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      message: noCharge
        ? 'Free Organizer plan updated: No charge for general mail! Personal emails (@gmail, etc) now register for 100% FREE (₹0).'
        : 'Free Organizer plan updated: General email registration charge set to ₹1,499.',
      generalEmailPrice: targetPrice,
      noCharge: targetPrice === 0,
      plan: updatedPlan
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin: List all assigned organizer subscriptions
// @route   GET /api/plans/admin/assigned-subscriptions
router.get('/admin/assigned-subscriptions', protect, authorize('super_admin', 'sub_admin', 'subadmin', 'admin'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, plan } = req.query;
    const filter = {};
    if (plan && plan !== 'all') {
      filter.plan = plan;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [subscriptions, total] = await Promise.all([
      Subscription.find(filter)
        .populate('user', 'name email role isVerified emailType plan planStatus isPlanActive phone')
        .populate('organization', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Subscription.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: subscriptions,
      total
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Check email domain eligibility for Free Organizer plan (Corporate ₹0 vs General ₹1,499 or dynamic)
// @route   POST /api/plans/check-email
router.post('/check-email', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email address is required.' });
    }

    const isCorporate = isCorporateEmail(email);
    const domain = email.toLowerCase().trim().split('@')[1];

    const freePlan = await Plan.findOne({ planId: 'free' });
    const generalPrice = freePlan?.pricing?.generalEmailPrice !== undefined ? freePlan.pricing.generalEmailPrice : 1499;
    const isNoChargeGeneral = generalPrice === 0;
    const price = isCorporate || isNoChargeGeneral ? 0 : generalPrice;

    res.status(200).json({
      success: true,
      email: email.toLowerCase().trim(),
      domain,
      isCorporate,
      emailType: isCorporate ? 'corporate' : 'general',
      price,
      generalEmailPrice: generalPrice,
      noChargeForGeneralMail: isNoChargeGeneral,
      formattedPrice: price === 0 ? '₹0 (Free / No Charge)' : `₹${price.toLocaleString()} (One-Time Verification)`,
      message: isCorporate
        ? `Corporate business domain (@${domain}) verified! Free Organizer Plan is automatically active upon registration (₹0).`
        : isNoChargeGeneral
        ? `Personal email domain (@${domain}) verified! No charge for general mail promotion is active (₹0 Free).`
        : `Personal email domain (@${domain}) detected. One-time verification fee of ₹${price.toLocaleString()} applies to activate Free Organizer Plan.`
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get current organizer plan & subscription status
// @route   GET /api/plans/my-plan
router.get('/my-plan', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isCorporate = isCorporateEmail(user.email);
    let sub = await Subscription.findOne({
      $or: [
        ...(user.organization ? [{ organization: user.organization }] : []),
        { user: user._id }
      ],
      status: 'active'
    }).sort({ createdAt: -1 });

    if (!sub && user.organization) {
      sub = await Subscription.findOne({
        $or: [
          { organization: user.organization },
          { user: user._id }
        ]
      }).sort({ createdAt: -1 });
    }

    // Auto-sync plan from active subscription if present
    if (sub && sub.status === 'active' && sub.plan) {
      if (user.plan !== sub.plan || !user.isPlanActive || !user.isVerified) {
        user.plan = sub.plan;
        user.planStatus = 'active';
        user.isPlanActive = true;
        user.isVerified = true;
        await user.save();
      }
    }

    const freePlan = await Plan.findOne({ planId: 'free' });
    const generalPrice = freePlan?.pricing?.generalEmailPrice !== undefined ? freePlan.pricing.generalEmailPrice : 1499;
    const isNoChargeGeneral = generalPrice === 0;

    // Auto-activate for corporate email OR when general email is configured as no-charge (if no active paid plan)
    if (user.role === 'organizer' && (isCorporate || isNoChargeGeneral) && !user.isPlanActive && (!sub || sub.status !== 'active')) {
      user.isVerified = true;
      user.emailType = isCorporate ? 'corporate' : 'general';
      user.plan = 'free';
      user.planStatus = 'active';
      user.isPlanActive = true;
      user.planPaidAmount = 0;
      await user.save();

      if (user.organization && (!sub || sub.status !== 'active')) {
        sub = await Subscription.findOneAndUpdate(
          { organization: user.organization },
          {
            plan: 'free',
            emailType: user.emailType,
            status: 'active',
            price: 0,
            paymentCycle: 'quarterly',
            user: user._id,
            startDate: new Date(),
            endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          },
          { upsert: true, new: true }
        );
      }
    }

    res.status(200).json({
      success: true,
      plan: sub?.plan || user.plan || 'free',
      planStatus: sub?.status || user.planStatus || (user.isVerified ? 'active' : 'payment_pending'),
      isPlanActive: sub ? sub.status === 'active' : !!user.isPlanActive,
      isCorporate,
      emailType: user.emailType || (isCorporate ? 'corporate' : 'general'),
      planPaidAmount: sub?.price !== undefined ? sub.price : (user.planPaidAmount || 0),
      generalEmailPrice: generalPrice,
      noChargeForGeneralMail: isNoChargeGeneral,
      hasUnlockedLocationResearch: !!user.hasUnlockedLocationResearch,
      unlockedResearchLocations: user.unlockedResearchLocations || [],
      subscription: sub,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        hasUnlockedLocationResearch: !!user.hasUnlockedLocationResearch
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Activate Free Organizer Plan (₹0 for corporate or no-charge general, ₹1,499 standard general)
// @route   POST /api/plans/activate-free-plan
router.post('/activate-free-plan', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.role !== 'organizer') {
      return res.status(403).json({ success: false, message: 'Only organizers can activate this plan.' });
    }

    const isCorporate = isCorporateEmail(user.email);
    const { transactionId } = req.body;

    const freePlan = await Plan.findOne({ planId: 'free' });
    const generalPrice = freePlan?.pricing?.generalEmailPrice !== undefined ? freePlan.pricing.generalEmailPrice : 1499;
    const isNoChargeGeneral = generalPrice === 0;

    if (isCorporate || isNoChargeGeneral) {
      // 100% Free: Auto-activate immediately
      user.isVerified = true;
      user.emailType = isCorporate ? 'corporate' : 'general';
      user.plan = 'free';
      user.planStatus = 'active';
      user.isPlanActive = true;
      user.planPaidAmount = 0;
      await user.save();

      if (user.organization) {
        await Subscription.findOneAndUpdate(
          { organization: user.organization },
          {
            plan: 'free',
            emailType: user.emailType,
            status: 'active',
            price: 0,
            paymentCycle: 'quarterly',
            user: user._id,
            startDate: new Date(),
            endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          },
          { upsert: true, new: true }
        );
      }

      return res.status(200).json({
        success: true,
        message: isCorporate
          ? 'Free Organizer Plan is active! Corporate business domain verified (₹0).'
          : 'Free Organizer Plan is active! No charge for general mail promotion applied (₹0).',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified,
          emailType: user.emailType,
          plan: user.plan,
          planStatus: user.planStatus,
          isPlanActive: user.isPlanActive,
          planPaidAmount: 0,
          hasUnlockedLocationResearch: !!user.hasUnlockedLocationResearch
        }
      });
    } else {
      // General personal email: requires generalPrice charge (₹1,499)
      const txn = transactionId || `TXN_ACT_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

      user.isVerified = true;
      user.emailType = 'general';
      user.plan = 'free';
      user.planStatus = 'active';
      user.isPlanActive = true;
      user.planPaidAmount = generalPrice;
      await user.save();

      if (user.organization) {
        await Subscription.findOneAndUpdate(
          { organization: user.organization },
          {
            plan: 'free',
            emailType: 'general',
            status: 'active',
            price: generalPrice,
            paymentCycle: 'one_time',
            user: user._id,
            startDate: new Date(),
            endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          },
          { upsert: true, new: true }
        );
      }

      return res.status(200).json({
        success: true,
        message: `Payment of ₹${generalPrice.toLocaleString()} successful! Free Organizer Plan is now active.`,
        transactionId: txn,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified,
          emailType: user.emailType,
          plan: user.plan,
          planStatus: user.planStatus,
          isPlanActive: user.isPlanActive,
          planPaidAmount: generalPrice,
          hasUnlockedLocationResearch: !!user.hasUnlockedLocationResearch
        }
      });
    }
  } catch (error) {
    next(error);
  }
});

// @desc    Unlock Location Feasibility & Event Presence Intelligence for Free Organizers (₹4,999)
// @route   POST /api/plans/unlock-location-research
router.post('/unlock-location-research', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const { location, transactionId, paymentMethod = 'card' } = req.body;
    const price = 4999;
    const txn = transactionId || `TXN_RESEARCH_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    user.hasUnlockedLocationResearch = true;
    if (location) {
      const locLower = String(location).trim().toLowerCase();
      if (!user.unlockedResearchLocations) user.unlockedResearchLocations = [];
      if (!user.unlockedResearchLocations.includes(locLower)) {
        user.unlockedResearchLocations.push(locLower);
      }
    }
    user.planPaidAmount = (user.planPaidAmount || 0) + price;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Location Feasibility & Event Presence Intelligence unlocked successfully for ₹4,999!',
      transactionId: txn,
      amount: price,
      hasUnlockedLocationResearch: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: user.plan,
        hasUnlockedLocationResearch: true,
        unlockedResearchLocations: user.unlockedResearchLocations || []
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
