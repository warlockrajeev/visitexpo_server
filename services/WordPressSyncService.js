/**
 * @file WordPressSyncService.js
 * @description Helper service to sync events to WordPress custom REST API endpoint (visitexpo.in).
 */

import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Ticket from '../models/Ticket.js';

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
    if (Array.isArray(event.sponsorsList)) {
      event.sponsorsList.forEach(sp => {
        const tierName = sp.tier || 'Sponsors';
        if (!sponsorLevelMap[tierName]) {
          sponsorLevelMap[tierName] = [];
        }
        
        const logoIndex = 10 + logoCounter;
        sponsorsLogos.push(sp.logo || '');
        
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

    const wpPayload = {
      title: event.title,
      content: `<!-- wp:paragraph -->\n<p>${event.description || ''}</p>\n<!-- /wp:paragraph -->`,
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
      sponsorsLogos,
      sponsorLevels: Object.keys(sponsorLevelMap),
      sponsorGroups: Object.values(sponsorLevelMap),
      // Ticketing & Pricing
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
