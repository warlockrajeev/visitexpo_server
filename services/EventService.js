/**
 * @file EventService.js
 * @description Event business logic handling creation, modifications, category distinct lists, and searches.
 */

import EventRepository from '../repositories/EventRepository.js';
import { fetchLiveWpDirectoryEvents, normalizeTitle } from '../utils/directoryEventsHelper.js';

class EventService {
  async createEvent(eventData, organizerId) {
    const trimmedTitle = eventData.title?.trim();
    if (!trimmedTitle) {
      const err = new Error('Event title is required');
      err.statusCode = 400;
      throw err;
    }

    // Strict duplicate check: An event with the same title cannot be created
    const escapedTitle = trimmedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingTitleEvent = await EventRepository.findOne({
      title: { $regex: new RegExp(`^${escapedTitle}$`, 'i') }
    });

    if (existingTitleEvent) {
      const err = new Error(`An event titled "${existingTitleEvent.title}" already exists. Duplicate events cannot be created.`);
      err.statusCode = 409;
      err.existingEvent = {
        _id: existingTitleEvent._id,
        title: existingTitleEvent.title,
        slug: existingTitleEvent.slug,
        city: existingTitleEvent.city,
        venue: existingTitleEvent.venue,
        startDate: existingTitleEvent.startDate,
        endDate: existingTitleEvent.endDate,
        status: existingTitleEvent.status,
        banner: existingTitleEvent.banner,
        orgName: existingTitleEvent.orgName || existingTitleEvent.organizer?.name
      };
      throw err;
    }

    // Also check live WordPress directory events (e.g. Impressions Expo and others)
    try {
      const wpDocs = await fetchLiveWpDirectoryEvents();
      if (Array.isArray(wpDocs)) {
        const norm = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
        const queryNorm = norm(trimmedTitle);
        const wpExact = wpDocs.find(d => norm(d.title) === queryNorm || d.slug === trimmedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        if (wpExact) {
          const err = new Error(`An event titled "${wpExact.title}" already exists in VisitExpo. Duplicate events cannot be created.`);
          err.statusCode = 409;
          err.existingEvent = {
            _id: String(wpExact.id || wpExact._id),
            title: wpExact.title,
            slug: wpExact.slug,
            city: wpExact.city,
            venue: wpExact.venue,
            startDate: wpExact.startDate,
            endDate: wpExact.endDate,
            status: 'published',
            isClaimed: false
          };
          throw err;
        }
      }
    } catch (e) {
      if (e.statusCode === 409) throw e;
    }

    // Generate unique slug if not present
    let slug = eventData.slug || this._slugify(trimmedTitle);
    
    // Check if slug is unique
    let existing = await EventRepository.findOne({ slug });
    let counter = 1;
    while (existing) {
      slug = `${this._slugify(trimmedTitle)}-${counter}`;
      existing = await EventRepository.findOne({ slug });
      counter++;
    }

    const payload = {
      ...eventData,
      title: trimmedTitle,
      slug,
      organizer: organizerId
    };

    return await EventRepository.create(payload);
  }

  async updateEvent(eventId, eventData, organizerId) {
    // Verify event ownership
    const event = await EventRepository.findById(eventId);
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    if (event.organizer && organizerId && event.organizer.toString() !== organizerId.toString()) {
      const err = new Error('Unauthorized to modify this event');
      err.statusCode = 403;
      throw err;
    }

    // Duplicate title check if title is changing
    if (eventData.title && eventData.title.trim().toLowerCase() !== event.title.toLowerCase()) {
      const trimmedTitle = eventData.title.trim();
      const escapedTitle = trimmedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const duplicateEvent = await EventRepository.findOne({
        _id: { $ne: eventId },
        title: { $regex: new RegExp(`^${escapedTitle}$`, 'i') }
      });
      if (duplicateEvent) {
        const err = new Error(`An event titled "${duplicateEvent.title}" already exists. Duplicate events cannot be created.`);
        err.statusCode = 409;
        err.existingEvent = {
          _id: duplicateEvent._id,
          title: duplicateEvent.title,
          slug: duplicateEvent.slug,
          city: duplicateEvent.city,
          venue: duplicateEvent.venue
        };
        throw err;
      }
    }

    // Slug checks if title changes and user didn't supply custom slug
    if (eventData.title && eventData.title !== event.title && !eventData.slug) {
      let slug = this._slugify(eventData.title);
      let existing = await EventRepository.findOne({ slug, _id: { $ne: eventId } });
      let counter = 1;
      while (existing) {
        slug = `${this._slugify(eventData.title)}-${counter}`;
        existing = await EventRepository.findOne({ slug, _id: { $ne: eventId } });
        counter++;
      }
      eventData.slug = slug;
    }

    return await EventRepository.update(eventId, eventData);
  }

  async deleteEvent(eventId, organizerId) {
    const event = await EventRepository.findById(eventId);
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }

    if (event.organizer.toString() !== organizerId.toString()) {
      const err = new Error('Unauthorized to delete this event');
      err.statusCode = 403;
      throw err;
    }

    await EventRepository.delete(eventId);
    return true;
  }

  async getEventBySlug(slug) {
    const event = await EventRepository.findBySlug(slug);
    if (!event) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }
    return event;
  }

  async queryEvents(filters = {}, options = {}) {
    return await EventRepository.searchAndPaginate(filters, options);
  }

  async getUpcomingEvents(limit) {
    return await EventRepository.findUpcoming(limit);
  }

  async getFeaturedEvents(limit) {
    return await EventRepository.findFeatured(limit);
  }

  async getCategories() {
    return await EventRepository.getCategories();
  }

  async getCities() {
    return await EventRepository.getCities();
  }

  async getOrganizers() {
    return await EventRepository.getOrganizers();
  }

  _slugify(text) {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')       // Replace spaces with -
      .replace(/[^\w\-]+/g, '')   // Remove all non-word chars
      .replace(/\-\-+/g, '-');    // Replace multiple - with single -
  }
}

export default new EventService();
