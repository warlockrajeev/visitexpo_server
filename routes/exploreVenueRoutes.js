import express from 'express';
import ExploreVenue from '../models/ExploreVenue.js';
import Event from '../models/Event.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

const enrichExploreVenuesWithLiveCounts = async (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  try {
    const now = new Date();
    const countsAgg = await Event.aggregate([
      { $match: { venue: { $exists: true, $ne: '' } } },
      {
        $group: {
          _id: { $toLower: { $trim: { input: '$venue' } } },
          total: { $sum: 1 },
          upcoming: {
            $sum: {
              $cond: [
                { $or: [{ $gte: ['$endDate', now] }, { $gte: ['$startDate', now] }] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    return items.map((item) => {
      const nameKey = String(item.name || '').toLowerCase().trim();
      const searchKey = String(item.searchTerm || '').toLowerCase().trim();
      const slugWords = String(item.slug || '').toLowerCase().replace(/-/g, ' ').trim();

      let liveTotal = 0;
      let liveUpcoming = 0;

      for (const row of countsAgg) {
        const vKey = row._id || '';
        if (!vKey) continue;
        if (
          vKey === nameKey ||
          (nameKey.length > 4 && vKey.includes(nameKey)) ||
          (searchKey.length > 3 && vKey.includes(searchKey)) ||
          (slugWords.length > 4 && vKey.includes(slugWords))
        ) {
          liveTotal += row.total;
          liveUpcoming += row.upcoming;
        }
      }

      return {
        ...item,
        totalEvents: liveTotal,
        upcomingEvents: liveUpcoming
      };
    });
  } catch {
    return items;
  }
};

const normalizePayload = (body) => ({
  name: String(body.name || '').trim(),
  slug: String(body.slug || body.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, ''),
  city: String(body.city || '').trim(),
  state: String(body.state || '').trim(),
  country: String(body.country || '').trim() || 'India',
  totalEvents: Number(body.totalEvents) || 0,
  upcomingEvents: Number(body.upcomingEvents) || 0,
  searchTerm: String(body.searchTerm || '').trim(),
  imageUrl: String(body.imageUrl || '').trim(),
  displayOrder: Number(body.displayOrder) || 0,
  isActive: body.isActive !== undefined ? Boolean(body.isActive) : true
});

router.get('/', async (req, res, next) => {
  try {
    const rawData = await ExploreVenue.find({ isActive: true })
      .sort({ displayOrder: 1, createdAt: 1 })
      .lean();
    const data = await enrichExploreVenuesWithLiveCounts(rawData);

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get('/admin/all', protect, authorize('super_admin', 'admin', 'sub_admin'), async (req, res, next) => {
  try {
    const rawData = await ExploreVenue.find()
      .sort({ displayOrder: 1, createdAt: 1 })
      .lean();
    const data = await enrichExploreVenuesWithLiveCounts(rawData);

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.post('/admin', protect, authorize('super_admin', 'admin', 'sub_admin'), async (req, res, next) => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.name || !payload.city || !payload.slug) {
      return res.status(400).json({
        success: false,
        error: 'Venue name, city, and a valid page URL are required.'
      });
    }

    const venue = await ExploreVenue.create(payload);
    res.status(201).json({ success: true, data: venue });
  } catch (error) {
    next(error);
  }
});

router.put('/admin/:id', protect, authorize('super_admin', 'admin', 'sub_admin'), async (req, res, next) => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.name || !payload.city || !payload.slug) {
      return res.status(400).json({
        success: false,
        error: 'Venue name, city, and a valid page URL are required.'
      });
    }

    const venue = await ExploreVenue.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true
    });
    if (!venue) {
      return res.status(404).json({ success: false, error: 'Explore venue not found.' });
    }

    res.status(200).json({ success: true, data: venue });
  } catch (error) {
    next(error);
  }
});

router.delete('/admin/:id', protect, authorize('super_admin', 'admin', 'sub_admin'), async (req, res, next) => {
  try {
    const deleted = await ExploreVenue.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Explore venue not found.' });
    }
    res.status(200).json({ success: true, message: 'Venue removed from Explore Venues.' });
  } catch (error) {
    next(error);
  }
});

export default router;
