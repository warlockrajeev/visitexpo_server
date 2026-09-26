/**
 * @file categoryRoutes.js
 * @description API routes for managing event categories, including custom user categories and admin deletion.
 */

import express from 'express';
import Category from '../models/Category.js';
import Event from '../models/Event.js';

const router = express.Router();

export const DEFAULT_PRESET_CATEGORIES = [
  {
    name: 'Technology & AI',
    slug: 'technology-ai',
    description: 'Artificial intelligence, enterprise SaaS, cloud infrastructure, IoT, and cybersecurity conventions.',
    subSectors: ['Information Technology', 'Artificial Intelligence & ML', 'Cybersecurity & Cloud Computing', 'Robotics & Automation', 'Fintech & Digital Banking'],
    icon: 'Cpu',
    color: '#3b82f6',
    isCustom: false
  },
  {
    name: 'Industrial Manufacturing',
    slug: 'industrial-manufacturing',
    description: 'Heavy machinery, metallurgy, chemical engineering, and manufacturing process automation.',
    subSectors: ['Machinery & Heavy Equipment', 'Industrial Automation & Control', 'Metal, Steel & Metallurgy', 'Tooling, Moulding & Dies'],
    icon: 'Briefcase',
    color: '#64748b',
    isCustom: false
  },
  {
    name: 'Healthcare & Pharma',
    slug: 'healthcare-pharma',
    description: 'Medical devices, pharmaceuticals, hospital infrastructure, biotech research, and surgical symposiums.',
    subSectors: ['Pharmaceuticals & API', 'Medical Devices & Diagnostics', 'Hospital Equipment & Infrastructure', 'Biotechnology & Life Sciences'],
    icon: 'Activity',
    color: '#ef4444',
    isCustom: false
  },
  {
    name: 'Renewable Energy & ESG',
    slug: 'renewable-energy-esg',
    description: 'Solar power, wind energy, EV battery storage, environmental technology, and waste management.',
    subSectors: ['Solar Energy & Photovoltaics', 'EV & Battery Storage Technology', 'Waste Management & Recycling', 'Water & Wastewater Treatment'],
    icon: 'Sprout',
    color: '#22c55e',
    isCustom: false
  },
  {
    name: 'Agriculture & Food Tech',
    slug: 'agri-food-tech',
    description: 'Precision agriculture, farm mechanization, food processing equipment, grain & dairy tech, and culinary expos.',
    subSectors: ['Agri-Machinery & Implements', 'Agritech & Precision Farming', 'Food Processing & Packaging', 'Cold Chain & Logistics'],
    icon: 'Sprout',
    color: '#10b981',
    isCustom: false
  },
  {
    name: 'Consumer Goods & Retail',
    slug: 'consumer-goods-retail',
    description: 'FMCG, fashion apparel, home decor, gems & jewellery, and consumer product showcases.',
    subSectors: ['FMCG & Personal Care', 'Apparel, Fashion & Lifestyle', 'Home Decor, Furniture & Kitchenware', 'Gems & Jewellery'],
    icon: 'Palette',
    color: '#ec4899',
    isCustom: false
  },
  {
    name: 'Automotive & Transport',
    slug: 'automotive-transport',
    description: 'Electric mobility, auto components, commercial fleets, battery technology, and international motor shows.',
    subSectors: ['Electric Vehicles & Hybrid Systems', 'Auto Components & Spare Parts', 'Commercial Vehicles & Logistics', 'Aviation & Aerospace'],
    icon: 'Car',
    color: '#f97316',
    isCustom: false
  },
  {
    name: 'Real Estate, Building & Construction',
    slug: 'construction-infra',
    description: 'Heavy infrastructure machinery, smart urban planning, cement, concrete, and architectural expos.',
    subSectors: ['Construction Machinery & Building Materials', 'Architecture, Interiors & Design', 'HVAC & Refrigeration', 'Smart Home & Lighting Systems'],
    icon: 'HardHat',
    color: '#eab308',
    isCustom: false
  },
  {
    name: 'Services, Finance & Education',
    slug: 'services-finance-education',
    description: 'BFSI, corporate franchise opportunities, study abroad fairs, and B2B services.',
    subSectors: ['BFSI & Investment Services', 'Franchise & Business Opportunities', 'Higher Education & Study Abroad', 'Supply Chain & Warehousing'],
    icon: 'Compass',
    color: '#06b6d4',
    isCustom: false
  }
];

// Helper to slugify
function slugify(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @desc Get all categories (defaults + customs)
 * @route GET /api/categories
 */
router.get('/', async (req, res) => {
  try {
    const customCats = await Category.find().lean();
    
    // Also discover any unique categories stored directly on MongoDB events that might not be in Category model
    const distinctEventCats = await Event.distinct('category');
    const distinctEventMultiCats = await Event.distinct('categories');
    const allDiscovered = Array.from(new Set([
      ...(distinctEventCats || []).filter(Boolean),
      ...(distinctEventMultiCats || []).filter(Boolean)
    ]));

    const presetNames = new Set(DEFAULT_PRESET_CATEGORIES.map(c => c.name.toLowerCase()));
    const customNames = new Set(customCats.map(c => c.name.toLowerCase()));

    // Auto-create category records for any discovered event categories
    for (const rawName of allDiscovered) {
      const trimmed = String(rawName).trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (!presetNames.has(lower) && !customNames.has(lower)) {
        try {
          const newDoc = await Category.create({
            name: trimmed,
            slug: slugify(trimmed) || `custom-${Date.now()}`,
            isCustom: true,
            description: `User-defined category for ${trimmed} trade shows and expos.`,
            scope: `Events and exhibitions specializing in ${trimmed}.`,
            subSectors: ['General ' + trimmed]
          });
          customCats.push(newDoc.toObject());
          customNames.add(lower);
        } catch (e) {
          // Ignore unique index collision
        }
      }
    }

    // Merge default and custom
    const result = [
      ...DEFAULT_PRESET_CATEGORIES,
      ...customCats.map(c => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        description: c.description || `Exhibitions and expos in ${c.name}.`,
        scope: c.scope || c.description || `Specialized trade fairs in ${c.name}.`,
        subSectors: c.subSectors || [],
        icon: c.icon || 'Tag',
        color: c.color || '#f59e0b',
        isCustom: true,
        createdAt: c.createdAt
      }))
    ];

    return res.json({
      success: true,
      data: {
        categories: result,
        total: result.length
      }
    });
  } catch (err) {
    console.error('[categoryRoutes] GET / error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @desc Create a new custom category
 * @route POST /api/categories
 */
router.post('/', async (req, res) => {
  try {
    const { name, subSectors, description, scope } = req.body;
    const trimmed = (name || '').trim();
    if (!trimmed) {
      return res.status(400).json({ success: false, error: 'Category name is required.' });
    }

    const slug = slugify(trimmed);
    const existing = await Category.findOne({
      $or: [{ name: { $regex: new RegExp(`^${trimmed}$`, 'i') } }, { slug }]
    });

    if (existing) {
      return res.json({
        success: true,
        message: 'Category already exists',
        data: existing
      });
    }

    const created = await Category.create({
      name: trimmed,
      slug: slug || `cat-${Date.now()}`,
      isCustom: true,
      description: description || `Exhibitions and expos specialized in ${trimmed}.`,
      scope: scope || `Trade shows, manufacturer pavilions, and buyer summits in ${trimmed}.`,
      subSectors: Array.isArray(subSectors) && subSectors.length > 0 ? subSectors : ['General ' + trimmed],
      icon: 'Tag',
      color: '#f59e0b'
    });

    return res.status(201).json({
      success: true,
      message: 'Custom category created successfully',
      data: created
    });
  } catch (err) {
    console.error('[categoryRoutes] POST / error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @desc Delete a custom category (Admin action)
 * @route DELETE /api/categories/:identifier
 */
router.delete('/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    if (!identifier) {
      return res.status(400).json({ success: false, error: 'Category identifier is required.' });
    }

    // Check if category exists by ID, slug, or name
    let category = null;
    if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
      category = await Category.findById(identifier);
    }
    if (!category) {
      category = await Category.findOne({
        $or: [
          { slug: identifier.toLowerCase() },
          { name: { $regex: new RegExp(`^${identifier}$`, 'i') } }
        ]
      });
    }

    const catName = category ? category.name : identifier;

    // Check if it's a default category that shouldn't be deleted
    const isDefault = DEFAULT_PRESET_CATEGORIES.some(
      c => c.name.toLowerCase() === catName.toLowerCase() || c.slug === identifier.toLowerCase()
    );
    if (isDefault) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete standard core category "${catName}". Only custom categories can be deleted.`
      });
    }

    if (category) {
      await Category.findByIdAndDelete(category._id);
    }

    // Reassign any MongoDB events in this deleted custom category to fallback 'Trade & Industry'
    await Event.updateMany(
      {
        $or: [
          { category: catName },
          { categories: catName }
        ]
      },
      {
        $pull: { categories: catName },
        $set: { category: 'Trade & Industry' }
      }
    );
    await Event.updateMany(
      {
        category: 'Trade & Industry',
        categories: { $nin: ['Trade & Industry'] }
      },
      {
        $push: { categories: 'Trade & Industry' }
      }
    );

    return res.json({
      success: true,
      message: `Custom category "${catName}" was deleted and its events were reassigned to Trade & Industry.`
    });
  } catch (err) {
    console.error('[categoryRoutes] DELETE error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
