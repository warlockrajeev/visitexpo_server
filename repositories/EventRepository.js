/**
 * @file EventRepository.js
 * @description Event-specific data actions, extending BaseRepository.
 */

import { BaseRepository } from './BaseRepository.js';
import Event from '../models/Event.js';

class EventRepository extends BaseRepository {
  constructor() {
    super(Event);
  }

  async findBySlug(slug) {
    return await this.model.findOne({ slug, status: 'published' }).populate('organizer', 'name logo');
  }

  async findUpcoming(limit = 5) {
    return await this.model.find({
      status: 'published',
      startDate: { $gte: new Date() }
    })
      .sort({ startDate: 1 })
      .limit(limit)
      .populate('organizer', 'name logo');
  }

  async findFeatured(limit = 5) {
    // For simplicity, we can sort by registrationSettings.maxLimit or count
    return await this.model.find({ status: 'published' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('organizer', 'name logo');
  }

  async getCategories() {
    return await this.model.distinct('categories', { status: 'published' });
  }

  async searchAndPaginate(filters = {}, options = {}) {
    const filter = { status: 'published' };

    if (filters.search) {
      filter.$or = [
        { title: { $regex: filters.search, $options: 'i' } },
        { description: { $regex: filters.search, $options: 'i' } },
        { venue: { $regex: filters.search, $options: 'i' } }
      ];
    }

    if (filters.category) {
      filter.categories = filters.category;
    }

    if (filters.city) {
      filter.city = { $regex: filters.city, $options: 'i' };
    }

    if (filters.organizerId) {
      filter.$or = [
        { organizer: filters.organizerId },
        { claimedBy: filters.organizerId }
      ];
      // Organizers should be able to view draft events too
      delete filter.status;
      if (filters.status) {
        filter.status = filters.status;
      }
    }

    return await this.paginate(filter, options);
  }
}

export default new EventRepository();
