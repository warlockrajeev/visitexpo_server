/**
 * @file WordPressSyncService.js
 * @description Helper service to sync events to WordPress custom REST API endpoint (visitexpo.in).
 */

import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Ticket from '../models/Ticket.js';
import {
  canonicalizeCategoryName,
  canonicalizeCountryName
} from '../utils/wpTaxonomies.js';

/**
 * Parse a single clock token (e.g. "10:00 AM", "6:30 PM", "18:00") into 24-hour { hour, minute }.
 */
const parseClockToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  const match = token.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3] ? match[3].toUpperCase() : '';
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) return null;

  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (!meridiem && (hour < 0 || hour > 23)) return null;
  if (meridiem && (hour < 0 || hour > 23)) return null;
  return { hour, minute };
};

/**
 * Parse timings string (e.g. "10:00 AM - 6:00 PM") into UTC start/end hour+minute tuples.
 * Defaults to 09:00 - 18:00 UTC per VisitExpo WP site timezone standard.
 */
export const parseTimingsRange = (timingsStr) => {
  const fallback = { startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 };
  if (!timingsStr || typeof timingsStr !== 'string') return fallback;
  const parts = timingsStr.split(/\s*(?:-|–|—|\bto\b)\s*/i).map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return fallback;
  const start = parseClockToken(parts[0]);
  const end = parts[1] ? parseClockToken(parts[1]) : null;
  return {
    startHour: start ? start.hour : fallback.startHour,
    startMinute: start ? start.minute : fallback.startMinute,
    endHour: end ? end.hour : fallback.endHour,
    endMinute: end ? end.minute : fallback.endMinute
  };
};

/**
 * Convert an Event Date + time-of-day into a UTC Unix timestamp (seconds),
 * matching WordPress OvaEvent's UTC storage (e.g. 2026-11-14T10:00:00Z -> 1794650400).
 */
export const buildUtcTimestampSeconds = (dateInput, hour = 9, minute = 0) => {
  if (!dateInput) return 0;
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute, 0) / 1000);
};

/**
 * Build a 1200x630 Cloudinary OG image URL when given a Cloudinary upload URL.
 */
export const buildCloudinaryOgImageUrl = (url) => {
  if (!url || typeof url !== 'string') return '';
  if (url.includes('res.cloudinary.com') && url.includes('/image/upload/')) {
    if (url.includes('w_1200') && url.includes('h_630')) return url;
    return url.replace('/image/upload/', '/image/upload/c_fill,w_1200,h_630,g_auto,q_auto,f_auto/');
  }
  return url;
};

/**
 * Format full address string: "venue, street address, city, state, country"
 */
export const formatEventFullAddress = (event) => {
  const parts = [
    event?.venue,
    event?.address,
    event?.city,
    event?.state,
    event?.country
  ]
    .map(p => String(p || '').trim())
    .filter(Boolean);

  const unique = [];
  for (const part of parts) {
    if (!unique.some(u => u.toLowerCase() === part.toLowerCase())) {
      unique.push(part);
    }
  }
  return unique.join(', ');
};

/**
 * Clean inline markdown formatting into proper HTML
 */
export const cleanInlineMarkdown = (text) => {
  if (!text) return '';
  return text
    // Replace ** 📅 Dates: ** or **Dates:** with <strong>
    .replace(/\*\*\s*([^*]+?)\s*\*\*/g, '<strong>$1</strong>')
    // Replace *italic* with <em>
    .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>')
    // Remove leftover raw hashtags
    .replace(/#{1,6}\s*/g, '')
    // Remove dangling unclosed asterisks
    .replace(/\*{2,}/g, '')
    .trim();
};

/**
 * Converts rich markdown text into clean Gutenberg HTML blocks
 * (wp:paragraph, wp:heading, wp:list, wp:quote)
 */
export const formatMarkdownToGutenbergBlocks = (rawContent, eventTitle = '') => {
  if (!rawContent || typeof rawContent !== 'string') {
    return '<!-- wp:paragraph -->\n<p></p>\n<!-- /wp:paragraph -->';
  }

  const normalized = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');
  const lines = [];
  let isFirstLine = true;

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i].trim();
    if (lines.length === 0 && !line) continue;
    if (isFirstLine && line) {
      isFirstLine = false;
      const strippedHeader = line.replace(/^#{1,6}\s*/, '').trim().toLowerCase();
      const normTitle = (eventTitle || '').trim().toLowerCase();
      if (normTitle && (strippedHeader === normTitle || strippedHeader.includes(normTitle))) {
        continue;
      }
    }
    // Skip stray lonely hashtag lines like "###" or "##"
    if (/^#{1,6}$/.test(line)) continue;
    lines.push(rawLines[i]);
  }

  const blocks = [];
  let currentList = [];
  let currentParagraphLines = [];

  const flushParagraph = () => {
    if (currentParagraphLines.length > 0) {
      const combined = currentParagraphLines.join(' ').trim();
      if (combined) {
        const cleaned = cleanInlineMarkdown(combined);
        if (cleaned) {
          blocks.push(`<!-- wp:paragraph -->\n<p>${cleaned}</p>\n<!-- /wp:paragraph -->`);
        }
      }
      currentParagraphLines = [];
    }
  };

  const flushList = () => {
    if (currentList.length > 0) {
      const itemsHtml = currentList.map(item => `  <li>${cleanInlineMarkdown(item)}</li>`).join('\n');
      blocks.push(`<!-- wp:list -->\n<ul>\n${itemsHtml}\n</ul>\n<!-- /wp:list -->`);
      currentList = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(Math.max(headingMatch[1].length, 2), 4);
      const headingText = cleanInlineMarkdown(headingMatch[2]);
      if (headingText) {
        blocks.push(`<!-- wp:heading {"level":${level}} -->\n<h${level}>${headingText}</h${level}>\n<!-- /wp:heading -->`);
      }
      continue;
    }
    const listMatch = trimmed.match(/^([•\-\*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      currentList.push(listMatch[2]);
      continue;
    }
    flushList();
    currentParagraphLines.push(trimmed);
  }
  flushParagraph();
  flushList();

  return blocks.length > 0 ? blocks.join('\n\n') : '<!-- wp:paragraph -->\n<p></p>\n<!-- /wp:paragraph -->';
};

export const syncEventToWordPress = async (eventInput) => {
  try {
    let event = null;
    if (typeof eventInput === 'string' || eventInput instanceof mongoose.Types.ObjectId) {
      event = await Event.findById(eventInput);
    } else if (eventInput && eventInput._id) {
      event = eventInput;
    }

    if (!event) {
      console.warn('[WP-Sync] Event record not found for WordPress sync.');
      return null;
    }

    const wpUser = process.env.WORDPRESS_API_USER;
    const wpPass = process.env.WORDPRESS_API_PASSWORD;
    const wpKey = process.env.WORDPRESS_API_KEY || '';
    const wpUrl = process.env.WORDPRESS_URL || 'https://visitexpo.in';

    // Compile sponsor levels and mapping
    const sponsorsLogos = [];
    const sponsorLevelMap = {};
    
    let logoCounter = 0;
    if (Array.isArray(event.sponsorsList) && event.sponsorsList.length > 0) {
      event.sponsorsList.forEach(sp => {
        const tierName = sp.tier || 'Our Sponsors';
        if (!sponsorLevelMap[tierName]) {
          sponsorLevelMap[tierName] = [];
        }
        
        const logoIndex = 10 + logoCounter;
        // Fallback logo if none provided: crisp branded sponsor logo
        const logoUrl = sp.logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(sp.name || 'Sponsor')}&background=0D8ABC&color=fff&size=200&bold=true`;
        sponsorsLogos.push(logoUrl);
        
        sponsorLevelMap[tierName].push({
          link: sp.link || '',
          logoIndex: logoIndex
        });
        
        logoCounter++;
      });
    }

    // Fetch Ticket Tiers from MongoDB
    const dbTickets = await Ticket.find({ event: event._id });

    let ticketsPayload = [];
    if (dbTickets && dbTickets.length > 0) {
      ticketsPayload = dbTickets.map(t => ({
        title: t.title,
        description: t.description || '',
        type: t.type || 'free',
        price: t.price || 0,
        currency: t.currency || 'INR',
        capacity: t.capacity || 1000
      }));
    } else {
      const isFree = event.isFreeEvent !== false;
      const price = isFree ? 0 : (event.paidTicketPrice || 0);
      ticketsPayload = [{
        title: isFree ? 'Visitor Pass' : 'General Admission',
        description: isFree ? 'Complimentary visitor registration pass' : `Standard paid entry ticket — ₹${price}`,
        type: isFree ? 'free' : 'paid',
        price: price,
        currency: 'INR',
        capacity: 1000
      }];
    }

    const formattedGutenbergContent = formatMarkdownToGutenbergBlocks(event.description, event.title);
    const { startHour, startMinute, endHour, endMinute } = parseTimingsRange(event.timings);
    const startTimestamp = buildUtcTimestampSeconds(event.startDate, startHour, startMinute);
    const endTimestamp = buildUtcTimestampSeconds(event.endDate || event.startDate, endHour, endMinute);

    const normalizedCategories = Array.isArray(event.categories)
      ? event.categories.map(canonicalizeCategoryName).filter(Boolean)
      : [];
    const normalizedIndustry = canonicalizeCategoryName(event.industry || normalizedCategories[0] || '');
    const normalizedCountry = canonicalizeCountryName(event.country || '');
    const fullAddress = formatEventFullAddress(event);
    const plainExcerpt = (event.excerpt || '').trim() ||
      String(event.description || '')
        .replace(/[#*_`>\[\]\(\)]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);

    const ogImageUrl = (event.seo?.ogImage || '').trim() || buildCloudinaryOgImageUrl(event.banner || '');

    const wpPayload = {
      title: event.title,
      content: formattedGutenbergContent,
      excerpt: plainExcerpt,
      slug: event.slug,
      status: event.status || 'draft',
      wpPostId: event.wpPostId || '',
      startDate: startTimestamp,
      endDate: endTimestamp,
      venue: event.venue || '',
      streetAddress: event.address || '',
      city: event.city || '',
      state: event.state || '',
      country: normalizedCountry,
      address: fullAddress,
      lat: typeof event.lat === 'number' && !Number.isNaN(event.lat) ? event.lat : null,
      lng: typeof event.lng === 'number' && !Number.isNaN(event.lng) ? event.lng : null,
      industry: normalizedIndustry,
      categories: normalizedCategories,
      tags: Array.isArray(event.tags) ? event.tags.filter(Boolean) : [],
      location: {
        country: normalizedCountry,
        state: event.state || '',
        city: event.city || ''
      },
      banner: event.banner || '',
      bannerAlt: (event.bannerAlt || '').trim() || event.title,
      bannerWidth: event.bannerWidth || 1200,
      bannerHeight: event.bannerHeight || 630,
      gallery: Array.isArray(event.gallery) ? event.gallery.filter(Boolean) : [],
      brochurePdf: event.brochurePdf || '',
      promoVideoUrl: event.promoVideoUrl || '',
      socials: event.socials || {},
      // Organizer details
      orgName: event.orgName || '',
      orgEmail: event.orgEmail || '',
      orgPhone: event.orgPhone || '',
      orgWebsite: event.orgWebsite || '',
      orgDesc: event.orgDesc || '',
      orgLogo: event.orgLogo || '',
      // Schedules
      schedules: event.schedules || [],
      // FAQs
      faqs: event.faqsList || [],
      // Contact
      contactShortcode: event.contactShortcode || '',
      // Sponsors
      labelSponsor: 'Our Sponsors',
      sponsorsLogos,
      sponsorLevels: Object.keys(sponsorLevelMap),
      sponsorGroups: Object.values(sponsorLevelMap),
      // Ticketing & Pricing (Keep labelTicket empty to avoid top pink register button)
      labelTicket: '',
      isFreeEvent: event.isFreeEvent,
      paidTicketPrice: event.paidTicketPrice || 0,
      tickets: ticketsPayload,
      // Yoast SEO
      seo: {
        metaTitle: (event.seo?.metaTitle || '').trim(),
        metaDescription: (event.seo?.metaDescription || '').trim(),
        focusKeyword: (event.seo?.focusKeyword || '').trim(),
        canonicalUrl: (event.seo?.canonicalUrl || '').trim(),
        ogTitle: (event.seo?.ogTitle || event.seo?.metaTitle || event.title || '').trim(),
        ogDescription: (event.seo?.ogDescription || event.seo?.metaDescription || plainExcerpt || '').trim(),
        ogImage: ogImageUrl
      }
    };

    if (wpKey) {
      const endpoint = `${wpUrl}/wp-json/visitexpo/v1/create-event`;
      console.log(`[WP-Sync] Pushing event to WordPress Custom Endpoint: ${endpoint}`);

      const wpResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VisitExpo-Key': wpKey
        },
        body: JSON.stringify(wpPayload)
      });

      if (wpResponse.ok) {
        const wpData = await wpResponse.json();
        event.wpPostId = String(wpData.id);
        event.wpUrl = wpData.link || event.wpUrl;
        if (wpData.slug && wpData.slug !== event.slug) {
          const slugConflict = await Event.findOne({ slug: wpData.slug, _id: { $ne: event._id } }).select('_id').lean();
          if (!slugConflict) {
            event.slug = wpData.slug;
          }
        }
        if (wpData.terms && typeof wpData.terms === 'object') {
          event.wpTerms = {
            categories: Array.isArray(wpData.terms.categories) ? wpData.terms.categories.map(Number).filter(n => !Number.isNaN(n)) : [],
            location: Array.isArray(wpData.terms.location) ? wpData.terms.location.map(Number).filter(n => !Number.isNaN(n)) : [],
            tags: Array.isArray(wpData.terms.tags) ? wpData.terms.tags.map(Number).filter(n => !Number.isNaN(n)) : []
          };
        }
        event.wpSyncedAt = new Date();
        event.syncError = '';
        await event.save();
        console.log(`[WP-Sync] Successfully synced event via WordPress Custom Endpoint. ID: ${wpData.id}, Slug: ${event.slug}, Link: ${wpData.link}`);
        return wpData;
      } else {
        const errText = await wpResponse.text();
        event.syncError = `WP HTTP ${wpResponse.status}: ${errText.slice(0, 300)}`;
        await event.save().catch(() => {});
        console.error(`[WP-Sync] WordPress Custom Endpoint returned error: ${wpResponse.status} - ${errText}`);
      }
    } else if (wpUser && wpPass) {
      const authBuffer = Buffer.from(`${wpUser}:${wpPass}`).toString('base64');

      const endpoint = event.wpPostId
        ? `${wpUrl}/wp-json/wp/v2/event/${event.wpPostId}`
        : `${wpUrl}/wp-json/wp/v2/event`;

      console.log(`[WP-Sync] Pushing event to WordPress standard API. Endpoint: ${endpoint}`);
      const wpResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${authBuffer}`
        },
        body: JSON.stringify(wpPayload)
      });

      if (wpResponse.ok) {
        const wpData = await wpResponse.json();
        event.wpPostId = String(wpData.id);
        event.wpUrl = wpData.link;
        event.wpSyncedAt = new Date();
        event.syncError = '';
        await event.save();
        console.log(`[WP-Sync] Successfully synced event in WordPress. ID: ${wpData.id}, Link: ${wpData.link}`);
        return wpData;
      } else {
        const errText = await wpResponse.text();
        event.syncError = `WP HTTP ${wpResponse.status}: ${errText.slice(0, 300)}`;
        await event.save().catch(() => {});
        console.error(`[WP-Sync] WordPress API returned error: ${wpResponse.status} - ${errText}`);
      }
    } else {
      event.syncError = 'WORDPRESS_API_KEY is not configured in server environment';
      await event.save().catch(() => {});
      console.warn('[WP-Sync] Skipped: WORDPRESS_API_KEY not found in env configuration.');
    }
  } catch (wpErr) {
    console.error('[WP-Sync] Failed to connect to WordPress REST API:', wpErr);
  }
  return null;
};
