/**
 * @file WordPressSyncService.js
 * @description Helper service to sync events to WordPress custom REST API endpoint (visitexpo.in).
 */

import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Ticket from '../models/Ticket.js';

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
    const wpKey = process.env.WORDPRESS_API_KEY || 'visitexpo_custom_secret_key_12345';
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

    const wpPayload = {
      title: event.title,
      content: formattedGutenbergContent,
      slug: event.slug,
      wpPostId: event.wpPostId || '',
      startDate: event.startDate ? Math.floor(new Date(event.startDate).getTime() / 1000) : 0,
      endDate: event.endDate ? Math.floor(new Date(event.endDate).getTime() / 1000) : 0,
      address: `${event.venue || ''}, ${event.city || ''}`.trim().replace(/^,\s*/, ''),
      banner: event.banner || '',
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
      tickets: ticketsPayload
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
        event.wpUrl = wpData.link;
        await event.save();
        console.log(`[WP-Sync] Successfully synced page via WordPress Custom Endpoint. ID: ${wpData.id}, Link: ${wpData.link}`);
        return wpData;
      } else {
        const errText = await wpResponse.text();
        console.error(`[WP-Sync] WordPress Custom Endpoint returned error: ${wpResponse.status} - ${errText}`);
      }
    } else if (wpUser && wpPass) {
      const authBuffer = Buffer.from(`${wpUser}:${wpPass}`).toString('base64');
      
      const endpoint = event.wpPostId 
        ? `${wpUrl}/wp-json/wp/v2/pages/${event.wpPostId}`
        : `${wpUrl}/wp-json/wp/v2/pages`;

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
        await event.save();
        console.log(`[WP-Sync] Successfully synced page in WordPress. ID: ${wpData.id}, Link: ${wpData.link}`);
        return wpData;
      } else {
        const errText = await wpResponse.text();
        console.error(`[WP-Sync] WordPress API returned error: ${wpResponse.status} - ${errText}`);
      }
    } else {
      console.log('[WP-Sync] Skipped: WordPress API credentials / API Key not found in env configuration.');
    }
  } catch (wpErr) {
    console.error('[WP-Sync] Failed to connect to WordPress REST API:', wpErr);
  }
  return null;
};
