/**
 * @file planRoutes.js
 * @description API endpoints for VisitExpo Organizer Pricing Plans, Comparison Matrix, Growth Services, and Inquiries.
 */

import express from 'express';
import Plan from '../models/Plan.js';
import PlanInquiry from '../models/PlanInquiry.js';
import Subscription from '../models/Subscription.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

export const DEFAULT_OFFICIAL_PLANS = [
  {
    planId: 'free',
    name: 'Free Organizer',
    tagline: 'Free for corporate email · Paid for general email 1499/-',
    description: 'Post ideas, claim expos, test token ticket demand, and gather early interest with masked lead intelligence.',
    badge: 'Free Forever',
    badgeColor: 'bg-zinc-800 text-zinc-200 border border-zinc-700',
    pricing: {
      corporateEmailPrice: 0,
      generalEmailPrice: 1499,
      quarterlyPrice: 0,
      yearlyPrice: 0,
      proposedEventResearchPrice: 4999,
      currency: 'INR',
      currencySymbol: '₹',
      billingNote: 'Free for corporate business email (@yourcompany.com). One-time ₹1,499 for general email (@gmail, etc).'
    },
    highlights: [
      'Free Registration for corporate email & general email 1499/-',
      'Expo Claiming: Any number of expos (verification per expo, limit 3/day)',
      'Event Creation: Create & publish new, upcoming & prospective events (B2B or B2C)',
      'Event Ownership: Permitted on claimed or created expos',
      'Ticket Creation: Min 1 to 10 price ticket demand activation',
      'Ticket Demand Test: 1 / 10 nominal token-style request model to measure response',
      'Full Ticket Selling: Monitization unlocked in paid plans',
      'Lead Categories: Receive all Visitor, Exhibitor, Vendor, Venue, Designer, Ticket Platform, Expo Mgmt leads (Masked)',
      'Lead Visibility: Masked lead info; inquiry counts & interest volume visible',
      'Organic Visit Expo positioning',
      'Proposed Event Research: ₹4,999 per proposed/prospective event (B2B/B2C validation)',
      'B2B / B2C Validation available for trade shows, business events, Garba, fun events',
      'Growth Plan available separately as paid services'
    ],
    features: [
      { title: 'Free Registration (Work Email)', included: true, detail: '₹0 for corporate domain, ₹1,499 for general' },
      { title: 'Claim Any Number of Expos', included: true, detail: 'Limit 3 expo claims per day' },
      { title: 'Unlimited Event Creation', included: true, detail: 'New, upcoming & prospective B2B/B2C expos' },
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
    tagline: 'Operate validated events and unlock usable lead/ticket functionality',
    description: 'Empowers organizers to monetize ticket sales, unlock unmasked attendee and exhibitor leads, and run operational lead CRM.',
    badge: 'Most Popular',
    badgeColor: 'bg-primary text-black font-semibold',
    pricing: {
      corporateEmailPrice: 0,
      generalEmailPrice: 0,
      quarterlyPrice: 14999,
      yearlyPrice: 49999,
      proposedEventResearchPrice: 0,
      currency: 'INR',
      currencySymbol: '₹',
      billingNote: '₹14,999 / Quarter · ₹49,999 / Year (Save ₹9,997 annually)'
    },
    highlights: [
      'Everything in Free included',
      'Detailed Lead Access: Full unlocked contacts',
      'Lead CRM: Basic operational CRM workflow',
      'Lead Search & Filtering: Ok (Basic query tools)',
      'Visitor / Exhibitor / Vendor Leads: Unlocked',
      'Venue / Designer / Organizer Leads: Unlocked',
      'Ticket Platform / Expo Management Leads: Unlocked',
      'Paid Ticket Selling: Unlocked with payment gateway',
      'Payment Gateway: Ok (Direct integrated)',
      'Ticket Sales Analytics: Basic real-time reporting',
      'Exhibitor Management: Basic exhibitor directory',
      'Proposed Expo Validation: Limited allowance included',
      'Interest Analysis & B2B/B2C Demand: Basic reports',
      'Active Events: Unlimited',
      'Priority Organizer Support'
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
    tagline: 'Large organizers managing multiple expos and enterprise operations',
    description: 'Full-scale enterprise capability with advanced CRM + API, unlimited lead export, private gateway, and featured search spotlight.',
    badge: 'Enterprise Scale',
    badgeColor: 'bg-indigo-600 text-white font-semibold',
    pricing: {
      corporateEmailPrice: 0,
      generalEmailPrice: 0,
      quarterlyPrice: 89999,
      yearlyPrice: 299999,
      proposedEventResearchPrice: 0,
      currency: 'INR',
      currencySymbol: '₹',
      billingNote: '₹89,999 / Quarter · ₹2,99,999 / Year (Save ₹59,997 annually)'
    },
    highlights: [
      'Everything in Starter & Free',
      'Detailed Lead Access: Full + advanced analytics',
      'Lead CRM: Advanced CRM + Developer REST API',
      'Lead Export: Unlimited (CSV, Excel, Webhooks)',
      'Lead Search & Filtering: Advanced multi-criteria search',
      'Visitor / Exhibitor / Vendor Leads: Full + analytics',
      'Venue / Designer / Organizer Leads: Full + analytics + Search Database',
      'Ticket Platform / Expo Mgmt Leads: Full + analytics',
      'Paid Ticket Selling: Advanced / private payment gateway integration',
      'Payment Gateway: Ok (Multi-gateway + Custom integration)',
      'Ticket Sales Analytics: Advanced conversion & attendee metrics',
      'Exhibitor Management: Advance exhibitor portal & floor management',
      'Proposed Expo Validation: Multiple events included',
      'Interest & Demand Analysis: Detailed category-wise & Advance B2B/B2C',
      'Active Events: Unlimited enterprise events',
      'Priority Search / Featured Placement: Available',
      'Support: Faster priority (Dedicated Account Director)'
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
    tagline: 'Top-up plan start from 1k to unlimited · Point wise price uses',
    description: 'On-demand promotional horsepower to guarantee buyer turnout, exhibitor registrations, and multi-channel marketing reach.',
    badge: 'Marketing Engine',
    badgeColor: 'bg-emerald-500 text-white font-semibold',
    pricing: {
      corporateEmailPrice: 0,
      generalEmailPrice: 0,
      quarterlyPrice: 1000,
      yearlyPrice: 0,
      proposedEventResearchPrice: 4999,
      currency: 'INR',
      currencySymbol: '₹',
      billingNote: 'Top-up credit packs starting from ₹1,000 to unlimited. Point-wise price uses as you consume services.'
    },
    highlights: [
      'Top-up plans start from ₹1,000 to unlimited',
      'Point-wise price uses for flexible budgeting',
      'Multi-channel promotional firepower across 13 channels',
      'Google Listing & Search Visibility (Paid separately)',
      'Paid Lead Generation & Social Media Optimization (SMO)',
      'AI & SEO-driven content promotion',
      'Direct outreach: WhatsApp Broadcast & Targeted SMS',
      'Email marketing & IVR automated voice promotion',
      'Platform Spotlight: Push notifications, banners & popups',
      'Search spotlight: Top Expo Display & Side Expo Placement',
      'Member + External Audience Promotion (Tailored targeting)'
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

// Helper: seed default official plans if DB is empty
export const seedDefaultPlansIfEmpty = async () => {
  const count = await Plan.countDocuments();
  if (count === 0) {
    await Plan.insertMany(DEFAULT_OFFICIAL_PLANS);
    console.log('[Plan Service] Initialized 4 default official plans (Free, Starter, Enterprise, Growth).');
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
router.get('/admin/all', protect, authorize('super_admin', 'subadmin'), async (req, res, next) => {
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
router.post('/admin', protect, authorize('super_admin'), async (req, res, next) => {
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
router.put('/admin/:id', protect, authorize('super_admin'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

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
router.delete('/admin/:id', protect, authorize('super_admin'), async (req, res, next) => {
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
router.post('/admin/seed-defaults', protect, authorize('super_admin'), async (req, res, next) => {
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
router.get('/admin/inquiries', protect, authorize('super_admin', 'subadmin'), async (req, res, next) => {
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
router.patch('/admin/inquiries/:id', protect, authorize('super_admin', 'subadmin'), async (req, res, next) => {
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

export default router;
