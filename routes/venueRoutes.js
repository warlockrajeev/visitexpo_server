/**
 * @file venueRoutes.js
 * @description API endpoints for Convention & Exhibition Venue Profiles and image management.
 */

import express from 'express';
import {
  getAllVenues,
  getVenueBySlug,
  createVenue,
  updateVenue,
  addVenueImages,
  removeVenueImage
} from '../controllers/venueController.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// Public routes (used by client-dashboard and client-admin preview)
router.get('/', getAllVenues);
router.get('/:slug', getVenueBySlug);

// Protected routes (admin/superadmin management)
router.post('/', protect, authorize('superadmin', 'admin'), createVenue);
router.put('/:slug', protect, authorize('superadmin', 'admin'), updateVenue);
router.post('/:slug/images', protect, authorize('superadmin', 'admin'), addVenueImages);
router.delete('/:slug/images', protect, authorize('superadmin', 'admin'), removeVenueImage);

export default router;
