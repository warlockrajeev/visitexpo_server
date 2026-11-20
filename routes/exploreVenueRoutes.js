import express from 'express';
import ExploreVenue from '../models/ExploreVenue.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

const BASELINE_VENUES = [
  {
    name: 'Bharat Mandapam Exhibition Complex',
    slug: 'bharat-mandapam',
    city: 'New Delhi',
    state: 'Delhi',
    country: 'India',
    totalEvents: 342,
    upcomingEvents: 88,
    searchTerm: 'Pragati Maidan',
    displayOrder: 1
  },
  {
    name: 'Yashobhoomi Convention Centre',
    slug: 'yashobhoomi',
    city: 'New Delhi',
    state: 'Delhi',
    country: 'India',
    totalEvents: 229,
    upcomingEvents: 57,
    searchTerm: 'Yashobhoomi',
    displayOrder: 2
  },
  {
    name: 'Jio World Convention Centre',
    slug: 'jio-world',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    totalEvents: 285,
    upcomingEvents: 64,
    searchTerm: 'Jio World',
    displayOrder: 3
  },
  {
    name: 'Bombay Exhibition Centre (NESCO)',
    slug: 'bec-mumbai',
    city: 'Mumbai',
    state: 'Maharashtra',
    country: 'India',
    totalEvents: 651,
    upcomingEvents: 105,
    searchTerm: 'Bombay Exhibition Centre',
    displayOrder: 4
  },
  {
    name: 'Bangalore International Exhibition Centre (BIEC)',
    slug: 'biec-bengaluru',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    totalEvents: 312,
    upcomingEvents: 52,
    searchTerm: 'BIEC',
    displayOrder: 5
  },
  {
    name: 'India Expo Centre & Mart',
    slug: 'india-expo-centre',
    city: 'Greater Noida',
    state: 'Uttar Pradesh',
    country: 'India',
    totalEvents: 390,
    upcomingEvents: 76,
    searchTerm: 'India Expo Centre',
    displayOrder: 6
  }
];

const ensureSeedData = async () => {
  if ((await ExploreVenue.countDocuments()) === 0) {
    await ExploreVenue.insertMany(BASELINE_VENUES);
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
    await ensureSeedData();
    const data = await ExploreVenue.find({ isActive: true })
      .sort({ displayOrder: 1, createdAt: 1 })
      .lean();

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get('/admin/all', protect, authorize('super_admin', 'admin', 'sub_admin'), async (req, res, next) => {
  try {
    await ensureSeedData();
    const data = await ExploreVenue.find()
      .sort({ displayOrder: 1, createdAt: 1 })
      .lean();

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

export default router;
