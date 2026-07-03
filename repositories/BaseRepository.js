/**
 * @file BaseRepository.js
 * @description Standard Base Repository containing reusable CRUD and query operations.
 */

export class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async create(data) {
    return await this.model.create(data);
  }

  async findById(id, populate = '') {
    return await this.model.findById(id).populate(populate);
  }

  async findOne(filter = {}, populate = '', select = '') {
    return await this.model.findOne(filter).select(select).populate(populate);
  }

  async find(filter = {}, populate = '', sort = {}, limit = 0, skip = 0) {
    let query = this.model.find(filter);
    if (populate) query = query.populate(populate);
    if (sort) query = query.sort(sort);
    if (skip) query = query.skip(skip);
    if (limit) query = query.limit(limit);
    return await query;
  }

  async update(id, data) {
    return await this.model.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true
    });
  }

  async delete(id) {
    return await this.model.findByIdAndDelete(id);
  }

  async count(filter = {}) {
    return await this.model.countDocuments(filter);
  }

  async paginate(filter = {}, options = {}) {
    const page = parseInt(options.page, 10) || 1;
    const limit = parseInt(options.limit, 10) || 10;
    const skip = (page - 1) * limit;
    const sort = options.sort || { createdAt: -1 };
    const populate = options.populate || '';

    const [docs, total] = await Promise.all([
      this.find(filter, populate, sort, limit, skip),
      this.count(filter)
    ]);

    return {
      docs,
      total,
      limit,
      page,
      pages: Math.ceil(total / limit)
    };
  }
}
