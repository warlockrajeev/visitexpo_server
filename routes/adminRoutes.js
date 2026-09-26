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
import Visitor from '../models/Visitor.js';
import EventEngagement from '../models/EventEngagement.js';
import DeletedOrganizer from '../models/DeletedOrganizer.js';
import DeletedEvent from '../models/DeletedEvent.js';
import mongoose from 'mongoose';
import { protect, authorize } from '../middlewares/auth.js';
import { deleteUserAndAllPlatformData } from '../services/userDeletionService.js';
import {
  sendEmail,
  sendOrganizerApprovalNotification,
  sendExhibitorApprovalNotification
} from '../services/emailService.js';
import { syncEventToWordPress } from '../services/WordPressSyncService.js';
import { verifyAccessToken } from '../utils/jwt.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __adminFilename = fileURLToPath(import.meta.url);
const __adminDirname = path.dirname(__adminFilename);

// Helper to look up real WordPress event image from local dataset
function getWpImage(slug, id, wpPostId, title) {
  try {
    const imgPath = path.join(__adminDirname, '../data/wordpress-event-images.json');
    if (fs.existsSync(imgPath)) {
      const data = JSON.parse(fs.readFileSync(imgPath, 'utf8'));
      if (slug && data[slug]) return data[slug];
      if (id && data[String(id)]) return data[String(id)];
      if (wpPostId && data[String(wpPostId)]) return data[String(wpPostId)];
      if (title) {
        const titleSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        if (data[titleSlug]) return data[titleSlug];
        const lowerTitle = title.toLowerCase();
        for (const [k, url] of Object.entries(data)) {
          if (k.length > 5 && isNaN(Number(k))) {
            const rk = k.replace(/-/g, ' ');
            if (lowerTitle.includes(rk) || (rk.length > 10 && rk.includes(lowerTitle))) return url;
          }
        }
      }
    }
  } catch {}
  return null;
}

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
      signal: AbortSignal.timeout(25000)
    });
    if (wpRes.ok) {
      const data = await wpRes.json();
      rawDocs = data.data?.docs || [];
    }
  } catch (err) {
    console.warn('[Admin] inspect-event-meta fetch failed, falling back to MongoDB:', err.message);
  }

  const [mongoEvents, deletedEvents] = await Promise.all([
    Event.find().lean(),
    DeletedEvent.find().lean()
  ]);

  const deletedEventIds = new Set((deletedEvents || []).map(d => String(d.eventId || '').trim().toLowerCase()));
  const deletedEventSlugs = new Set((deletedEvents || []).map(d => String(d.slug || '').trim().toLowerCase()));
  const deletedEventPostIds = new Set((deletedEvents || []).map(d => String(d.wpPostId || '').trim().toLowerCase()));
  const deletedEventTitles = new Set((deletedEvents || []).map(d => (d.title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')));

  const isEventDeleted = (id, slug, title, wpPostId) => {
    const sId = String(id || '').trim().toLowerCase();
    const sSlug = String(slug || '').trim().toLowerCase();
    const sPostId = String(wpPostId || '').trim().toLowerCase();
    const sTitle = (title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

    if (sId && (deletedEventIds.has(sId) || deletedEventSlugs.has(sId) || deletedEventPostIds.has(sId))) return true;
    if (sSlug && (deletedEventSlugs.has(sSlug) || deletedEventIds.has(sSlug))) return true;
    if (sPostId && deletedEventPostIds.has(sPostId)) return true;
    if (sTitle && deletedEventTitles.has(sTitle)) return true;
    return false;
  };

  const catMap = {};
  CATEGORIES_META.forEach(c => {
    catMap[c.name] = {
      ...c,
      events: []
    };
  });

  rawDocs.forEach((d, idx) => {
    if (isEventDeleted(d.id, d.slug, d.title, d.id)) return;
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

    const realImg = getWpImage(d.slug, d.id, d.id, d.title);
    const evtObj = {
      id: String(d.id || `wp-${idx}`),
      title: d.title || 'Exhibition Event',
      slug: d.slug,
      category: cat,
      venue: venue,
      city: cleanCity,
      image: realImg,
      banner: realImg,
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
    if (isEventDeleted(me._id, me.slug, me.title, me.wpPostId)) return;
    const catName = Array.isArray(me.categories) ? me.categories[0] : (me.categories || 'Trade & Industry');
    const matchedCat = catMap[catName] ? catName : inferCategory(me.title, me.description);
    
    const alreadyExists = catMap[matchedCat]?.events.some(e => e.slug === me.slug);
    if (!alreadyExists && catMap[matchedCat]) {
      const realMongoImg = me.banner || me.coverImage || me.thumbnail || me.image || getWpImage(me.slug, me._id, me.wpPostId, me.title);
      catMap[matchedCat].events.push({
        id: String(me._id),
        title: me.title,
        slug: me.slug,
        category: matchedCat,
        venue: me.venue || 'Convention Center',
        city: me.city || 'India',
        image: realMongoImg,
        banner: realMongoImg,
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

// Known venue slugs mapping to full names and verified addresses
const KNOWN_VENUE_SLUGS = {
  'jio-world-convention-centre': { name: 'Jio World Convention Centre', city: 'Mumbai', country: 'India', address: 'Bandra Kurla Complex (BKC), Bandra East, Mumbai, Maharashtra 400051' },
  'bharat-mandapam-pragati-maidan-new-delhi': { name: 'Bharat Mandapam (IECC)', city: 'New Delhi', country: 'India', address: 'Pragati Maidan, Mathura Road, New Delhi 110001' },
  'yashobhoomi-iicc-dwarka': { name: 'Yashobhoomi (IICC)', city: 'New Delhi', country: 'India', address: 'Sector 25, Dwarka, New Delhi 110077' },
  'india-expo-centre-greater-noida': { name: 'India Expo Centre & Mart', city: 'Greater Noida', country: 'India', address: 'Plot No. 23-25, Knowledge Park II, Greater Noida, UP 201306' },
  'bombay-exhibition-centre-nesco-mumbai': { name: 'Bombay Exhibition Centre (NESCO)', city: 'Mumbai', country: 'India', address: 'Western Express Hwy, Goregaon East, Mumbai 400063' },
  'hitex-exhibition-centre-hyderabad': { name: 'HITEX Exhibition Centre', city: 'Hyderabad', country: 'India', address: 'Izzat Nagar, Madhapur, Hyderabad, Telangana 500084' },
  'bangalore-international-exhibition-centre-biec': { name: 'Bangalore International Exhibition Centre (BIEC)', city: 'Bengaluru', country: 'India', address: '10th Mile, Tumkur Road, Madavara Post, Bengaluru 562123' },
  'chennai-trade-centre': { name: 'Chennai Trade Centre', city: 'Chennai', country: 'India', address: 'Nandambakkam, Chennai, Tamil Nadu 600089' },
  'biswa-bangla-mela-prangan-kolkata': { name: 'Biswa Bangla Mela Prangan', city: 'Kolkata', country: 'India', address: 'JBS Haldane Ave, Kolkata, West Bengal 700046' },
  'codissia-trade-fair-complex-coimbatore': { name: 'CODISSIA Trade Fair Complex', city: 'Coimbatore', country: 'India', address: 'G.V. Fair Grounds, Coimbatore, Tamil Nadu 641014' },
  'helipad-exhibition-centre-gandhinagar': { name: 'Helipad Exhibition Centre (HEC)', city: 'Ahmedabad', country: 'India', address: 'Sector 17, Gandhinagar, Gujarat 382016' }
};

export function parseWpLocation(rawLocation = '', rawCity = '') {
  const rawLoc = (rawLocation || '').trim();
  
  if (KNOWN_VENUE_SLUGS[rawLoc]) {
    const v = KNOWN_VENUE_SLUGS[rawLoc];
    return {
      venue: v.name,
      address: `${v.name}, ${v.address}`,
      location: `${v.name}, ${v.address}`,
      city: v.city,
      country: v.country,
      state: v.city === 'New Delhi' || v.city === 'Greater Noida' ? 'Delhi NCR' : v.city
    };
  }

  if (!rawLoc && !rawCity) {
    return {
      venue: 'Exhibition Center',
      address: 'Exhibition Center, India',
      location: 'Exhibition Center, India',
      city: 'India',
      country: 'India',
      state: 'India'
    };
  }

  const parts = rawLoc.split(',').map(p => p.trim()).filter(Boolean);
  
  // 1. Determine City
  let city = '';
  const cityList = [
    'New Delhi', 'Delhi', 'Greater Noida', 'Noida', 'Mumbai', 'Bengaluru', 'Bangalore',
    'Chennai', 'Hyderabad', 'Kolkata', 'Pune', 'Ahmedabad', 'Gandhinagar', 'Jaipur',
    'Kochi', 'Goa', 'Indore', 'Coimbatore', 'Surat', 'Lucknow', 'Chandigarh',
    'Santa Barbara', 'New York', 'Chicago', 'Las Vegas', 'Los Angeles', 'San Francisco', 'Orlando',
    'Copenhagen', 'Toronto', 'Glasgow', 'London', 'Birmingham', 'Frankfurt', 'Munich', 'Berlin',
    'Cologne', 'Dusseldorf', 'Paris', 'Madrid', 'Barcelona', 'Valencia', 'Milan', 'Bologna', 'Dubai',
    'Sharjah', 'Abu Dhabi', 'Riyadh', 'Jeddah', 'Singapore', 'Bangkok', 'Dhaka', 'Colombo',
    'Tangerang', 'Jakarta', 'Tokyo', 'Chiba', 'Baghdad', 'Kuala Lumpur', 'Tehran', 'Lagos', 'Dushanbe', 'Phnom Penh', 'Doha'
  ];

  for (const c of cityList) {
    if (new RegExp('\\b' + c + '\\b', 'i').test(rawLoc) || (rawCity && new RegExp('\\b' + c + '\\b', 'i').test(rawCity))) {
      city = c === 'Bangalore' ? 'Bengaluru' : (c === 'Delhi' ? 'New Delhi' : (c === 'Noida' ? 'Greater Noida' : c));
      break;
    }
  }

  if (!city && parts.length >= 3) {
    city = parts[parts.length - 2].replace(/[0-9\-\s]+/g, ' ').trim();
  }
  if (!city && parts.length >= 2) {
    city = parts[1].replace(/[0-9\-\s]+/g, ' ').trim();
  }
  if (!city) city = rawCity && rawCity !== 'India' ? rawCity : 'India';

  // 2. Determine State
  let state = '';
  const stateMap = {
    'Maharashtra': /maharashtra/i,
    'Karnataka': /karnataka/i,
    'Tamil Nadu': /tamil nadu/i,
    'Gujarat': /gujarat/i,
    'Telangana': /telangana/i,
    'West Bengal': /west bengal/i,
    'Rajasthan': /rajasthan/i,
    'Uttar Pradesh': /uttar pradesh/i,
    'Haryana': /haryana/i,
    'Kerala': /kerala/i,
    'Madhya Pradesh': /madhya pradesh/i,
    'Punjab': /punjab/i,
    'Goa': /goa/i,
    'Delhi NCR': /delhi|noida|gurgaon|gurugram/i,
    'California': /california|ca\b/i,
    'Florida': /florida|fl\b/i,
    'Illinois': /illinois|il\b/i,
    'Nevada': /nevada|nv\b/i,
    'Texas': /texas|tx\b/i,
    'New York': /new york|ny\b/i,
    'Scotland': /scotland/i,
    'Greater London': /london/i,
    'Dhaka Division': /dhaka/i,
    'Western Province': /colombo/i
  };

  for (const [stName, stRegex] of Object.entries(stateMap)) {
    if (stRegex.test(rawLoc)) {
      state = stName;
      break;
    }
  }

  if (!state) {
    if (city === 'Mumbai' || city === 'Pune') state = 'Maharashtra';
    else if (city === 'Bengaluru') state = 'Karnataka';
    else if (city === 'Chennai' || city === 'Coimbatore') state = 'Tamil Nadu';
    else if (city === 'Hyderabad') state = 'Telangana';
    else if (city === 'Ahmedabad' || city === 'Gandhinagar' || city === 'Surat') state = 'Gujarat';
    else if (city === 'Kolkata') state = 'West Bengal';
    else if (city === 'New Delhi' || city === 'Greater Noida') state = 'Delhi NCR';
    else if (city === 'Jaipur') state = 'Rajasthan';
    else if (city === 'Lucknow') state = 'Uttar Pradesh';
    else if (city === 'Indore') state = 'Madhya Pradesh';
    else if (city === 'Kochi') state = 'Kerala';
    else if (city === 'Santa Barbara') state = 'California';
    else if (city === 'Chicago') state = 'Illinois';
    else if (city === 'Orlando') state = 'Florida';
    else if (city === 'Las Vegas') state = 'Nevada';
    else if (city === 'Glasgow') state = 'Scotland';
    else if (city === 'Dhaka') state = 'Dhaka Division';
    else if (city === 'Colombo') state = 'Western Province';
    else state = city;
  }

  // 3. Determine Country
  let country = parts.length > 1 ? parts[parts.length - 1] : (rawCity || 'India');
  country = country.replace(/[0-9\-\s]+/g, ' ').trim() || 'India';

  const indianHubs = /delhi|mumbai|bengaluru|bangalore|chennai|hyderabad|pune|ahmedabad|gandhinagar|kolkata|jaipur|lucknow|indore|coimbatore|surat|kochi|goa|chandigarh|maharashtra|gujarat|karnataka/i;
  const usHubs = /santa barbara|new york|chicago|las vegas|los angeles|san francisco|orlando|texas|california|san antonio/i;
  const ukHubs = /london|glasgow|birmingham|manchester|scotland/i;
  const germanyHubs = /frankfurt|munich|berlin|cologne|dusseldorf/i;
  const uaeHubs = /dubai|abu dhabi|sharjah/i;

  if (indianHubs.test(rawLoc) || indianHubs.test(rawCity) || indianHubs.test(city)) country = 'India';
  else if (usHubs.test(rawLoc) || usHubs.test(rawCity) || usHubs.test(city)) country = 'United States';
  else if (ukHubs.test(rawLoc) || ukHubs.test(rawCity) || ukHubs.test(city)) country = 'United Kingdom';
  else if (germanyHubs.test(rawLoc) || germanyHubs.test(rawCity) || germanyHubs.test(city)) country = 'Germany';
  else if (uaeHubs.test(rawLoc) || uaeHubs.test(rawCity) || uaeHubs.test(city)) country = 'United Arab Emirates';
  else if (/usa|united states|america/i.test(country) || /united states/i.test(rawLoc)) country = 'United States';
  else if (/uk|united kingdom|england|scotland|wales/i.test(country) || /united kingdom/i.test(rawLoc)) country = 'United Kingdom';
  else if (/denmark/i.test(country) || /denmark/i.test(rawLoc)) country = 'Denmark';
  else if (/canada/i.test(country) || /canada/i.test(rawLoc)) country = 'Canada';
  else if (/indonesia/i.test(country) || /indonesia/i.test(rawLoc)) country = 'Indonesia';
  else if (/japan/i.test(country) || /japan/i.test(rawLoc)) country = 'Japan';
  else if (/malaysia/i.test(country) || /malaysia/i.test(rawLoc)) country = 'Malaysia';
  else if (/iraq/i.test(country) || /iraq/i.test(rawLoc)) country = 'Iraq';
  else if (/spain/i.test(country) || /spain/i.test(rawLoc)) country = 'Spain';
  else if (/france/i.test(country) || /france/i.test(rawLoc)) country = 'France';
  else if (/germany/i.test(country) || /germany/i.test(rawLoc)) country = 'Germany';
  else if (/italy/i.test(country) || /italy/i.test(rawLoc)) country = 'Italy';
  else if (/russia/i.test(country) || /russia/i.test(rawLoc)) country = 'Russia';
  else if (/saudi arabia/i.test(country) || /saudi arabia/i.test(rawLoc)) country = 'Saudi Arabia';
  else if (/singapore/i.test(country) || /singapore/i.test(rawLoc)) country = 'Singapore';
  else if (/thailand/i.test(country) || /thailand/i.test(rawLoc)) country = 'Thailand';
  else if (/bangladesh/i.test(country) || /bangladesh/i.test(rawLoc)) country = 'Bangladesh';
  else if (/sri lanka/i.test(country) || /sri lanka/i.test(rawLoc)) country = 'Sri Lanka';
  else if (/nigeria/i.test(country) || /nigeria/i.test(rawLoc)) country = 'Nigeria';
  else if (/cambodia/i.test(country) || /cambodia/i.test(rawLoc)) country = 'Cambodia';
  else if (/qatar/i.test(country) || /qatar/i.test(rawLoc)) country = 'Qatar';
  else if (/tajikistan/i.test(country) || /tajikistan/i.test(rawLoc)) country = 'Tajikistan';
  if (country === city) country = 'India';

  // 4. Distinguish specific venue facility from city/state-level address
  const firstPart = (parts[0] || '').trim();
  const isCityOnly = parts.length <= 3 && (
    firstPart.toLowerCase() === city.toLowerCase() ||
    firstPart.toLowerCase() === (state || '').toLowerCase() ||
    firstPart.toLowerCase() === (country || '').toLowerCase() ||
    cityList.some(cl => cl.toLowerCase() === firstPart.toLowerCase()) ||
    firstPart.toLowerCase() === 'exhibition center'
  );

  const venueName = isCityOnly ? '' : firstPart;
  const fullAddress = rawLoc || (venueName ? `${venueName}, ${city}, ${country}` : `${city}, ${state ? `${state}, ` : ''}${country}`);

  return {
    venue: venueName,
    address: fullAddress,
    location: fullAddress,
    city: city,
    country: country,
    state: state,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`
  };
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
      signal: AbortSignal.timeout(25000)
    });
    if (wpRes.ok) {
      const data = await wpRes.json();
      rawDocs = data.data?.docs || [];
    }
  } catch (err) {
    console.warn('[Admin] inspect-event-meta fetch failed for organizers, falling back to MongoDB:', err.message);
  }

  const [mongoEvents, mongoOrgs, deletedOrgs, deletedEvents] = await Promise.all([
    Event.find().lean(),
    Organization.find().lean(),
    DeletedOrganizer.find().lean(),
    DeletedEvent.find().lean()
  ]);

  const deletedNames = new Set((deletedOrgs || []).map(d => (d.name || '').toLowerCase().trim()));
  const deletedSlugIds = new Set((deletedOrgs || []).map(d => (d.slugId || '').toLowerCase().trim()));

  const deletedEventIds = new Set((deletedEvents || []).map(d => String(d.eventId || '').trim().toLowerCase()));
  const deletedEventSlugs = new Set((deletedEvents || []).map(d => String(d.slug || '').trim().toLowerCase()));
  const deletedEventPostIds = new Set((deletedEvents || []).map(d => String(d.wpPostId || '').trim().toLowerCase()));
  const deletedEventTitles = new Set((deletedEvents || []).map(d => (d.title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')));

  const isEventDeleted = (id, slug, title, wpPostId) => {
    const sId = String(id || '').trim().toLowerCase();
    const sSlug = String(slug || '').trim().toLowerCase();
    const sPostId = String(wpPostId || '').trim().toLowerCase();
    const sTitle = (title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

    if (sId && (deletedEventIds.has(sId) || deletedEventSlugs.has(sId) || deletedEventPostIds.has(sId))) return true;
    if (sSlug && (deletedEventSlugs.has(sSlug) || deletedEventIds.has(sSlug))) return true;
    if (sPostId && deletedEventPostIds.has(sPostId)) return true;
    if (sTitle && deletedEventTitles.has(sTitle)) return true;
    return false;
  };

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
    if (isEventDeleted(d.id, d.slug, d.title, d.id)) return;
    const m = d.meta || {};
    const startTs = m.ovaem_date_start_time?.[0];
    const endTs = m.ovaem_date_end_time?.[0];
    const rawLoc = m.ovaem_address_event?.[0] || m.ovaem_event_map_address?.[0] || m.ovaem_event_map_name?.[0] || m.ovaem_address?.[0] || m.ovaem_venue?.[0] || '';
    const loc = parseWpLocation(rawLoc, m.ovaem_city?.[0]);
    const desc = m.yoast_wpseo_metadesc?.[0] || m.ovaem_desc_event?.[0] || m.ovaem_org_desc?.[0] || '';
    const cat = inferCategory(d.title, desc);

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

    const realImg = getWpImage(d.slug, d.id, d.id, d.title);
    const evtObj = {
      id: String(d.id || `wp-${idx}`),
      title: d.title || 'Exhibition Event',
      slug: d.slug,
      category: cat,
      venue: loc.venue,
      address: loc.address,
      location: loc.location,
      city: loc.city,
      country: loc.country,
      image: realImg,
      banner: realImg,
      startDate: startTs && parseInt(startTs) > 0 ? new Date(parseInt(startTs) * 1000).toISOString() : null,
      endDate: endTs && parseInt(endTs) > 0 ? new Date(parseInt(endTs) * 1000).toISOString() : null,
      dates: startTs ? new Date(parseInt(startTs) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Upcoming 2026',
      organizer: resolvedName,
      status: 'published',
      wpUrl: `https://visitexpo.in/event/${d.slug}/`,
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address || loc.venue)}`,
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
    // If this event was deleted, skip
    if (isEventDeleted(me._id, me.slug, me.title, me.wpPostId)) return;

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

    const realMongoImg = me.banner || me.coverImage || me.thumbnail || me.image || getWpImage(me.slug, me._id, me.wpPostId, me.title);
    orgMap[resolvedName].events.push({
      id: String(me._id),
      title: me.title,
      slug: me.slug,
      category: Array.isArray(me.categories) ? me.categories[0] : (me.categories || 'Trade & Industry'),
      venue: me.venue || 'Convention Center',
      city: me.city || 'India',
      image: realMongoImg,
      banner: realMongoImg,
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
      newContactInquiries,
      totalEngagements,
      totalVisitors
    ] = await Promise.all([
      User.countDocuments(),
      Organization.countDocuments(),
      Event.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      Order.find({ status: 'completed' }).sort({ createdAt: 1 }).lean(),
      User.countDocuments({ role: 'organizer', isVerified: false }),
      Exhibitor.countDocuments({ status: 'pending' }),
      Event.countDocuments({ isClaimed: true, status: 'draft' }),
      Event.countDocuments({ status: 'draft', isClaimed: { $ne: true } }),
      ContactMessage.countDocuments({ status: 'new' }),
      EventEngagement.countDocuments(),
      Visitor.countDocuments()
    ]);

    // Sum revenue from real completed orders
    const totalRevenue = completedOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    // Group real monthly revenue
    const monthsOrderMap = {};
    completedOrders.forEach((o) => {
      if (o.createdAt) {
        const d = new Date(o.createdAt);
        const key = d.toLocaleString('en-US', { month: 'short' });
        monthsOrderMap[key] = (monthsOrderMap[key] || 0) + (o.totalAmount || 0);
      }
    });

    const now = new Date();
    const monthlyRevenue = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mName = d.toLocaleString('en-US', { month: 'short' });
      monthlyRevenue.push({
        month: mName,
        revenue: monthsOrderMap[mName] || 0
      });
    }
    // If all rolling months have 0 but orders exist in another month, include all active order months
    if (monthlyRevenue.every(m => m.revenue === 0) && Object.keys(monthsOrderMap).length > 0) {
      monthlyRevenue.length = 0;
      Object.keys(monthsOrderMap).forEach(mName => {
        monthlyRevenue.push({ month: mName, revenue: monthsOrderMap[mName] });
      });
    }

    // Get active subscription packages breakdown
    const subscriptions = await Subscription.find({ status: 'active' }).lean();
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

    // Real platform tenants on Free tier: all organizations not currently on paid growth/enterprise plan
    const paidCount = packagesCount.growth + packagesCount.enterprise;
    packagesCount.free = Math.max(totalOrganizations - paidCount, 0) + packagesCount.free;

    // Get recent contact form inquiries
    const recentInquiries = await ContactMessage.find()
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    // Sponsors
    let totalSponsors = await Sponsor.countDocuments();
    if (totalSponsors === 0) {
      totalSponsors = INITIAL_SPONSORS.length;
    }

    let recentSponsors = await Sponsor.find()
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();
    if (!recentSponsors || recentSponsors.length === 0) {
      recentSponsors = INITIAL_SPONSORS.slice(0, 6);
    }

    // Recent real tenants / registered organizations & organizers
    const [dbOrgs, orgUsers] = await Promise.all([
      Organization.find()
        .populate('teamMembers.user', 'name email phone')
        .populate('subscription')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      User.find({ role: 'organizer' })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
    ]);

    const recentTenants = [];
    const seenOrgNames = new Set();

    dbOrgs.forEach((org) => {
      const ownerUser = org.teamMembers?.[0]?.user;
      const ownerName = ownerUser?.name || org.contact?.email?.split('@')[0] || 'Organization Admin';
      const ownerContact = ownerUser?.email || org.contact?.email || 'N/A';
      seenOrgNames.add(org.name.toLowerCase().trim());

      recentTenants.push({
        id: String(org._id),
        name: org.name,
        owner: `${ownerName} (${ownerContact})`,
        org: org.address?.city ? `${org.address.city}, India` : 'Registered Tenant',
        plan: org.subscription?.plan || 'free',
        status: org.subscription?.status || 'active',
        signed: org.createdAt ? new Date(org.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent'
      });
    });

    orgUsers.forEach((u) => {
      const derivedOrgName = u.organization?.name || (u.email?.includes('@indiandjexpo.com') ? 'Indian DJ Expo' : u.email?.includes('@techhubexpo.com') ? 'TechHub Expo' : `${u.name}'s Events`);
      if (!seenOrgNames.has(derivedOrgName.toLowerCase().trim())) {
        seenOrgNames.add(derivedOrgName.toLowerCase().trim());
        recentTenants.push({
          id: String(u._id),
          name: derivedOrgName,
          owner: `${u.name} (${u.email})`,
          org: 'Organizer Account',
          plan: 'free',
          status: u.isSuspended ? 'suspended' : 'active',
          signed: u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent'
        });
      }
    });

    // Total Attendees & Followers KPI
    const totalAttendees = totalEngagements + totalVisitors;

    // Categories summary
    let categoriesSummary = { totalCategories: 11, totalEvents: 2660, categories: [] };
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
          totalSponsors: totalSponsors,
          totalAttendees
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
        monthlyRevenue,
        recentTenants,
        recentSponsors: recentSponsors.map(sp => ({
          _id: sp._id,
          name: sp.name,
          tier: sp.tier,
          expo: sp.eventTitle || sp.expo || 'Partner Trade Expo',
          logo: sp.logo,
          website: sp.website,
          color: sp.tier === 'platinum' ? 'text-purple-500 bg-purple-500/10' : sp.tier === 'gold' ? 'text-amber-500 bg-amber-500/10' : 'text-slate-500 bg-slate-500/10'
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
        .populate('organization', 'name logo website address contact gst description')
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

// @desc    Get complete details of a specific user including related events, passes, registrations, orders
// @route   GET /api/admin/users/:id
router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('organization', 'name logo website address contact gst description social');

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const email = (user.email || '').toLowerCase();

    // Parallel fetch of user-related activities
    const [events, eventsCount, visitorPasses, visitorPassesCount, exhibitorStalls, exhibitorStallsCount, orders, ordersCount] = await Promise.all([
      // Events hosted by this user or their organization
      Event.find({
        $or: [
          { organizer: user._id },
          ...(user.organization ? [{ organization: user.organization._id || user.organization }] : [])
        ]
      })
        .select('title slug startDate endDate city venue status isFeatured banner')
        .sort({ createdAt: -1 })
        .limit(10),
      Event.countDocuments({
        $or: [
          { organizer: user._id },
          ...(user.organization ? [{ organization: user.organization._id || user.organization }] : [])
        ]
      }),
      // Visitor passes registered
      email ? Visitor.find({ email })
        .populate('event', 'title slug startDate endDate venue city banner')
        .sort({ createdAt: -1 })
        .limit(10) : Promise.resolve([]),
      email ? Visitor.countDocuments({ email }) : Promise.resolve(0),
      // Exhibitor stalls
      email ? Exhibitor.find({ contactEmail: email })
        .populate('event', 'title slug startDate endDate venue city banner')
        .sort({ createdAt: -1 })
        .limit(10) : Promise.resolve([]),
      email ? Exhibitor.countDocuments({ contactEmail: email }) : Promise.resolve(0),
      // Ticket orders
      email ? Order.find({ 'buyer.email': email })
        .populate('event', 'title slug startDate endDate venue city')
        .sort({ createdAt: -1 })
        .limit(10) : Promise.resolve([]),
      email ? Order.countDocuments({ 'buyer.email': email }) : Promise.resolve(0)
    ]);

    res.status(200).json({
      success: true,
      data: {
        user,
        stats: {
          eventsCount,
          visitorPassesCount,
          exhibitorStallsCount,
          ordersCount,
          activeTokensCount: Array.isArray(user.refreshTokens) ? user.refreshTokens.length : 0
        },
        activity: {
          events,
          visitorPasses,
          exhibitorStalls,
          orders
        }
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
    const {
      name,
      email,
      role,
      isVerified,
      isPhoneVerified,
      isSuspended,
      status,
      suspendReason,
      phone,
      city,
      company,
      designation
    } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (name) user.name = name;
    if (email) user.email = email.toLowerCase();
    if (role) user.role = role;
    if (isVerified !== undefined) user.isVerified = Boolean(isVerified);
    if (isPhoneVerified !== undefined) user.isPhoneVerified = Boolean(isPhoneVerified);
    if (phone !== undefined) user.phone = phone;
    if (city !== undefined) user.city = city;
    if (company !== undefined) user.company = company;
    if (designation !== undefined) user.designation = designation;

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

// @desc    Delete user permanently and cascade all associated platform data
// @route   DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res, next) => {
  try {
    const targetUserId = req.params.id;
    const callerId = req.user?.id || getCallerId(req);

    const result = await deleteUserAndAllPlatformData(targetUserId, callerId);

    res.status(200).json({
      success: true,
      message: result.message,
      deletedUserId: targetUserId,
      stats: result.stats
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
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

// @desc    Get summary count of all pending moderation items (Super Admin)
// @route   GET /api/admin/pending-summary
router.get('/pending-summary', async (req, res, next) => {
  try {
    const [pendingOrganizers, pendingExhibitors, pendingClaims, pendingEvents] = await Promise.all([
      User.countDocuments({ role: 'organizer', isVerified: false }),
      Exhibitor.countDocuments({ status: 'pending' }),
      Event.countDocuments({ isClaimed: true, status: 'draft' }),
      Event.countDocuments({ status: 'pending' })
    ]);

    const totalPending = pendingOrganizers + pendingExhibitors + pendingClaims + pendingEvents;

    res.status(200).json({
      success: true,
      data: {
        pendingOrganizers,
        pendingExhibitors,
        pendingClaims,
        pendingEvents,
        totalPending
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get complete detail dossier for a moderation item (Super Admin)
// @route   GET /api/admin/moderation/:type/:id
router.get('/moderation/:type/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params;

    if (type === 'exhibitors') {
      const exhibitor = await Exhibitor.findById(id)
        .populate('event', 'title city startDate endDate venue slug banner logo description organizer');

      if (!exhibitor) {
        return res.status(404).json({ success: false, error: 'Exhibitor application not found' });
      }

      // Find associated user login account
      const emailEscaped = (exhibitor.contactEmail || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const associatedUser = await User.findOne({
        email: { $regex: new RegExp(`^${emailEscaped}$`, 'i') }
      }).select('name email role isVerified createdAt');

      return res.status(200).json({
        success: true,
        type: 'exhibitor',
        data: {
          ...exhibitor.toObject(),
          associatedUser
        }
      });
    }

    if (type === 'organizers') {
      const user = await User.findById(id).populate('organization');
      if (!user) {
        return res.status(404).json({ success: false, error: 'Organizer user account not found' });
      }

      // Find any events associated with this organizer / organization
      const orgId = user.organization?._id || user.organization;
      const events = await Event.find({
        $or: [
          { organizer: orgId },
          { claimedBy: user._id }
        ]
      }).select('title city startDate venue status slug');

      return res.status(200).json({
        success: true,
        type: 'organizer',
        data: {
          ...user.toObject(),
          events
        }
      });
    }

    if (type === 'events' || type === 'claims') {
      const event = await Event.findById(id)
        .populate('organizer', 'name email contact address')
        .populate('claimedBy', 'name email role isVerified');

      if (!event) {
        return res.status(404).json({ success: false, error: 'Event record not found' });
      }

      return res.status(200).json({
        success: true,
        type: type === 'claims' ? 'claim' : 'event',
        data: event
      });
    }

    return res.status(400).json({ success: false, error: `Unsupported moderation type: ${type}` });
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
    const emailEscaped = (exhibitor.contactEmail || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const associatedUser = await User.findOne({ email: { $regex: new RegExp(`^${emailEscaped}$`, 'i') } });
    if (associatedUser && associatedUser.role === 'exhibitor') {
      if (status === 'approved') {
        associatedUser.isVerified = true;
        await associatedUser.save();
      } else {
        // Only mark unverified if they have NO other approved exhibitor accounts
        const otherApproved = await Exhibitor.findOne({
          contactEmail: { $regex: new RegExp(`^${emailEscaped}$`, 'i') },
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

// ========================================================
// ORGANIZER EVENTS MANAGEMENT & WORDPRESS TWO-WAY SYNC
// ========================================================

// @desc    Get all events created by organizers with filtering & stats
// @route   GET /api/admin/events
router.get('/events', async (req, res, next) => {
  try {
    const { status, category, search, page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    // Base query
    const query = {};

    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Category filter
    if (category && category !== 'all') {
      query.categories = category;
    }

    // Search query across title, venue, city, orgName, slug
    if (search && search.trim()) {
      const searchClean = search.trim();
      const searchRegex = new RegExp(searchClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { title: searchRegex },
        { venue: searchRegex },
        { city: searchRegex },
        { orgName: searchRegex },
        { slug: searchRegex }
      ];
    }

    // Exclude permanently deleted events if any
    try {
      const deletedDocs = await DeletedEvent.find().select('slug title eventId').lean();
      if (deletedDocs && deletedDocs.length > 0) {
        const delSlugs = deletedDocs.map(d => d.slug).filter(Boolean);
        const delIds = deletedDocs.map(d => d.eventId).filter(Boolean);
        if (delSlugs.length > 0 || delIds.length > 0) {
          query._id = { $nin: delIds.filter(id => mongoose.isValidObjectId(id)) };
          query.slug = { $nin: delSlugs };
        }
      }
    } catch {}

    const [events, totalEvents, publishedCount, draftCount, cancelledCount, wpSyncedCount, filteredTotal] = await Promise.all([
      Event.find(query)
        .populate('organizer', 'name logo website email contact')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Event.countDocuments(),
      Event.countDocuments({ status: 'published' }),
      Event.countDocuments({ status: 'draft' }),
      Event.countDocuments({ status: 'cancelled' }),
      Event.countDocuments({ wpPostId: { $exists: true, $ne: '' } }),
      Event.countDocuments(query)
    ]);

    // Enhance events with local images if missing
    const enhancedEvents = events.map(e => ({
      ...e,
      banner: e.banner || getWpImage(e.slug, e._id, e.wpPostId, e.title) || null
    }));

    res.status(200).json({
      success: true,
      data: {
        events: enhancedEvents,
        stats: {
          totalEvents,
          publishedCount,
          draftCount,
          cancelledCount,
          wpSyncedCount
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: filteredTotal,
          pages: Math.ceil(filteredTotal / limitNum) || 1
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get single event by ID for admin inspection/editing
// @route   GET /api/admin/events/:id
router.get('/events/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    let event = null;
    if (mongoose.isValidObjectId(id)) {
      event = await Event.findById(id).populate('organizer', 'name logo website email contact').lean();
    }
    if (!event) {
      event = await Event.findOne({ slug: id }).populate('organizer', 'name logo website email contact').lean();
    }

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Fallback banner image if missing
    event.banner = event.banner || getWpImage(event.slug, event._id, event.wpPostId, event.title) || null;

    res.status(200).json({
      success: true,
      data: event
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Admin edit event & real-time sync changes to WordPress
// @route   PUT /api/admin/events/:id
router.put('/events/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};

    let event = null;
    if (mongoose.isValidObjectId(id)) {
      event = await Event.findById(id);
    }
    if (!event) {
      event = await Event.findOne({ slug: id });
    }

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event record not found' });
    }

    // Editable fields
    const allowedFields = [
      'title', 'slug', 'description', 'banner', 'gallery',
      'venue', 'city', 'state', 'country', 'startDate', 'endDate', 'timings',
      'categories', 'status', 'orgName', 'orgEmail', 'orgPhone',
      'orgWebsite', 'orgDesc', 'orgLogo', 'isFreeEvent', 'paidTicketPrice',
      'schedules', 'faqsList', 'sponsorsList', 'contactShortcode', 'seo'
    ];

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        event[field] = updates[field];
      }
    });

    await event.save();

    // Real-time synchronization to WordPress!
    let wpSyncSuccess = false;
    let wpData = null;
    try {
      wpData = await syncEventToWordPress(event);
      if (wpData) {
        wpSyncSuccess = true;
      }
    } catch (wpErr) {
      console.warn('[Admin] Automatic WordPress sync encountered warning:', wpErr.message);
    }

    // Re-fetch populated
    const populated = await Event.findById(event._id)
      .populate('organizer', 'name logo website email contact')
      .lean();

    res.status(200).json({
      success: true,
      message: wpSyncSuccess 
        ? 'Event updated successfully and synced to WordPress!'
        : 'Event updated in database. WordPress sync queued.',
      event: populated,
      wpSynced: wpSyncSuccess || !!event.wpPostId,
      wpPostId: event.wpPostId,
      wpUrl: event.wpUrl
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Manually force-sync single event to WordPress
// @route   POST /api/admin/events/:id/sync-wp
router.post('/events/:id/sync-wp', async (req, res, next) => {
  try {
    const { id } = req.params;
    let event = null;
    if (mongoose.isValidObjectId(id)) {
      event = await Event.findById(id);
    }
    if (!event) {
      event = await Event.findOne({ slug: id });
    }

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    const wpResult = await syncEventToWordPress(event);
    if (!wpResult) {
      return res.status(502).json({
        success: false,
        error: 'Failed to sync event to WordPress. Please check WordPress API credentials in environment configuration.'
      });
    }

    res.status(200).json({
      success: true,
      message: `Event successfully synchronized to WordPress (Post ID #${event.wpPostId || wpResult.id})`,
      wpPostId: event.wpPostId || wpResult.id,
      wpUrl: event.wpUrl || wpResult.link
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

// @desc    Bulk Approve or Reject Event Onboarding Submissions
// @route   POST /api/admin/events/bulk-status
router.post('/events/bulk-status', async (req, res, next) => {
  try {
    const { eventIds, action } = req.body; // 'approve' or 'reject'
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return res.status(400).json({ success: false, error: 'eventIds array is required' });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'action must be approve or reject' });
    }

    const events = await Event.find({ _id: { $in: eventIds } });
    if (!events || events.length === 0) {
      return res.status(404).json({ success: false, error: 'No matching events found' });
    }

    let processedCount = 0;
    let failedCount = 0;

    for (const event of events) {
      try {
        if (action === 'approve') {
          event.status = 'published';
          await event.save();
          // Real-time sync to WordPress Pages in background
          syncEventToWordPress(event).catch(wpErr => {
            console.warn(`[Bulk Sync] WP Sync note for event ${event._id}:`, wpErr.message);
          });
        } else if (action === 'reject') {
          event.status = 'cancelled';
          await event.save();
        }
        processedCount++;
      } catch (err) {
        console.error(`[Bulk Event Status] Failed to process event ${event._id}:`, err);
        failedCount++;
      }
    }

    res.status(200).json({
      success: true,
      message: `Successfully ${action}d ${processedCount} event${processedCount !== 1 ? 's' : ''}${failedCount > 0 ? ` (${failedCount} failed)` : ''}!`,
      data: {
        processedCount,
        failedCount,
        action
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Permanently delete an event across MongoDB, WordPress directory, and Category breakdowns
// @route   DELETE /api/admin/events/:id
router.delete('/events/:id', async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const { slug, title, wpPostId, reason } = req.body || {};
    const callerId = req.user?.id || getCallerId(req);

    // 1. Delete from MongoDB Event collection if exists
    let deletedDoc = null;
    try {
      deletedDoc = await Event.findOneAndDelete({
        $or: [
          { _id: mongoose.isValidObjectId(targetId) ? targetId : null },
          { slug: targetId },
          { slug: slug || null },
          { wpPostId: targetId },
          { wpPostId: wpPostId || null }
        ].filter(Boolean)
      });
    } catch (dbErr) {
      console.warn('[Admin] MongoDB delete event query warning:', dbErr.message);
    }

    const eventTitle = title || deletedDoc?.title || 'Exhibition Event';
    const eventSlug = slug || deletedDoc?.slug || targetId;
    const eventWpId = wpPostId || deletedDoc?.wpPostId || targetId;

    // 2. Record in DeletedEvent for permanent exclusion across WordPress and aggregated directory
    await DeletedEvent.findOneAndUpdate(
      {
        $or: [
          { eventId: String(targetId) },
          { slug: String(eventSlug) },
          { wpPostId: String(eventWpId) }
        ]
      },
      {
        eventId: String(targetId),
        slug: String(eventSlug),
        title: eventTitle,
        wpPostId: String(eventWpId),
        deletedAt: new Date(),
        deletedBy: callerId && mongoose.isValidObjectId(callerId) ? callerId : null,
        reason: reason || 'Deleted by Super Admin'
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // 3. Clean up any related tickets or exhibitor associations
    if (deletedDoc?._id) {
      try {
        await Exhibitor.updateMany(
          { event: deletedDoc._id },
          { $set: { event: null } }
        );
      } catch (exErr) {
        console.warn('[Admin] Exhibitor disassociation warning:', exErr.message);
      }
    }

    // 4. Invalidate in-memory caches immediately
    categoriesCache = { data: null, timestamp: 0, ttl: 0 };
    organizersCache = { data: null, timestamp: 0, ttl: 0 };

    res.status(200).json({
      success: true,
      message: `Event "${eventTitle}" permanently deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get detailed applicant dossier for approval inspection
// @route   GET /api/admin/moderation/:type/:id
router.get('/moderation/:type/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid applicant ID format' });
    }

    if (type === 'exhibitors') {
      const exhibitor = await Exhibitor.findById(id)
        .populate('event', 'title city startDate endDate venue slug banner logo description organizer')
        .lean();

      if (!exhibitor) {
        return res.status(404).json({ success: false, error: 'Exhibitor application record not found' });
      }

      // Find associated login user account if exists
      const emailEscaped = (exhibitor.contactEmail || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const associatedUser = await User.findOne({
        email: { $regex: new RegExp(`^${emailEscaped}$`, 'i') }
      }).select('name email role isVerified createdAt').lean();

      return res.status(200).json({
        success: true,
        data: {
          ...exhibitor,
          associatedUser: associatedUser || null
        }
      });
    }

    if (type === 'organizers') {
      const user = await User.findById(id)
        .populate('organization')
        .select('-password')
        .lean();

      if (!user) {
        return res.status(404).json({ success: false, error: 'Organizer account record not found' });
      }

      // Find events linked to this organizer
      const events = await Event.find({ organizer: user._id })
        .select('title city startDate endDate venue status banner slug')
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({
        success: true,
        data: {
          ...user,
          events: events || []
        }
      });
    }

    if (type === 'events') {
      const event = await Event.findById(id)
        .populate('organizer', 'name contact email website phone')
        .lean();

      if (!event) {
        return res.status(404).json({ success: false, error: 'Event onboarding record not found' });
      }

      return res.status(200).json({
        success: true,
        data: event
      });
    }

    if (type === 'claims') {
      const event = await Event.findById(id)
        .populate('claimedBy', 'name email phone role isVerified')
        .populate('organizer', 'name contact')
        .lean();

      if (!event) {
        return res.status(404).json({ success: false, error: 'Event claim record not found' });
      }

      return res.status(200).json({
        success: true,
        data: event
      });
    }

    return res.status(400).json({ success: false, error: `Unsupported moderation category: ${type}` });
  } catch (error) {
    next(error);
  }
});

export default router;
