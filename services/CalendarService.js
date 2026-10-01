/**
 * @file CalendarService.js
 * @description Service for generating calendar sync links (Google Calendar, Outlook/Office 365, RFC 5545 .ics),
 * managing reminder preferences, and dispatching scheduled event reminders to registered attendees.
 */

import Visitor from '../models/Visitor.js';
import Event from '../models/Event.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';

class CalendarService {
  /**
   * Helper: Format Date object to RFC 5545 UTC compact format (YYYYMMDDTHHmmssZ)
   */
  static formatDateToIcsUtc(dateInput) {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  /**
   * Helper: Ensure start and end dates are valid Dates
   */
  static getEventDates(event) {
    let start = event.startDate ? new Date(event.startDate) : null;
    let end = event.endDate ? new Date(event.endDate) : null;

    // If start or end are missing, attempt parsing event.dates or event.date
    const rawDates = event.dates || event.date || event.dateRange;
    if ((!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) && typeof rawDates === 'string') {
      const cleaned = rawDates.trim();

      // Pattern A: '25 - 28 Mar, 2026' or '25 to 28 Mar 2026'
      const patternA = cleaned.match(/^(\d{1,2})\s*[-–to]+\s*(\d{1,2})\s+([A-Za-z]+),?\s*(\d{4})/i);
      if (patternA) {
        const [, startDay, endDay, month, year] = patternA;
        const parsedS = new Date(`${month} ${startDay}, ${year} 09:00:00`);
        const parsedE = new Date(`${month} ${endDay}, ${year} 18:00:00`);
        if (!isNaN(parsedS.getTime())) start = parsedS;
        if (!isNaN(parsedE.getTime())) end = parsedE;
      } else {
        // Pattern B: '25 Mar - 28 Mar 2026'
        const parts = cleaned.split(/[-–]|(?:\s+to\s+)/i).map((s) => s.trim());
        if (parts.length === 2) {
          const yearMatch = cleaned.match(/\b(202\d|203\d)\b/);
          const year = yearMatch ? yearMatch[1] : new Date().getFullYear();
          let sStr = parts[0];
          let eStr = parts[1];
          if (!/\b(202\d|203\d)\b/.test(sStr) && year) sStr += ` ${year}`;
          if (!/\b(202\d|203\d)\b/.test(eStr) && year) eStr += ` ${year}`;
          const parsedS = new Date(`${sStr} 09:00:00`);
          const parsedE = new Date(`${eStr} 18:00:00`);
          if (!isNaN(parsedS.getTime())) start = parsedS;
          if (!isNaN(parsedE.getTime())) end = parsedE;
        } else {
          const singleParsed = new Date(cleaned);
          if (!isNaN(singleParsed.getTime())) {
            start = new Date(singleParsed);
            start.setHours(9, 0, 0, 0);
            end = new Date(singleParsed);
            end.setHours(18, 0, 0, 0);
          }
        }
      }
    }

    if (!start || isNaN(start.getTime())) {
      start = new Date();
      start.setDate(start.getDate() + 7); // Default to 7 days from now
      start.setHours(9, 0, 0, 0);
    }

    if (!end || isNaN(end.getTime()) || end <= start) {
      end = new Date(start.getTime());
      end.setHours(start.getHours() + 8); // 8-hour exhibition day
    }

    return { start, end };
  }

  /**
   * Construct 1-click Google Calendar web creation URL with reminders and metadata
   */
  static buildGoogleCalendarUrl(event, options = {}) {
    const { start, end } = this.getEventDates(event);
    const startStr = this.formatDateToIcsUtc(start);
    const endStr = this.formatDateToIcsUtc(end);

    const title = event.title || 'VisitExpo Exhibition';
    const venue = event.location?.venueName || event.venue || event.city || 'Exhibition Center';
    const fullLocation = [venue, event.city, event.country || 'India'].filter(Boolean).join(', ');

    const eventUrl = `https://visitexpo.in/expo/${event.slug || event._id || ''}`;
    const details = [
      `Exhibition: ${title}`,
      `Organizer: ${event.organizer || 'VisitExpo Network'}`,
      `Official Event Page: ${eventUrl}`,
      '',
      event.description ? event.description.substring(0, 400) + '...' : '',
      '',
      '★ Reminder: Present your VisitExpo digital pass at the entrance registration kiosk for fast-track badge printing.'
    ].filter(Boolean).join('\n');

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: `${startStr}/${endStr}`,
      details: details,
      location: fullLocation,
      trp: 'true'
    });

    if (options.userEmail) {
      params.append('add', options.userEmail);
    }

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  /**
   * Construct 1-click Outlook / Office 365 web creation URL
   */
  static buildOutlookCalendarUrl(event, options = {}) {
    const { start, end } = this.getEventDates(event);
    const title = event.title || 'VisitExpo Exhibition';
    const venue = event.location?.venueName || event.venue || event.city || 'Exhibition Center';
    const fullLocation = [venue, event.city, event.country || 'India'].filter(Boolean).join(', ');
    const eventUrl = `https://visitexpo.in/expo/${event.slug || event._id || ''}`;

    const body = `${title}\nLocation: ${fullLocation}\nOfficial Expo Page: ${eventUrl}\n\nFast-track pass included with VisitExpo pre-registration.`;

    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: title,
      startdt: start.toISOString(),
      enddt: end.toISOString(),
      body: body,
      location: fullLocation
    });

    return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
  }

  /**
   * Generate RFC 5545 compliant .ics calendar content with VALARM reminders
   */
  static generateIcsContent(event, options = {}) {
    const { start, end } = this.getEventDates(event);
    const startUtc = this.formatDateToIcsUtc(start);
    const endUtc = this.formatDateToIcsUtc(end);
    const stampUtc = this.formatDateToIcsUtc(new Date());

    const title = (event.title || 'VisitExpo Exhibition').replace(/[\r\n]+/g, ' ');
    const venue = (event.location?.venueName || event.venue || event.city || 'Exhibition Center').replace(/[\r\n]+/g, ' ');
    const fullLocation = [venue, event.city, event.country || 'India'].filter(Boolean).join(', ');
    const eventUrl = `https://visitexpo.in/expo/${event.slug || event._id || ''}`;
    const cleanDesc = (event.description || 'Verified Trade Exhibition on VisitExpo')
      .replace(/[\r\n]+/g, '\\n')
      .substring(0, 600);

    const uid = `visitexpo-${event._id || event.slug || Date.now()}@visitexpo.in`;

    const reminderTimes = options.reminderTimes || ['24h', '1h', '15m'];

    // Generate VALARM blocks for alarms
    let alarms = '';
    if (reminderTimes.includes('7d')) {
      alarms += `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder: ${title} starts in 7 days\r\nTRIGGER:-P7D\r\nEND:VALARM\r\n`;
    }
    if (reminderTimes.includes('24h') || reminderTimes.includes('1d')) {
      alarms += `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder: ${title} starts tomorrow\r\nTRIGGER:-P1D\r\nEND:VALARM\r\n`;
    }
    if (reminderTimes.includes('2h')) {
      alarms += `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder: ${title} starts in 2 hours\r\nTRIGGER:-PT2H\r\nEND:VALARM\r\n`;
    }
    if (reminderTimes.includes('1h')) {
      alarms += `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder: ${title} starts in 1 hour\r\nTRIGGER:-PT1H\r\nEND:VALARM\r\n`;
    }
    if (reminderTimes.includes('15m')) {
      alarms += `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder: ${title} starts in 15 minutes\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\n`;
    }

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//VisitExpo Platform//Calendar Sync Service//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:VisitExpo Events',
      'X-WR-TIMEZONE:UTC',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stampUtc}`,
      `DTSTART:${startUtc}`,
      `DTEND:${endUtc}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${cleanDesc}\\n\\nEvent Details: ${eventUrl}`,
      `LOCATION:${fullLocation}`,
      `URL:${eventUrl}`,
      'STATUS:CONFIRMED',
      alarms ? alarms.trim() : 'BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Event Reminder\r\nTRIGGER:-PT1H\r\nEND:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');
  }

  /**
   * Execute or record a calendar sync request
   */
  static async syncEvent({ eventId, eventSlug, provider = 'google', userEmail, userName, reminderTimes, timezone, eventData }) {
    let event = null;
    if (eventId && typeof eventId === 'string' && eventId.match(/^[0-9a-fA-F]{24}$/)) {
      try {
        event = await Event.findById(eventId);
      } catch (err) {}
    }
    if (!event && eventSlug) {
      try {
        event = await Event.findOne({ slug: eventSlug });
      } catch (err) {}
    }

    if (!event && eventData) {
      event = eventData;
    }

    if (!event) {
      if (eventSlug || userName) {
        event = {
          _id: eventId || 'visitexpo-event',
          title: eventSlug ? eventSlug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) : 'VisitExpo Exhibition',
          slug: eventSlug,
          city: 'India',
          venue: 'Exhibition Centre'
        };
      } else {
        throw new Error('Event not found. Unable to sync calendar.');
      }
    }

    const effectiveReminders = reminderTimes && reminderTimes.length > 0
      ? reminderTimes
      : ['24h', '1h', '15m'];

    const googleUrl = this.buildGoogleCalendarUrl(event, { userEmail });
    const outlookUrl = this.buildOutlookCalendarUrl(event, { userEmail });
    const icsUrl = `/api/calendar/events/${event.slug || event._id}/ics`;

    // If visitor record exists, mark as synced or register for reminders
    if (userEmail && event._id && String(event._id).match(/^[0-9a-fA-F]{24}$/)) {
      try {
        const cleanEmail = userEmail.toLowerCase().trim();
        const existingVis = await Visitor.findOne({ event: event._id, email: cleanEmail });
        if (existingVis) {
          existingVis.calendarSynced = true;
          existingVis.calendarProvider = provider;
          existingVis.calendarSyncedAt = new Date();
          existingVis.viewerTimezone = timezone || 'Asia/Kolkata';
          await existingVis.save();
        } else {
          await Visitor.create({
            event: event._id,
            email: cleanEmail,
            name: userName || cleanEmail.split('@')[0],
            phone: 'Not provided',
            registrationStatus: 'confirmed',
            calendarSynced: true,
            calendarProvider: provider,
            calendarSyncedAt: new Date(),
            viewerTimezone: timezone || 'Asia/Kolkata'
          });
        }
      } catch (err) {
        // Non-critical visitor update failure
      }
    }

    // If user exists, create an in-app reminder notification
    if (userEmail) {
      try {
        const userDoc = await User.findOne({ email: userEmail.toLowerCase().trim() });
        if (userDoc) {
          await Notification.create({
            user: userDoc._id,
            title: `Calendar Reminder Set: ${event.title}`,
            message: `You've set a ${provider === 'google' ? 'Google Calendar' : provider === 'outlook' ? 'Outlook' : 'calendar'} reminder for ${event.title}. We'll notify you before the event starts.`,
            type: 'in_app',
            metadata: { eventId: event._id, slug: event.slug, provider, reminderTimes: effectiveReminders }
          });
        }
      } catch (err) {}
    }

    let targetDirectUrl = googleUrl;
    if (provider === 'outlook') targetDirectUrl = outlookUrl;
    if (provider === 'ics' || provider === 'apple') targetDirectUrl = icsUrl;

    return {
      success: true,
      message: `Event successfully added to your ${provider === 'google' ? 'Google' : provider === 'outlook' ? 'Outlook' : 'Apple / iCal'} Calendar!`,
      provider,
      targetDirectUrl,
      syncUrls: {
        google: googleUrl,
        outlook: outlookUrl,
        ics: icsUrl
      },
      event: {
        id: event._id,
        title: event.title,
        slug: event.slug,
        venue: event.location?.venueName || event.venue || event.city,
        city: event.city,
        startDate: event.startDate,
        endDate: event.endDate
      },
      reminders: effectiveReminders
    };
  }

  /**
   * Background dispatcher: Dispatches reminders for upcoming events
   */
  static async sendUpcomingEventReminders() {
    const now = new Date();
    const dispatched = [];

    // Reminder thresholds:
    // 1. 24h window (events starting between 23h and 25h from now)
    const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    // 2. 1h window (events starting between 45m and 75m from now)
    const in45m = new Date(now.getTime() + 45 * 60 * 1000);
    const in75m = new Date(now.getTime() + 75 * 60 * 1000);

    try {
      // Find 24h upcoming events
      const events24h = await Event.find({
        startDate: { $gte: in23h, $lte: in25h }
      }).select('_id title slug venue city startDate');

      for (const evt of events24h) {
        const visitors = await Visitor.find({
          event: evt._id,
          'remindersDispatched.timeframe': { $ne: '24h' }
        });

        for (const vis of visitors) {
          // Push in-app notification if user account matches
          const userDoc = await User.findOne({ email: vis.email });
          if (userDoc) {
            await Notification.create({
              user: userDoc._id,
              title: `Upcoming Expo: ${evt.title} starts tomorrow!`,
              message: `Don't miss ${evt.title} taking place in ${evt.city || 'your venue'}. Remember to download your digital QR pass.`,
              type: 'in_app',
              metadata: { eventId: evt._id, slug: evt.slug, timeframe: '24h' }
            });
          }

          vis.remindersDispatched.push({
            timeframe: '24h',
            dispatchedAt: new Date(),
            channel: 'in_app'
          });
          await vis.save();
          dispatched.push({ email: vis.email, event: evt.title, timeframe: '24h' });
        }
      }

      // Find 1h upcoming events
      const events1h = await Event.find({
        startDate: { $gte: in45m, $lte: in75m }
      }).select('_id title slug venue city startDate');

      for (const evt of events1h) {
        const visitors = await Visitor.find({
          event: evt._id,
          'remindersDispatched.timeframe': { $ne: '1h' }
        });

        for (const vis of visitors) {
          const userDoc = await User.findOne({ email: vis.email });
          if (userDoc) {
            await Notification.create({
              user: userDoc._id,
              title: `Starting Soon: ${evt.title} begins in 1 hour!`,
              message: `Doors open shortly for ${evt.title}. Scan your pass at the entry gate.`,
              type: 'in_app',
              metadata: { eventId: evt._id, slug: evt.slug, timeframe: '1h' }
            });
          }

          vis.remindersDispatched.push({
            timeframe: '1h',
            dispatchedAt: new Date(),
            channel: 'in_app'
          });
          await vis.save();
          dispatched.push({ email: vis.email, event: evt.title, timeframe: '1h' });
        }
      }

      if (dispatched.length > 0) {
        console.log(`[CalendarService] Dispatched ${dispatched.length} upcoming event reminders.`);
      }

      return { success: true, count: dispatched.length, dispatched };
    } catch (err) {
      console.error('[CalendarService] Error dispatching reminders:', err);
      return { success: false, error: err.message };
    }
  }
}

export default CalendarService;
