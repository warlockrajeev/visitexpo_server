/**
 * @file adminRoutes.js
 * @description Super Admin management metrics, platform health and operational CRUD dashboards.
 */

import express from 'express';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Event from '../models/Event.js';
import Exhibitor from '../models/Exhibitor.js';
import Order from '../models/Order.js';
import Subscription from '../models/Subscription.js';
import Invoice from '../models/Invoice.js';
import ContactMessage from '../models/ContactMessage.js';
import Sponsor from '../models/Sponsor.js';
import DeletedOrganizer from '../models/DeletedOrganizer.js';
import mongoose from 'mongoose';
import { protect, authorize } from '../middlewares/auth.js';
import {
  sendEmail,
  sendOrganizerApprovalNotification,
  sendExhibitorApprovalNotification
} from '../services/emailService.js';
import { syncEventToWordPress } from '../services/WordPressSyncService.js';
import { verifyAccessToken } from '../utils/jwt.js';

// Cache for categories aggregation to keep dashboard fast
let categoriesCache = {
  data: null,
  timestamp: 0,
  ttl: 5 * 60 * 1000 // 5 minutes
};

const CATEGORIES_META = [
  {
    name: 'Technology & AI',
    slug: 'technology-ai',
    description: 'Artificial intelligence, enterprise SaaS, cloud infrastructure, IoT, and cybersecurity conventions.',
    icon: 'Cpu',
    color: '#3b82f6',
    bg: 'bg-blue-500/10'
  },
  {
    name: 'Healthcare & Pharma',
    slug: 'healthcare-pharma',
    description: 'Medical devices, pharmaceuticals, hospital infrastructure, biotech research, and surgical symposiums.',
    icon: 'Activity',
    color: '#ef4444',
    bg: 'bg-red-500/10'
  },
  {
    name: 'Automotive & EV',
    slug: 'automotive-ev',
    description: 'Electric mobility, auto components, commercial fleets, battery technology, and international motor shows.',
    icon: 'Car',
    color: '#f97316',
    bg: 'bg-orange-500/10'
  },
  {
    name: 'Construction & Infra',
    slug: 'construction-infra',
    description: 'Heavy infrastructure machinery, smart urban planning, cement, concrete, and architectural expos.',
    icon: 'HardHat',
    color: '#eab308',
    bg: 'bg-yellow-500/10'
  },
  {
    name: 'Travel & Tourism',
    slug: 'travel-tourism',
    description: 'Destination promotion, hospitality chains, airline networks, travel trade marts, and MICE summits.',
    icon: 'Compass',
    color: '#06b6d4',
    bg: 'bg-cyan-500/10'
  },
  {
    name: 'Agri & Food Tech',
    slug: 'agri-food-tech',
    description: 'Precision agriculture, food processing equipment, grain & dairy tech, and international culinary expos.',
    icon: 'Sprout',
    color: '#22c55e',
    bg: 'bg-emerald-500/10'
  },
  {
    name: 'Textile & Fashion',
    slug: 'textile-fashion',
    description: 'Garment manufacturing machinery, luxury fabrics, yarns, synthetic fibers, and apparel trade shows.',
    icon: 'Shirt',
    color: '#ec4899',
    bg: 'bg-pink-500/10'
  },
  {
    name: 'Aerospace & Aviation',
    slug: 'aerospace-aviation',
    description: 'Commercial aviation, defense aerospace, rotorcraft technologies, avionics, and air show expos.',
    icon: 'Plane',
    color: '#6366f1',
    bg: 'bg-indigo-500/10'
  },
  {
    name: 'Logistics & Cargo',
    slug: 'logistics-cargo',
    description: 'Supply chain management, maritime freight, warehousing robotics, and cold-chain logistics.',
    icon: 'Truck',
    color: '#8b5cf6',
    bg: 'bg-purple-500/10'
  },
  {
    name: 'Art & Lifestyle',
    slug: 'art-lifestyle',
    description: 'Contemporary art fairs, jewelry & gems, interior decor styling, and luxury lifestyle showcases.',
    icon: 'Palette',
    color: '#d946ef',
    bg: 'bg-fuchsia-500/10'
  },
  {
    name: 'Trade & Industry',
    slug: 'trade-industry',
    description: 'Cross-industry B2B commercial expos, multi-sector trade fairs, and manufacturing conventions.',
    icon: 'Briefcase',
    color: '#64748b',
    bg: 'bg-slate-500/10'
  }
];

function inferCategory(title = '', desc = '') {
  const text = `${title} ${desc}`.toLowerCase();
  if (/\b(travel|tourism|tourist|destination|hospitality|hotel|resort|leisure|flight|airline|cruise|mice|resa|iftm)\b/i.test(text)) return 'Travel & Tourism';
  if (/\b(auto|automobile|automotive|vehicles?|motor|motors|ev|evs|electric vehicle|mobility|tyre|tire)\b/i.test(text)) return 'Automotive & EV';
  if (/\b(airport|aviation|rotorcraft|air|aerospace)\b/i.test(text)) return 'Aerospace & Aviation';
  if (/\b(cargo|logistics|freight|transport|supply chain|warehousing|innotrans)\b/i.test(text)) return 'Logistics & Cargo';
  if (/\b(health|med|medical|pharma|cancer|doctor|hospital|surgical|pharmaexpo|iranpharma)\b/i.test(text)) return 'Healthcare & Pharma';
  if (/\b(build|building|construction|cement|concrete|infrastructure|municipal|architecture|foaid)\b/i.test(text)) return 'Construction & Infra';
  if (/\b(tech|technology|ai|software|cyber|iot|cloud|digital|broadcast|bes)\b/i.test(text)) return 'Technology & AI';
  if (/\b(textile|garment|fabric|yarn|fashion|apparel|dye|bisutex|clothing)\b/i.test(text)) return 'Textile & Fashion';
  if (/\b(rice|food|agriculture|bakery|crop|biofuel|grain|beverage|confectionery|agritech)\b/i.test(text)) return 'Agri & Food Tech';
  if (/\b(art|jewel|jewellery|jewelry|lifestyle|photo|handicraft|madridjoya)\b/i.test(text)) return 'Art & Lifestyle';
  return 'Trade & Industry';
}

const INITIAL_SPONSORS = [
  {
    name: 'Tata Motors EV',
    logo: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?q=80&w=200&auto=format&fit=crop',
    website: 'https://ev.tatamotors.com',
    tier: 'platinum',
    isExhibitor: true,
    boothDetails: { boothNumber: 'Hall 4 - P01', size: '120 sqm', location: 'Bharat Mandapam, New Delhi' },
    contactPerson: { name: 'Rajesh Sen', email: 'rajesh.sen@tatamotors.com', phone: '+91 98200 12345' },
    eventTitle: 'Bharat Mobility Global Expo 2027',
    eventId: '21395'
  },
  {
    name: 'Siemens Healthineers',
    logo: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?q=80&w=200&auto=format&fit=crop',
    website: 'https://siemens-healthineers.com',
    tier: 'platinum',
    isExhibitor: true,
    boothDetails: { boothNumber: 'Hall 2 - A12', size: '90 sqm', location: 'Jio World Convention Centre, Mumbai' },
    contactPerson: { name: 'Dr. Ananya Roy', email: 'ananya.roy@siemens.com', phone: '+91 98110 54321' },
    eventTitle: 'India MedTech Expo & Summit',
    eventId: '21363'
  },
  {
    name: 'Google Cloud India',
    logo: 'https://images.unsplash.com/photo-1511578314322-379afb476865?q=80&w=200&auto=format&fit=crop',
    website: 'https://cloud.google.com',
    tier: 'platinum',
    isExhibitor: false,
    boothDetails: { boothNumber: 'Keynote Pavillion', size: '200 sqm', location: 'Yashobhoomi, IICC New Delhi' },
    contactPerson: { name: 'Kavita Iyer', email: 'kavita@google.com', phone: '+91 98700 98700' },
    eventTitle: 'Global AI & Technology Convention',
    eventId: '21355'
  },
  {
    name: 'Larsen & Toubro (L&T)',
    logo: 'https://images.unsplash.com/photo-1541888946425-d0fbb186156a?q=80&w=200&auto=format&fit=crop',
    website: 'https://larsentoubro.com',
    tier: 'gold',
    isExhibitor: true,
    boothDetails: { boothNumber: 'Outdoor Zone OD-04', size: '150 sqm', location: 'India Expo Centre, Greater Noida' },
    contactPerson: { name: 'Sunil Nair', email: 's.nair@larsentoubro.com', phone: '+91 99300 45678' },
    eventTitle: 'BAUMA CONEXPO INDIA 2026',
    eventId: '20793'
  },
  {
    name: 'Emirates Holidays',
    logo: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?q=80&w=200&auto=format&fit=crop',
    website: 'https://emiratesholidays.com',
    tier: 'gold',
    isExhibitor: true,
    boothDetails: { boothNumber: 'Hall 9 - G18', size: '60 sqm', location: 'Pragati Maidan, New Delhi' },
    contactPerson: { name: 'Tariq Mansoor', email: 'tariq@emirates.com', phone: '+971 4 299 1234' },
    eventTitle: 'SATTE South Asia Travel Expo',
    eventId: '21390'
  },
  {
    name: 'Amul Dairy Federation',
    logo: 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?q=80&w=200&auto=format&fit=crop',
    website: 'https://amul.com',
    tier: 'silver',
    isExhibitor: true,
    boothDetails: { boothNumber: 'Hall 5 - S02', size: '48 sqm', location: 'Pragati Maidan, New Delhi' },
    contactPerson: { name: 'Pradeep Patel', email: 'p.patel@amul.coop', phone: '+91 98250 11223' },
    eventTitle: 'AAHAR International Food Fair',
    eventId: '20922'
  },
  {
    name: 'Bosch Mobility Solutions',
    logo: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?q=80&w=200&auto=format&fit=crop',
    website: 'https://bosch.in',
    tier: 'gold',
    isExhibitor: true,
    boothDetails: { boothNumber: 'Hall 11 - B08', size: '80 sqm', location: 'BIEC Bengaluru' },
    contactPerson: { name: 'Rohan Deshmukh', email: 'rohan.deshmukh@bosch.com', phone: '+91 98450 67890' },
    eventTitle: 'Auto Expo Components & Clean Energy',
    eventId: '21395'
  },
  {
    name: 'Schneider Electric India',
    logo: 'https://images.unsplash.com/photo-1517976487588-468a356cb0b7?q=80&w=200&auto=format&fit=crop',
    website: 'https://se.com/in',
    tier: 'silver',
    isExhibitor: true,
    boothDetails: { boothNumber: 'Hall 3 - E15', size: '40 sqm', location: 'Bombay Exhibition Centre, Mumbai' },
    contactPerson: { name: 'Megha Varma', email: 'megha.varma@se.com', phone: '+91 97690 12345' },
    eventTitle: 'ELECRAMA Global Electrical Expo',
    eventId: '21350'
  }
];

async function getAggregatedCategories() {
  const now = Date.now();
  if (categoriesCache.data && (now - categoriesCache.timestamp < categoriesCache.ttl)) {
    return categoriesCache.data;
  }

  const wpUrl = process.env.WORDPRESS_URL || 'https://visitexpo.in';
  const wpKey = process.env.WORDPRESS_API_KEY || 'visitexpo_custom_secret_key_12345';

  let rawDocs = [];
  try {
    const wpRes = await fetch(`${wpUrl}/wp-json/visitexpo/v1/inspect-event-meta`, {
      headers: { 'X-VisitExpo-Key': wpKey },
      signal: AbortSignal.timeout(8000)
    });
    if (wpRes.ok) {
      const data = await wpRes.json();
      rawDocs = data.data?.docs || [];
    }
  } catch (err) {
    console.warn('[Admin] inspect-event-meta fetch failed, falling back to MongoDB:', err.message);
  }

  const mongoEvents = await Event.find().lean();

  const catMap = {};
  CATEGORIES_META.forEach(c => {
    catMap[c.name] = {
      ...c,
      events: []
    };
  });

  rawDocs.forEach((d, idx) => {
    const m = d.meta || {};
    const startTs = m.ovaem_date_start_time?.[0];
    const endTs = m.ovaem_date_end_time?.[0];
    const venue = m.ovaem_address_event?.[0] || m.ovaem_venue?.[0] || m.ovaem_address?.[0] || 'Exhibition Center';
    const desc = m.yoast_wpseo_metadesc?.[0] || m.ovaem_desc_event?.[0] || m.ovaem_org_desc?.[0] || '';
    const cat = inferCategory(d.title, desc);

    const cleanCity = (venue.includes('New Delhi') || venue.includes('Delhi') || venue.includes('Pragati') || venue.includes('Bharat Mandapam')) ? 'New Delhi' :
                      (venue.includes('Mumbai') || venue.includes('BKC') || venue.includes('Jio')) ? 'Mumbai' :
                      (venue.includes('Bengaluru') || venue.includes('BIEC')) ? 'Bengaluru' :
                      (venue.includes('Chennai')) ? 'Chennai' :
                      (venue.includes('Hyderabad')) ? 'Hyderabad' :
                      (venue.includes('Ahmedabad') || venue.includes('Gandhinagar')) ? 'Ahmedabad' : 'India';

    const evtObj = {
      id: String(d.id || `wp-${idx}`),
      title: d.title || 'Exhibition Event',
      slug: d.slug,
      category: cat,
      venue: venue,
      city: cleanCity,
      startDate: startTs && parseInt(startTs) > 0 ? new Date(parseInt(startTs) * 1000).toISOString() : null,
      endDate: endTs && parseInt(endTs) > 0 ? new Date(parseInt(endTs) * 1000).toISOString() : null,
      dates: startTs ? new Date(parseInt(startTs) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Upcoming 2026',
      organizer: m.ovaem_org_name?.[0] || 'Verified Organizer',
      status: 'published',
      wpUrl: `https://visitexpo.in/event/${d.slug}/`,
      isWordPress: true
    };

    if (catMap[cat]) {
      catMap[cat].events.push(evtObj);
    } else {
      catMap['Trade & Industry'].events.push(evtObj);
    }
  });

  mongoEvents.forEach(me => {
    const catName = Array.isArray(me.categories) ? me.categories[0] : (me.categories || 'Trade & Industry');
    const matchedCat = catMap[catName] ? catName : inferCategory(me.title, me.description);
    
    const alreadyExists = catMap[matchedCat]?.events.some(e => e.slug === me.slug);
    if (!alreadyExists && catMap[matchedCat]) {
      catMap[matchedCat].events.push({
        id: String(me._id),
        title: me.title,
        slug: me.slug,
        category: matchedCat,
        venue: me.venue || 'Convention Center',
        city: me.city || 'India',
        startDate: me.startDate,
        endDate: me.endDate,
        dates: me.startDate ? new Date(me.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Upcoming',
        organizer: me.organizerName || 'Platform Tenant',
        status: me.status || 'published',
        wpUrl: me.wpUrl || '',
        isWordPress: false
      });
    }
  });

  const categories = Object.values(catMap).map(c => ({
    name: c.name,
    slug: c.slug,
    description: c.description,
    icon: c.icon,
    color: c.color,
    bg: c.bg,
    count: c.events.length,
    events: c.events
  }));

  const totalEvents = categories.reduce((sum, c) => sum + c.count, 0);

  const result = {
    totalCategories: categories.length,
    totalEvents: totalEvents,
    categories: categories
  };

  categoriesCache = {
    data: result,
    timestamp: Date.now(),
    ttl: 5 * 60 * 1000
  };

  return result;
}

const ORGANIZERS_KNOWN_METADATA = [
  {
    id: 'informa-markets',
    name: 'Informa Markets',
    shortName: 'Informa Markets',
    aliases: [/informa/i],
    brandColor: '#002D62',
    accentColor: '#00A3E0',
    website: 'https://www.informamarkets.com',
    badge: 'Global Leader',
    type: 'international',
    scope: 'World’s leading B2B exhibitions, trade fairs, and market-making platforms.'
  },

  {
    id: 'ies-india',
    name: 'Indian Exhibition Services (IES)',
    shortName: 'IES India',
    aliases: [/indian exhibition services|ies\b/i],
    brandColor: '#1E40AF',
    accentColor: '#3B82F6',
    website: 'https://ies-india.com',
    badge: 'National Trade Expos',
    type: 'national',
    scope: 'Premier industrial trade exhibitions, manufacturing expos, and DRR conventions.'
  },
  {
    id: 'messe-frankfurt',
    name: 'Messe Frankfurt',
    shortName: 'Messe Frankfurt',
    aliases: [/messe frankfurt/i],
    brandColor: '#DC2626',
    accentColor: '#F59E0B',
    website: 'https://www.messefrankfurt.com',
    badge: 'German Fairs',
    type: 'international',
    scope: 'World’s largest trade fair, congress and event organiser with own grounds.'
  },
  {
    id: 'rx-global',
    name: 'RX Global (Reed Exhibitions)',
    shortName: 'RX Global',
    aliases: [/rx india|reed exhibitions|rx japan|rx global/i],
    brandColor: '#1E3A8A',
    accentColor: '#0284C7',
    website: 'https://rxglobal.com',
    badge: 'Global Powerhouse',
    type: 'international',
    scope: 'Global events powerhouse driving targeted market access, technology showcases, and matchmaking.'
  },
  {
    id: 'nurnbergmesse',
    name: 'NürnbergMesse India',
    shortName: 'NürnbergMesse',
    aliases: [/n[uü]rnbergmesse/i],
    brandColor: '#0284C7',
    accentColor: '#0EA5E9',
    website: 'https://www.nm-india.com',
    badge: 'German Excellence',
    type: 'international',
    scope: 'Premier specialty exhibitions for architecture, building tech, and hardware.'
  },
  {
    id: 'messe-dusseldorf',
    name: 'Messe Düsseldorf',
    shortName: 'Messe Düsseldorf',
    aliases: [/messe d[uü]sseldorf/i],
    brandColor: '#B91C1C',
    accentColor: '#EF4444',
    website: 'https://www.md-india.com',
    badge: 'Medical & Industrial',
    type: 'international',
    scope: 'Medical Fair India, metallurgy conventions, and global industrial forums.'
  },
  {
    id: 'cems-global',
    name: 'CEMS-Global USA',
    shortName: 'CEMS-Global',
    aliases: [/cems/i],
    brandColor: '#047857',
    accentColor: '#10B981',
    website: 'https://cems.global',
    badge: 'Multinational',
    type: 'international',
    scope: 'Multinational exhibition organizer spanning South & Southeast Asia and South America.'
  },
  {
    id: 'guangdong-grandeur',
    name: 'Guangdong Grandeur Intl Exhibition Group',
    shortName: 'Grandeur Group',
    aliases: [/grandeur/i],
    brandColor: '#B45309',
    accentColor: '#F59E0B',
    website: 'https://www.gzhw.com',
    badge: 'Asia Pacific',
    type: 'international',
    scope: 'Major organizer of landscape, gardening, entertainment, and commercial trade fairs.'
  },
  {
    id: 'mex-exhibitions',
    name: 'MEX Exhibitions Pvt. Ltd.',
    shortName: 'MEX Exhibitions',
    aliases: [/mex exhibitions/i],
    brandColor: '#4338CA',
    accentColor: '#6366F1',
    website: 'https://cewexpo.com',
    badge: 'Consumer & Sign',
    type: 'national',
    scope: 'Consumer Electronics World Expo, Gifts World Expo, and Sign India showcases.'
  },
  {
    id: 'cii',
    name: 'Confederation of Indian Industry (CII)',
    shortName: 'CII',
    aliases: [/cii\b|confederation of indian/i],
    brandColor: '#15803D',
    accentColor: '#22C55E',
    website: 'https://www.cii.in',
    badge: 'Apex Industry Body',
    type: 'national',
    scope: 'India’s premier business association driving industrial growth, urban mass transit, and engineering.'
  },
  {
    id: 'koelnmesse',
    name: 'Koelnmesse GmbH',
    shortName: 'Koelnmesse',
    aliases: [/koelnmesse/i],
    brandColor: '#C026D3',
    accentColor: '#E879F9',
    website: 'https://www.koelnmesse.com',
    badge: 'Trade Fair Leader',
    type: 'international',
    scope: 'Global leader in food, interior design, and packaging exhibitions.'
  },
  {
    id: 'worldex',
    name: 'Worldex India Exhibition & Promotion',
    shortName: 'Worldex India',
    aliases: [/worldex/i],
    brandColor: '#2563EB',
    accentColor: '#60A5FA',
    website: 'https://www.worldexindia.com',
    badge: 'B2B Trade Marts',
    type: 'national',
    scope: 'WOFX World Furniture Expo, Intex South Asia, and export trade development.'
  },
  {
    id: 'bridal-asia',
    name: 'Bridal Asia',
    shortName: 'Bridal Asia',
    aliases: [/bridal asia/i],
    brandColor: '#BE185D',
    accentColor: '#F472B6',
    website: 'https://www.bridalasia.com',
    badge: 'Luxury Lifestyle',
    type: 'national',
    scope: 'Asia’s most prestigious luxury wedding apparel, jewelry, and lifestyle showcase.'
  },
  {
    id: 'ifema-madrid',
    name: 'IFEMA MADRID (Feria de Madrid)',
    shortName: 'IFEMA Madrid',
    aliases: [/ifema/i],
    brandColor: '#7C3AED',
    accentColor: '#A78BFA',
    website: 'https://www.ifema.es',
    badge: 'Feria de Madrid',
    type: 'international',
    scope: 'Official consortium of Madrid organizing premier European fashion and tourism fairs.'
  },
  {
    id: 'radeecal',
    name: 'Radeecal Communications',
    shortName: 'Radeecal',
    aliases: [/radeecal/i],
    brandColor: '#059669',
    accentColor: '#34D399',
    website: 'https://radeecal.in',
    badge: 'Agri & Industrial',
    type: 'national',
    scope: 'Agritech Bharat, Dairy Tech India, and specialized agrochemical expos.'
  },
  {
    id: 'itpo',
    name: 'India Trade Promotion Organisation (ITPO)',
    shortName: 'ITPO',
    aliases: [/itpo|india trade promotion/i],
    brandColor: '#D97706',
    accentColor: '#FBBF24',
    website: 'https://www.itpo.gov.in',
    badge: 'Govt of India',
    type: 'national',
    scope: 'Nodal trade promotion agency of the Ministry of Commerce & Industry, Govt of India.'
  },
  {
    id: 'dmg-events',
    name: 'dmg events',
    shortName: 'dmg events',
    aliases: [/dmg events/i],
    brandColor: '#0D9488',
    accentColor: '#2DD4BF',
    website: 'https://www.dmgevents.com',
    badge: 'Energy & Food',
    type: 'international',
    scope: 'International portfolio of exhibitions in energy, construction, and hospitality.'
  },
  {
    id: 'montgomery-group',
    name: 'Montgomery Group',
    shortName: 'Montgomery',
    aliases: [/montgomery/i],
    brandColor: '#475569',
    accentColor: '#94A3B8',
    website: 'https://www.montgomerygroup.com',
    badge: 'Global Hospitality',
    type: 'international',
    scope: 'Independent events company organizing global exhibitions across 15 countries.'
  },
  {
    id: 'scci-sharjah',
    name: 'Expo Centre Sharjah (SCCI)',
    shortName: 'Expo Centre Sharjah',
    aliases: [/sharjah/i],
    brandColor: '#9333EA',
    accentColor: '#C084FC',
    website: 'https://www.sharjah.gov.ae',
    badge: 'UAE Premier Expo',
    type: 'international',
    scope: 'Watch & Jewellery Middle East Show and leading Arabian Gulf trade fairs.'
  },
  {
    id: 'ficci',
    name: 'Federation of Indian Chambers of Commerce & Industry (FICCI)',
    shortName: 'FICCI',
    aliases: [/ficci/i],
    brandColor: '#B91C1C',
    accentColor: '#F87171',
    website: 'https://www.ficci.in',
    badge: 'Apex Chamber',
    type: 'national',
    scope: 'Apex business chamber championing global investment summits and commercial expos.'
  },
  {
    id: 'cfa',
    name: "The Cat Fanciers' Association (CFA)",
    shortName: 'CFA',
    aliases: [/cat fanciers/i],
    brandColor: '#0891B2',
    accentColor: '#06B6D4',
    website: 'https://cfa.org',
    badge: 'International Registry',
    type: 'international',
    scope: 'World’s largest registry of pedigreed cats and international specialty showcases.'
  }
];

let organizersCache = {
  data: null,
  timestamp: 0,
  ttl: 5 * 60 * 1000
};

// Generate deterministic brand palette for dynamic organizers
function getDynamicBrandColors(name) {
  const PALETTES = [
    { brand: '#2563EB', accent: '#60A5FA' },
    { brand: '#7C3AED', accent: '#A78BFA' },
    { brand: '#059669', accent: '#34D399' },
    { brand: '#D97706', accent: '#FBBF24' },
    { brand: '#DC2626', accent: '#F87171' },
    { brand: '#0891B2', accent: '#22D3EE' },
    { brand: '#4F46E5', accent: '#818CF8' },
    { brand: '#C026D3', accent: '#E879F9' },
    { brand: '#475569', accent: '#94A3B8' },
    { brand: '#0D9488', accent: '#2DD4BF' }
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % PALETTES.length;
  return PALETTES[idx];
}

export async function getAggregatedOrganizers(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && organizersCache.data && (now - organizersCache.timestamp < organizersCache.ttl)) {
    return organizersCache.data;
  }

  const wpUrl = process.env.WORDPRESS_URL || 'https://visitexpo.in';
  const wpKey = process.env.WORDPRESS_API_KEY || 'visitexpo_custom_secret_key_12345';

  let rawDocs = [];
  try {
    const wpRes = await fetch(`${wpUrl}/wp-json/visitexpo/v1/inspect-event-meta`, {
      headers: { 'X-VisitExpo-Key': wpKey },
      signal: AbortSignal.timeout(8000)
    });
    if (wpRes.ok) {
      const data = await wpRes.json();
      rawDocs = data.data?.docs || [];
    }
  } catch (err) {
    console.warn('[Admin] inspect-event-meta fetch failed for organizers, falling back to MongoDB:', err.message);
  }

  const [mongoEvents, mongoOrgs, deletedOrgs] = await Promise.all([
    Event.find().lean(),
    Organization.find().lean(),
    DeletedOrganizer.find().lean()
  ]);

  const deletedNames = new Set((deletedOrgs || []).map(d => (d.name || '').toLowerCase().trim()));
  const deletedSlugIds = new Set((deletedOrgs || []).map(d => (d.slugId || '').toLowerCase().trim()));

  const orgMap = {};

  // Initialize known organizers
  ORGANIZERS_KNOWN_METADATA.forEach(ko => {
    orgMap[ko.name] = {
      id: ko.id,
      name: ko.name,
      shortName: ko.shortName,
      brandColor: ko.brandColor,
      accentColor: ko.accentColor,
      website: ko.website,
      logoUrl: ko.logoUrl || null,
      badge: ko.badge,
      type: ko.type,
      scope: ko.scope,
      email: '',
      phone: '',
      isRegisteredTenant: false,
      events: []
    };
  });

  // Merge registered MongoDB Organizations
  mongoOrgs.forEach(mo => {
    const matchedKnown = Object.values(orgMap).find(o => 
      o.name.toLowerCase() === mo.name.toLowerCase() ||
      (mo.name.toLowerCase().includes('global tech') && o.name.toLowerCase().includes('global tech'))
    );
    if (matchedKnown) {
      matchedKnown.logoUrl = mo.logo || matchedKnown.logoUrl;
      matchedKnown.website = mo.website || matchedKnown.website;
      matchedKnown.email = mo.contact?.email || matchedKnown.email;
      matchedKnown.phone = mo.contact?.phone || matchedKnown.phone;
      matchedKnown.isRegisteredTenant = true;
      matchedKnown.tenantId = String(mo._id);
    } else {
      const colors = getDynamicBrandColors(mo.name);
      orgMap[mo.name] = {
        id: mo.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        name: mo.name,
        shortName: mo.name,
        brandColor: colors.brand,
        accentColor: colors.accent,
        website: mo.website || '',
        logoUrl: mo.logo || null,
        badge: 'Registered Tenant',
        type: 'independent',
        scope: mo.description || 'Registered platform tenant organizer hosting enterprise expos.',
        email: mo.contact?.email || '',
        phone: mo.contact?.phone || '',
        isRegisteredTenant: true,
        tenantId: String(mo._id),
        events: []
      };
    }
  });

  function resolveOrganizer(rawName) {
    const clean = (rawName || '').trim();
    if (!clean || clean === 'Verified Organizer') {
      return 'VisitExpo Verified Partner Expos';
    }
    for (const ko of ORGANIZERS_KNOWN_METADATA) {
      if (ko.aliases.some(rgx => rgx.test(clean))) {
        return ko.name;
      }
    }
    return clean;
  }

  // Process WordPress Docs
  rawDocs.forEach((d, idx) => {
    const m = d.meta || {};
    const startTs = m.ovaem_date_start_time?.[0];
    const endTs = m.ovaem_date_end_time?.[0];
    const venue = m.ovaem_address_event?.[0] || m.ovaem_venue?.[0] || m.ovaem_address?.[0] || 'Exhibition Center';
    const desc = m.yoast_wpseo_metadesc?.[0] || m.ovaem_desc_event?.[0] || m.ovaem_org_desc?.[0] || '';
    const cat = inferCategory(d.title, desc);

    const cleanCity = (venue.includes('New Delhi') || venue.includes('Delhi') || venue.includes('Pragati') || venue.includes('Bharat Mandapam')) ? 'New Delhi' :
                      (venue.includes('Mumbai') || venue.includes('BKC') || venue.includes('Jio')) ? 'Mumbai' :
                      (venue.includes('Bengaluru') || venue.includes('BIEC')) ? 'Bengaluru' :
                      (venue.includes('Chennai')) ? 'Chennai' :
                      (venue.includes('Hyderabad')) ? 'Hyderabad' :
                      (venue.includes('Ahmedabad') || venue.includes('Gandhinagar')) ? 'Ahmedabad' : 'India';

    const rawOrgName = m.ovaem_org_name?.[0] || d.organizer || 'Verified Organizer';
    const resolvedName = resolveOrganizer(rawOrgName);

    if (!orgMap[resolvedName]) {
      const colors = getDynamicBrandColors(resolvedName);
      orgMap[resolvedName] = {
        id: resolvedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        name: resolvedName,
        shortName: resolvedName,
        brandColor: colors.brand,
        accentColor: colors.accent,
        website: m.ovaem_org_website?.[0] || '',
        logoUrl: null,
        badge: resolvedName === 'VisitExpo Verified Partner Expos' ? 'Partner Fairs' : 'Trade Organizer',
        type: resolvedName === 'VisitExpo Verified Partner Expos' ? 'national' : 'independent',
        scope: m.ovaem_org_desc?.[0] || `Official trade organizer promoting leading industrial events across India.`,
        email: m.ovaem_org_email?.[0] || '',
        phone: m.ovaem_org_phone?.[0] || '',
        isRegisteredTenant: false,
        events: []
      };
    } else {
      if (!orgMap[resolvedName].website && m.ovaem_org_website?.[0]) {
        orgMap[resolvedName].website = m.ovaem_org_website[0];
      }
      if (!orgMap[resolvedName].email && m.ovaem_org_email?.[0]) {
        orgMap[resolvedName].email = m.ovaem_org_email[0];
      }
      if (!orgMap[resolvedName].phone && m.ovaem_org_phone?.[0]) {
        orgMap[resolvedName].phone = m.ovaem_org_phone[0];
      }
      if ((!orgMap[resolvedName].scope || orgMap[resolvedName].scope.length < 30) && m.ovaem_org_desc?.[0]) {
        orgMap[resolvedName].scope = m.ovaem_org_desc[0];
      }
    }

    const evtObj = {
      id: String(d.id || `wp-${idx}`),
      title: d.title || 'Exhibition Event',
      slug: d.slug,
      category: cat,
      venue: venue,
      city: cleanCity,
      startDate: startTs && parseInt(startTs) > 0 ? new Date(parseInt(startTs) * 1000).toISOString() : null,
      endDate: endTs && parseInt(endTs) > 0 ? new Date(parseInt(endTs) * 1000).toISOString() : null,
      dates: startTs ? new Date(parseInt(startTs) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Upcoming 2026',
      organizer: resolvedName,
      status: 'published',
      wpUrl: `https://visitexpo.in/event/${d.slug}/`,
      isWordPress: true
    };

    orgMap[resolvedName].events.push(evtObj);
  });

  // Process MongoDB Events with slug deduplication
  const processedSlugs = new Set();
  rawDocs.forEach(d => {
    if (d.slug) processedSlugs.add(d.slug);
  });

  mongoEvents.forEach(me => {
    // If this event was already ingested from WordPress, skip duplicating
    if (me.slug && processedSlugs.has(me.slug)) return;
    if (me.slug) processedSlugs.add(me.slug);

    // Only process Mongo events that belong to a specific tenant or have an explicit organizer
    let orgName = me.organizerName;
    if (me.organization) {
      const parentOrg = mongoOrgs.find(o => String(o._id) === String(me.organization));
      if (parentOrg) {
        orgName = parentOrg.name;
      }
    }

    if (!orgName || orgName === 'Platform Tenant') {
      orgName = 'VisitExpo Verified Partner Expos';
    }

    const resolvedName = resolveOrganizer(orgName);

    if (!orgMap[resolvedName]) {
      const colors = getDynamicBrandColors(resolvedName);
      orgMap[resolvedName] = {
        id: resolvedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        name: resolvedName,
        shortName: resolvedName,
        brandColor: colors.brand,
        accentColor: colors.accent,
        website: '',
        logoUrl: null,
        badge: 'Platform Tenant',
        type: 'independent',
        scope: 'Platform registered organizer hosting verified conventions.',
        email: '',
        phone: '',
        isRegisteredTenant: true,
        events: []
      };
    }

    orgMap[resolvedName].events.push({
      id: String(me._id),
      title: me.title,
      slug: me.slug,
      category: Array.isArray(me.categories) ? me.categories[0] : (me.categories || 'Trade & Industry'),
      venue: me.venue || 'Convention Center',
      city: me.city || 'India',
      startDate: me.startDate,
      endDate: me.endDate,
      dates: me.startDate ? new Date(me.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Upcoming',
      organizer: resolvedName,
      status: me.status || 'published',
      wpUrl: me.wpUrl || '',
      isWordPress: false
    });
  });

  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const deletedNormList = Array.from(new Set([
    ...Array.from(deletedNames).map(normalize),
    ...Array.from(deletedSlugIds).map(normalize)
  ])).filter(Boolean);

  const organizers = Object.values(orgMap)
    .filter(o => {
      const oName = (o.name || '').toLowerCase().trim();
      const oId = (o.id || '').toLowerCase().trim();
      const oShortName = (o.shortName || '').toLowerCase().trim();
      if (
        deletedNames.has(oName) ||
        deletedNames.has(oShortName) ||
        deletedSlugIds.has(oId) ||
        deletedSlugIds.has(oName) ||
        oId === 'global-tech-events'
      ) {
        return false;
      }
      const normName = normalize(oName);
      const normId = normalize(oId);
      const normShort = normalize(oShortName);
      for (const d of deletedNormList) {
        if (normName === d || normId === d || normShort === d) return false;
        if (normName.startsWith(d) || d.startsWith(normName) || normId.startsWith(d) || d.startsWith(normId)) return false;
      }
      if (normId.includes('globaltech') || normName.includes('globaltech')) return false;
      return true;
    })
    .map(o => ({
      ...o,
      count: o.events.length,
      events: o.events
    }))
    .sort((a, b) => b.count - a.count);

  const totalEvents = organizers.reduce((sum, o) => sum + o.count, 0);

  const result = {
    totalOrganizers: organizers.length,
    totalEvents: totalEvents,
    internationalCount: organizers.filter(o => o.type === 'international').length,
    nationalCount: organizers.filter(o => o.type === 'national').length,
    organizers: organizers
  };

  organizersCache = {
    data: result,
    timestamp: Date.now(),
    ttl: 5 * 60 * 1000
  };

  return result;
}

const router = express.Router();

// Wrap all admin routes in protect and super_admin authorize
router.use(protect);
router.use(authorize('super_admin'));

// @desc    Get admin dashboard summary KPIs
// @route   GET /api/admin/dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const [
      totalUsers,
      totalOrganizations,
      totalEvents,
      activeSubscriptions,
      completedOrders,
      pendingOrganizers,
      pendingExhibitors,
      pendingClaims,
      pendingEvents,
      newContactInquiries
    ] = await Promise.all([
      User.countDocuments(),
      Organization.countDocuments(),
      Event.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      Order.find({ status: 'completed' }),
      User.countDocuments({ role: 'organizer', isVerified: false }),
      Exhibitor.countDocuments({ status: 'pending' }),
      Event.countDocuments({ isClaimed: true, status: 'draft' }),
      Event.countDocuments({ status: 'draft', isClaimed: { $ne: true } }),
      ContactMessage.countDocuments({ status: 'new' })
    ]);

    // Sum revenue
    const totalRevenue = completedOrders.reduce((sum, order) => sum + order.totalAmount, 0);

    // Get active subscription packages breakdown
    const subscriptions = await Subscription.find({ status: 'active' });
    const packagesCount = {
      free: 0,
      growth: 0,
      enterprise: 0
    };

    subscriptions.forEach((sub) => {
      if (packagesCount[sub.plan] !== undefined) {
        packagesCount[sub.plan]++;
      }
    });

    // Get recent contact form inquiries
    const recentInquiries = await ContactMessage.find()
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    // Sponsors count
    let totalSponsors = await Sponsor.countDocuments();
    if (totalSponsors === 0) {
      totalSponsors = INITIAL_SPONSORS.length;
    }

    // Categories summary
    let categoriesSummary = { totalCategories: 11, totalEvents: 1918, categories: [] };
    try {
      categoriesSummary = await getAggregatedCategories();
    } catch (catErr) {
      console.warn('Dashboard categories fetch warning:', catErr.message);
    }

    res.status(200).json({
      success: true,
      analytics: {
        kpis: {
          totalUsers,
          totalOrganizations,
          totalEvents: categoriesSummary.totalEvents || totalEvents,
          activeSubscriptions,
          totalRevenue,
          pendingOrganizers,
          pendingExhibitors,
          pendingClaims,
          pendingEvents,
          newContactInquiries,
          totalCategories: categoriesSummary.totalCategories || 11,
          totalSponsors: totalSponsors
        },
        packagesBreakdown: packagesCount,
        categoryBreakdown: (categoriesSummary.categories || []).map(c => ({
          name: c.name,
          slug: c.slug,
          count: c.count,
          color: c.color,
          bg: c.bg,
          icon: c.icon
        })),
        recentInquiries
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get all event categories and their grouped events
// @route   GET /api/admin/categories
router.get('/categories', async (req, res, next) => {
  try {
    const data = await getAggregatedCategories();
    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get all organizers and their grouped events directory
// @route   GET /api/admin/organizers-directory
router.get('/organizers-directory', async (req, res, next) => {
  try {
    const forceRefresh = req.query.refresh === 'true' || !!req.query.t;
    const data = await getAggregatedOrganizers(forceRefresh);
    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete an organizer permanently
// @route   DELETE /api/admin/organizers/:id
router.delete('/organizers/:id', async (req, res, next) => {
  try {
    const orgParam = req.params.id; // slugId or Mongo ID
    const { name, deleteEvents } = req.body || {};
    const callerId = req.user?.id && mongoose.isValidObjectId(req.user.id) ? req.user.id : null;

    // Resolve target organizer name
    const resolvedName = (name || orgParam.replace(/-/g, ' ')).trim();
    const cleanSlug = (orgParam || '').toLowerCase().trim();

    // 1. Record in DeletedOrganizer to permanently exclude from aggregations
    await DeletedOrganizer.findOneAndUpdate(
      {
        $or: [
          { slugId: cleanSlug },
          { name: { $regex: `^${resolvedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
        ]
      },
      {
        name: resolvedName,
        slugId: cleanSlug,
        deletedAt: new Date(),
        deletedBy: callerId,
        reason: 'Deleted by Super Admin'
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // 2. Check if a matching registered Organization document exists in MongoDB
    const orgDoc = await Organization.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(orgParam) ? orgParam : null },
        { name: { $regex: `^${resolvedName}$`, $options: 'i' } }
      ]
    });

    if (orgDoc) {
      const orgId = orgDoc._id;
      // Disassociate users linked to this organization
      await User.updateMany(
        { organization: orgId },
        { $set: { organization: null } }
      );

      // Disassociate exhibitors linked to this organization
      await Exhibitor.updateMany(
        { organization: orgId },
        { $set: { organization: null } }
      );

      // Handle events
      if (deleteEvents) {
        await Event.deleteMany({ organizer: orgId });
      } else {
        await Event.updateMany(
          { organizer: orgId },
          { $set: { organizer: null, orgName: 'VisitExpo Verified Partner Expos' } }
        );
      }

      await Organization.findByIdAndDelete(orgId);
    } else {
      // If no registered Organization doc, handle Mongo events matching this organizer name
      if (deleteEvents) {
        await Event.deleteMany({
          $or: [
            { orgName: { $regex: `^${resolvedName}$`, $options: 'i' } },
            { organizerName: { $regex: `^${resolvedName}$`, $options: 'i' } }
          ]
        });
      } else {
        await Event.updateMany(
          {
            $or: [
              { orgName: { $regex: `^${resolvedName}$`, $options: 'i' } },
              { organizerName: { $regex: `^${resolvedName}$`, $options: 'i' } }
            ]
          },
          { $set: { orgName: 'VisitExpo Verified Partner Expos', organizerName: 'VisitExpo Verified Partner Expos' } }
        );
      }
    }

    // 3. Invalidate organizers cache
    organizersCache = {
      data: null,
      timestamp: 0,
      ttl: 5 * 60 * 1000
    };

    res.status(200).json({
      success: true,
      message: `Organizer "${resolvedName}" has been permanently deleted.`,
      deletedId: orgParam
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get all sponsors with tier breakdown and sponsored event
// @route   GET /api/admin/sponsors
router.get('/sponsors', async (req, res, next) => {
  try {
    let sponsors = await Sponsor.find()
      .populate('event', 'title slug venue city startDate endDate')
      .sort({ createdAt: -1 });

    if (!sponsors || sponsors.length === 0) {
      try {
        await Sponsor.insertMany(INITIAL_SPONSORS);
        sponsors = await Sponsor.find()
          .populate('event', 'title slug venue city startDate endDate')
          .sort({ createdAt: -1 });
      } catch (seedErr) {
        console.warn('Sponsor auto-seed note:', seedErr.message);
        return res.status(200).json({
          success: true,
          count: INITIAL_SPONSORS.length,
          data: INITIAL_SPONSORS
        });
      }
    }

    res.status(200).json({
      success: true,
      count: sponsors.length,
      data: sponsors
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Create a new sponsor
// @route   POST /api/admin/sponsors
router.post('/sponsors', async (req, res, next) => {
  try {
    const { name, logo, website, tier, isExhibitor, boothDetails, contactPerson, eventTitle, eventId } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Sponsor company name is required' });
    }

    const sponsor = await Sponsor.create({
      name,
      logo: logo || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=200&auto=format&fit=crop',
      website: website || '',
      tier: tier || 'silver',
      isExhibitor: Boolean(isExhibitor),
      boothDetails: boothDetails || {},
      contactPerson: contactPerson || {},
      eventTitle: eventTitle || '',
      eventId: eventId || ''
    });

    res.status(201).json({
      success: true,
      message: 'Sponsor partner registered successfully',
      data: sponsor
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete a sponsor
// @route   DELETE /api/admin/sponsors/:id
router.delete('/sponsors/:id', async (req, res, next) => {
  try {
    const sponsor = await Sponsor.findByIdAndDelete(req.params.id);
    if (!sponsor) {
      return res.status(404).json({ success: false, error: 'Sponsor record not found' });
    }
    res.status(200).json({
      success: true,
      message: 'Sponsor record removed successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Helper to safely extract caller user ID from Authorization header
function getCallerId(req) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);
      return decoded?.id || null;
    }
  } catch (e) {
    // Ignore invalid/expired token in helper
  }
  return null;
}

// @desc    Get all users (paginated + search + role & status filters)
// @route   GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const { search, role, status, page, limit } = req.query;
    const query = {};

    if (role && role !== 'all') {
      query.role = role;
    }

    if (status && status !== 'all') {
      if (status === 'suspended') {
        query.$or = [{ isSuspended: true }, { status: 'suspended' }];
      } else if (status === 'active') {
        query.$and = [{ isSuspended: { $ne: true } }, { status: { $ne: 'suspended' } }];
      }
    }

    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      if (query.$or) {
        query.$and = [
          { $or: query.$or },
          { $or: [{ name: searchRegex }, { email: searchRegex }] }
        ];
        delete query.$or;
      } else {
        query.$or = [
          { name: searchRegex },
          { email: searchRegex }
        ];
      }
    }

    const pgNum = parseInt(page, 10) || 1;
    const pgLimit = parseInt(limit, 10) || 100;
    const skip = (pgNum - 1) * pgLimit;

    const [docs, total, totalActive, totalSuspended] = await Promise.all([
      User.find(query)
        .populate('organization', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pgLimit),
      User.countDocuments(query),
      User.countDocuments({ isSuspended: { $ne: true }, status: { $ne: 'suspended' } }),
      User.countDocuments({ $or: [{ isSuspended: true }, { status: 'suspended' }] })
    ]);

    res.status(200).json({
      success: true,
      data: {
        docs,
        total,
        totalActive,
        totalSuspended,
        page: pgNum,
        pages: Math.ceil(total / pgLimit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update user details or role / verification / suspension status
// @route   PUT /api/admin/users/:id
router.put('/users/:id', async (req, res, next) => {
  try {
    const { name, email, role, isVerified, isSuspended, status, suspendReason } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (name) user.name = name;
    if (email) user.email = email.toLowerCase();
    if (role) user.role = role;
    if (isVerified !== undefined) user.isVerified = isVerified;

    if (isSuspended !== undefined) {
      user.isSuspended = Boolean(isSuspended);
      user.status = isSuspended ? 'suspended' : 'active';
      if (isSuspended) {
        user.suspendedAt = new Date();
        user.suspendReason = suspendReason || 'Suspended by administrator';
        user.refreshTokens = [];
      } else {
        user.suspendedAt = null;
        user.suspendReason = '';
      }
    } else if (status !== undefined) {
      user.status = status;
      user.isSuspended = status === 'suspended';
      if (status === 'suspended') {
        user.suspendedAt = new Date();
        user.suspendReason = suspendReason || 'Suspended by administrator';
        user.refreshTokens = [];
      } else {
        user.suspendedAt = null;
        user.suspendReason = '';
      }
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Toggle user suspension (suspend / unsuspend)
// @route   PUT /api/admin/users/:id/suspend
router.put('/users/:id/suspend', async (req, res, next) => {
  try {
    const { reason, suspend } = req.body;
    const targetUserId = req.params.id;

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Safety checks: Prevent self-suspension
    const callerId = req.user?.id || getCallerId(req);
    if (callerId && callerId.toString() === targetUserId.toString()) {
      return res.status(400).json({
        success: false,
        error: 'You cannot suspend your own super admin account.'
      });
    }

    // Safety check: Prevent root admin account suspension
    if (user.email === 'admin@visitexpo.in') {
      return res.status(400).json({
        success: false,
        error: 'The root super admin account cannot be suspended.'
      });
    }

    // Determine target suspension state
    const shouldSuspend = suspend !== undefined ? Boolean(suspend) : !user.isSuspended;

    user.isSuspended = shouldSuspend;
    user.status = shouldSuspend ? 'suspended' : 'active';

    if (shouldSuspend) {
      user.suspendedAt = new Date();
      user.suspendReason = reason || 'Suspended by super administrator';
      user.refreshTokens = []; // Revoke active sessions immediately
    } else {
      user.suspendedAt = null;
      user.suspendReason = '';
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: shouldSuspend
        ? `Account for ${user.name} (${user.email}) has been suspended.`
        : `Account for ${user.name} (${user.email}) has been reactivated.`,
      user
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete user permanently
// @route   DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res, next) => {
  try {
    const targetUserId = req.params.id;

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Safety check 1: Prevent self-deletion
    const callerId = req.user?.id || getCallerId(req);
    if (callerId && callerId.toString() === targetUserId.toString()) {
      return res.status(400).json({
        success: false,
        error: 'You cannot delete your own super admin account.'
      });
    }

    // Safety check 2: Prevent root admin account deletion
    if (user.email === 'admin@visitexpo.in') {
      return res.status(400).json({
        success: false,
        error: 'The root super admin account cannot be deleted.'
      });
    }

    // Clean up references in Organization team members
    await Organization.updateMany(
      {},
      { $pull: { teamMembers: { user: targetUserId } } }
    );

    // Delete user document
    await User.findByIdAndDelete(targetUserId);

    res.status(200).json({
      success: true,
      message: `User account ${user.name} (${user.email}) deleted permanently.`,
      deletedUserId: targetUserId
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get all organizations / tenants
// @route   GET /api/admin/organizations
router.get('/organizations', async (req, res, next) => {
  try {
    const { search, page, limit } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { 'contact.email': { $regex: search, $options: 'i' } }
      ];
    }

    const pgNum = parseInt(page, 10) || 1;
    const pgLimit = parseInt(limit, 10) || 10;
    const skip = (pgNum - 1) * pgLimit;

    const [docs, total] = await Promise.all([
      Organization.find(query)
        .populate('teamMembers.user', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pgLimit),
      Organization.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        docs,
        total,
        page: pgNum,
        pages: Math.ceil(total / pgLimit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update organization settings or status
// @route   PUT /api/admin/organizations/:id
router.put('/organizations/:id', async (req, res, next) => {
  try {
    const { name, email, phone, address, plan } = req.body;
    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    if (name) organization.name = name;
    if (email) organization.contact.email = email;
    if (phone) organization.contact.phone = phone;
    if (address) organization.contact.address = address;
    if (plan) organization.subscription.plan = plan;

    await organization.save();

    res.status(200).json({
      success: true,
      message: 'Organization details updated successfully',
      organization
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete organization permanently
// @route   DELETE /api/admin/organizations/:id
router.delete('/organizations/:id', async (req, res, next) => {
  try {
    const orgId = req.params.id;
    const organization = await Organization.findById(orgId);

    if (!organization) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    // 1. Disassociate users linked to this organization
    await User.updateMany(
      { organization: orgId },
      { $set: { organization: null } }
    );

    // 2. Disassociate events linked to this organization
    await Event.updateMany(
      { organizer: orgId },
      { $set: { organizer: null } }
    );

    // 3. Disassociate exhibitors linked to this organization
    await Exhibitor.updateMany(
      { organization: orgId },
      { $set: { organization: null } }
    );

    // 4. Delete the organization document
    await Organization.findByIdAndDelete(orgId);

    res.status(200).json({
      success: true,
      message: `Organization "${organization.name}" has been permanently deleted.`,
      deletedId: orgId
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get subscriptions records
// @route   GET /api/admin/subscriptions
router.get('/subscriptions', async (req, res, next) => {
  try {
    const subs = await Subscription.find()
      .populate('organization', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: subs
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get global billing invoices / transaction log
// @route   GET /api/admin/invoices
router.get('/invoices', async (req, res, next) => {
  try {
    const invoices = await Invoice.find()
      .populate('organization', 'name')
      .sort({ createdAt: -1 });

    // Fallback to Order collection if Invoice collection is empty
    if (invoices.length === 0) {
      const orders = await Order.find()
        .populate('organizer', 'name')
        .sort({ createdAt: -1 });
      
      const parsedInvoices = orders.map(ord => ({
        _id: ord._id,
        invoiceNumber: `INV-${ord.orderNumber.split('-')[1] || 'MOCK'}`,
        organization: ord.organizer,
        amount: ord.totalAmount,
        currency: 'INR',
        status: ord.status === 'completed' ? 'paid' : 'unpaid',
        createdAt: ord.createdAt
      }));

      return res.status(200).json({
        success: true,
        data: parsedInvoices
      });
    }

    res.status(200).json({
      success: true,
      data: invoices
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get pending organizer account registrations
// @route   GET /api/admin/pending-organizers
router.get('/pending-organizers', async (req, res, next) => {
  try {
    const pendingUsers = await User.find({ role: 'organizer', isVerified: false })
      .populate('organization')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: pendingUsers
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Approve or Reject Organizer registration
// @route   PUT /api/admin/organizers/:id/status
router.put('/organizers/:id/status', async (req, res, next) => {
  try {
    const { action } = req.body; // 'approve' or 'reject'
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    if (action === 'approve') {
      user.isVerified = true;
      await user.save();

      // Trigger automatic account creation notification email to organizer
      const org = await Organization.findById(user.organization);
      sendOrganizerApprovalNotification({
        name: user.name,
        email: user.email,
        orgName: org?.name || ''
      }).catch(err => console.error('[AdminRoutes] Email notification error:', err.message));
    } else if (action === 'reject') {
      // Delete or mark inactive
      await User.findByIdAndDelete(req.params.id);
    }

    res.status(200).json({
      success: true,
      message: `Organizer account request set to ${action}d successfully`
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get verified/approved organizers history
// @route   GET /api/admin/organizer-history
router.get('/organizer-history', async (req, res, next) => {
  try {
    const verifiedUsers = await User.find({ role: 'organizer', isVerified: true })
      .populate('organization')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: verifiedUsers
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get pending exhibitor registrations across all events
// @route   GET /api/admin/pending-exhibitors
router.get('/pending-exhibitors', async (req, res, next) => {
  try {
    const pendingExhibitors = await Exhibitor.find({ status: 'pending' })
      .populate('event', 'title city startDate venue')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: pendingExhibitors
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Approve or Reject Exhibitor registration (Super Admin)
// @route   PUT /api/admin/exhibitors/:id/status
router.put('/exhibitors/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body; // 'approved' or 'rejected'

    if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Valid status is required' });
    }

    const exhibitor = await Exhibitor.findById(req.params.id);
    if (!exhibitor) {
      return res.status(404).json({ success: false, error: 'Exhibitor request not found' });
    }

    exhibitor.status = status;
    await exhibitor.save();

    // Sync isVerified on User
    const associatedUser = await User.findOne({ email: exhibitor.contactEmail });
    if (associatedUser && associatedUser.role === 'exhibitor') {
      if (status === 'approved') {
        associatedUser.isVerified = true;
        await associatedUser.save();
      } else {
        // Only mark unverified if they have NO other approved exhibitor accounts
        const otherApproved = await Exhibitor.findOne({
          contactEmail: exhibitor.contactEmail,
          _id: { $ne: exhibitor._id },
          status: 'approved'
        });
        if (!otherApproved) {
          associatedUser.isVerified = false;
          await associatedUser.save();
        }
      }
    }

    // Sync to event if approved
    if (status === 'approved') {
      const event = await Event.findById(exhibitor.event);
      if (event) {
        const exists = event.exhibitors.some(e => e.name === exhibitor.name);
        if (!exists) {
          event.exhibitors.push({
            name: exhibitor.name,
            logo: exhibitor.logo,
            boothNumber: exhibitor.boothNumber,
            website: exhibitor.website,
            description: exhibitor.description
          });
          await event.save();
        }
      }

      // Trigger automatic approval email notification to exhibitor
      sendExhibitorApprovalNotification({
        companyName: exhibitor.name,
        contactEmail: exhibitor.contactEmail,
        eventName: event?.title || '',
        boothNumber: exhibitor.boothNumber
      }).catch(err => console.error('[AdminRoutes] Exhibitor email error:', err.message));
    }

    res.status(200).json({
      success: true,
      message: `Exhibitor onboarding request set to ${status} successfully`,
      exhibitor
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Send manual email notification to organizer or exhibitor
// @route   POST /api/admin/send-notification
router.post('/send-notification', async (req, res, next) => {
  try {
    const { to, subject, message, recipientName } = req.body;
    if (!to || !message) {
      return res.status(400).json({ success: false, error: 'Recipient email and message content are required' });
    }

    const emailSubject = subject || `🎉 Account Onboarding Successful — Welcome to VisitExpo!`;
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Account Onboarding Successful</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #1e293b; }
          .wrapper { width: 100%; table-layout: fixed; background-color: #f8fafc; padding: 40px 0; }
          .main-card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
          .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 32px; text-align: center; color: #ffffff; }
          .brand-badge { display: inline-block; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); padding: 6px 16px; border-radius: 50px; font-size: 11px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px; }
          .header h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; line-height: 1.2; }
          .content { padding: 36px 32px; }
          .greeting { font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 12px; }
          .status-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 16px; padding: 20px; margin: 20px 0; text-align: center; }
          .status-badge { display: inline-block; background: #22c55e; color: #ffffff; font-weight: 800; padding: 6px 16px; border-radius: 50px; font-size: 13px; margin-bottom: 8px; }
          .status-text { font-size: 14px; color: #166534; font-weight: 700; margin: 0; }
          .msg-body { font-size: 15px; color: #334155; line-height: 1.6; margin: 20px 0; white-space: pre-wrap; background: #f8fafc; border-left: 4px solid #4f46e5; padding: 20px; border-radius: 8px; }
          .btn-container { text-align: center; margin: 32px 0 16px 0; }
          .btn { display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); color: #ffffff !important; font-weight: 800; text-decoration: none; padding: 16px 36px; border-radius: 14px; font-size: 15px; box-shadow: 0 6px 20px rgba(79,70,229,0.35); }
          .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5; }
          .footer a { color: #6366f1; text-decoration: none; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="main-card">
            <div class="header">
              <div class="brand-badge">VisitExpo Engine</div>
              <h1>Account Onboarding Successful 🎉</h1>
            </div>
            <div class="content">
              <div class="greeting">Hello ${recipientName || 'Valued Partner'},</div>
              
              <div class="status-box">
                <span class="status-badge">✓ Onboarding Complete</span>
                <p class="status-text">Your VisitExpo account has been created and verified successfully!</p>
              </div>

              <div class="msg-body">${message}</div>

              <div class="btn-container">
                <a href="https://visitexpo-client.vercel.app/login" class="btn" target="_blank">Access Your Dashboard &rarr;</a>
              </div>
            </div>
            <div class="footer">
              VisitExpo Inc. &bull; Official Event & Expo Synchronization Engine<br>
              Questions? Reach us at <a href="mailto:support@visitexpo.in">support@visitexpo.in</a> &bull; <a href="https://visitexpo.in">visitexpo.in</a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const result = await sendEmail({ to, subject: emailSubject, html: htmlContent });
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: `SMTP Login Failed: Please ensure the 'support@visitexpo.in' email account is fully created in cPanel by clicking the blue 'Create' button. (${result.error})`
      });
    }

    res.status(200).json({
      success: true,
      message: `Notification email successfully sent to ${to}`
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get processed exhibitors history (approved or rejected)
// @route   GET /api/admin/exhibitor-history
router.get('/exhibitor-history', async (req, res, next) => {
  try {
    const processedExhibitors = await Exhibitor.find({ status: { $in: ['approved', 'rejected'] } })
      .populate('event', 'title city startDate venue')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: processedExhibitors
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get pending event ownership claims
// @route   GET /api/admin/pending-claims
router.get('/pending-claims', async (req, res, next) => {
  try {
    const pendingClaims = await Event.find({ isClaimed: true, status: 'draft' })
      .populate('claimedBy', 'name email')
      .populate('organizer', 'name contact')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: pendingClaims
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get approved event ownership claims history
// @route   GET /api/admin/claim-history
router.get('/claim-history', async (req, res, next) => {
  try {
    const claimHistory = await Event.find({ isClaimed: true, status: 'published' })
      .populate('claimedBy', 'name email')
      .populate('organizer', 'name contact')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: claimHistory
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Approve or Reject Event Ownership Claim
// @route   PUT /api/admin/claims/:id/status
router.put('/claims/:id/status', async (req, res, next) => {
  try {
    const { action } = req.body; // 'approve' or 'reject'
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Claimed event record not found' });
    }

    if (action === 'approve') {
      event.status = 'published';
      await event.save();
      // Also verify claiming user if exists
      if (event.claimedBy) {
        await User.findByIdAndUpdate(event.claimedBy, { isVerified: true });
      }
    } else if (action === 'reject') {
      event.isClaimed = false;
      event.claimedBy = null;
      event.status = 'draft';
      await event.save();
    }

    res.status(200).json({
      success: true,
      message: `Event claim request set to ${action}d successfully`
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get pending event onboarding submissions
// @route   GET /api/admin/pending-events
router.get('/pending-events', async (req, res, next) => {
  try {
    const pendingEvents = await Event.find({ status: 'draft', isClaimed: { $ne: true } })
      .populate('organizer', 'name contact')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: pendingEvents
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get approved/moderated new events history
// @route   GET /api/admin/event-history
router.get('/event-history', async (req, res, next) => {
  try {
    const eventHistory = await Event.find({ status: { $in: ['published', 'cancelled'] }, isClaimed: { $ne: true } })
      .populate('organizer', 'name contact')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: eventHistory
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Approve or Reject Event Onboarding Submission
// @route   PUT /api/admin/events/:id/status
router.put('/events/:id/status', async (req, res, next) => {
  try {
    const { action } = req.body; // 'approve' or 'reject'
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event record not found' });
    }

    if (action === 'approve') {
      event.status = 'published';
      await event.save();

      // Real-time Sync to WordPress Pages via WordPressSyncService
      await syncEventToWordPress(event);
    } else if (action === 'reject') {
      event.status = 'cancelled';
      await event.save();
    }

    res.status(200).json({
      success: true,
      message: `Event onboarding request set to ${action}d successfully`,
      event
    });
  } catch (error) {
    next(error);
  }
});

export default router;
