/**
 * @file EventService.js
 * @description Event business logic handling creation, modifications, category distinct lists, and searches.
 */

import EventRepository from '../repositories/EventRepository.js';

class EventService {
  async createEvent(eventData, organizerId) {
    // Generate unique slug if not present
    let slug = eventData.slug || this._slugify(eventData.title);
    
    // Check if slug is unique
    let existing = await EventRepository.findOne({ slug });
    let counter = 1;
    while (existing) {
      slug = `${this._slugify(eventData.title)}-${counter}`;
      existing = await EventRepository.findOne({ slug });
      counter++;
    }

    const payload = {
      ...eventData,
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

    if (event.organizer.toString() !== organizerId.toString()) {
      const err = new Error('Unauthorized to modify this event');
      err.statusCode = 403;
      throw err;
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
