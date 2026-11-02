/**
 * @file ticketRoutes.js
 * @description Pricing tiers and ticketing options management.
 */

import express from 'express';
import Ticket from '../models/Ticket.js';
import Order from '../models/Order.js';
import Event from '../models/Event.js';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();
const ADMIN_ROLES = ['super_admin', 'admin'];

const canManageTicket = async (ticket, user) => {
  if (ADMIN_ROLES.includes(user.role)) return true;
  const event = await Event.findById(ticket.event).select('createdBy claimedBy organizer organizerEmail orgEmail');
  if (!event) return false;
  return canManageEvent(event, user);
};

const canManageEvent = (event, user) => {
  if (ADMIN_ROLES.includes(user.role)) return true;
  const userId = String(user._id || user.id);
  const organizationId = user.organization?._id || user.organization;
  const userEmail = String(user.email || '').trim().toLowerCase();
  const eventEmail = String(event.organizerEmail || event.orgEmail || '').trim().toLowerCase();
  return String(event.createdBy || '') === userId ||
    String(event.claimedBy || '') === userId ||
    (organizationId && String(event.claimedBy || '') === String(organizationId)) ||
    String(event.organizer || '') === userId ||
    (organizationId && String(event.organizer || '') === String(organizationId)) ||
    (userEmail && eventEmail && userEmail === eventEmail);
};

const normalizeTicketDetails = (details) => ({
  title: String(details.title || '').trim(),
  description: String(details.description || '').trim(),
  type: String(details.type || 'free'),
  price: details.type === 'free' ? 0 : Number(details.price),
  currency: String(details.currency || 'INR').trim().toUpperCase(),
  capacity: Number(details.capacity),
  salesStart: details.salesStart ? new Date(details.salesStart) : null,
  salesEnd: details.salesEnd ? new Date(details.salesEnd) : null,
  minQuantity: Number(details.minQuantity ?? 1),
  maxQuantity: Number(details.maxQuantity ?? 10),
  perUserLimit: Number(details.perUserLimit ?? 10),
  benefits: details.benefits === undefined
    ? []
    : Array.isArray(details.benefits)
      ? details.benefits.map(benefit => String(benefit).trim()).filter(Boolean)
      : null,
  accessDetails: String(details.accessDetails || '').trim(),
  visibility: String(details.visibility || 'public'),
  refundPolicy: String(details.refundPolicy || '').trim(),
  status: String(details.status || 'active')
});

const validateTicketDetails = (details, soldCount = 0) => {
  const {
    title: cleanTitle,
    description: cleanDescription,
    type: cleanType,
    price: numericPrice,
    currency: cleanCurrency,
    capacity: numericCapacity,
    salesStart,
    salesEnd,
    minQuantity,
    maxQuantity,
    perUserLimit,
    benefits,
    accessDetails,
    visibility,
    refundPolicy,
    status
  } = details;

  if (cleanTitle.length < 3 || cleanTitle.length > 100) {
    return 'Ticket name must be between 3 and 100 characters.';
  }
  if (cleanDescription.length > 500) return 'Ticket description cannot exceed 500 characters.';
  if (!['free', 'paid', 'vip'].includes(cleanType)) return 'Select a valid ticket type.';
  if (!Number.isFinite(numericPrice) || numericPrice < 0) return 'Enter a valid non-negative ticket price.';
  if (cleanType !== 'free' && numericPrice <= 0) return 'Paid and VIP tickets must have a price greater than 0.';
  if (!/^[A-Z]{3}$/.test(cleanCurrency)) return 'Select a valid ticket currency.';
  if (!Number.isInteger(numericCapacity) || (numericCapacity <= 0 && numericCapacity !== -1)) {
    return 'Capacity must be a whole number greater than 0, or -1 for unlimited.';
  }
  if (numericCapacity !== -1 && numericCapacity < soldCount) {
    return `Capacity cannot be lower than the ${soldCount} tickets already sold.`;
  }
  if (!Number.isInteger(minQuantity) || minQuantity < 1) return 'Minimum ticket quantity must be a whole number of at least 1.';
  if (!Number.isInteger(maxQuantity) || (maxQuantity < 1 && maxQuantity !== -1)) {
    return 'Maximum ticket quantity must be a whole number greater than 0, or -1 for unlimited.';
  }
  if (maxQuantity !== -1 && maxQuantity < minQuantity) return 'Maximum ticket quantity cannot be lower than the minimum.';
  if (numericCapacity !== -1 && minQuantity > numericCapacity) return 'Minimum ticket quantity cannot exceed ticket capacity.';
  if (!Number.isInteger(perUserLimit) || (perUserLimit < 1 && perUserLimit !== -1)) {
    return 'Per-user purchase limit must be a whole number greater than 0, or -1 for unlimited.';
  }
  if (perUserLimit !== -1 && perUserLimit < minQuantity) return 'Per-user purchase limit cannot be lower than the minimum ticket quantity.';
  if ((salesStart && Number.isNaN(salesStart.getTime())) || (salesEnd && Number.isNaN(salesEnd.getTime()))) {
    return 'Enter valid ticket sales start and end dates.';
  }
  if (salesStart && salesEnd && salesEnd <= salesStart) return 'Sales end date and time must be after the start date and time.';
  if (!benefits || benefits.length > 20 || benefits.some(benefit => benefit.length > 120)) {
    return 'Enter up to 20 ticket benefits, with each benefit no longer than 120 characters.';
  }
  if (accessDetails.length > 1000) return 'Access details cannot exceed 1000 characters.';
  if (!['public', 'private'].includes(visibility)) return 'Select public or private visibility.';
  if (refundPolicy.length > 1000) return 'Refund policy cannot exceed 1000 characters.';
  if (!['active', 'paused'].includes(status)) return 'Select active or inactive ticket status.';
  return null;
};

// @desc    Get all ticket tiers for an event (public access allowed for registration pages)
// @route   GET /api/tickets
router.get('/', async (req, res, next) => {
  try {
    const { eventId } = req.query;

    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Event ID parameter is required' });
    }

    const tickets = await Ticket.find({
      event: eventId,
      $or: [{ visibility: 'public' }, { visibility: { $exists: false } }]
    });

    res.status(200).json({
      success: true,
      data: tickets
    });
  } catch (error) {
    next(error);
  }
});

// Private organizer/admin endpoints
router.use(protect);
router.use(authorize('super_admin', 'admin', 'organizer', 'event_manager'));

router.get('/manage', async (req, res, next) => {
  try {
    const { eventId } = req.query;
    if (!eventId || !/^[a-f\d]{24}$/i.test(String(eventId))) {
      return res.status(400).json({ success: false, error: 'A valid Event ID is required.' });
    }
    const event = await Event.findById(eventId).select('createdBy claimedBy organizer organizerEmail orgEmail');
    if (!event) return res.status(404).json({ success: false, error: 'Event not found.' });
    if (!(await canManageEvent(event, req.user))) {
      return res.status(403).json({ success: false, error: 'You are not authorized to manage tickets for this event.' });
    }
    const tickets = await Ticket.find({ event: eventId });
    res.status(200).json({ success: true, data: tickets });
  } catch (error) {
    next(error);
  }
});

// @desc    Create a new ticket pricing tier
// @route   POST /api/tickets
router.post('/', async (req, res, next) => {
  try {
    const { eventId } = req.body;

    if (!eventId || req.body.capacity === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Event ID, Ticket Name, and Capacity are required'
      });
    }

    const normalized = normalizeTicketDetails(req.body);
    const validationError = validateTicketDetails(normalized);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const numPrice = normalized.price;

    // Enforce Plan Ticket Price Limits: Free plan limit is 1-10 Rs
    if (normalized.type === 'paid' || numPrice > 0) {
      const isAdmin = ['super_admin', 'admin', 'sub_admin', 'subadmin'].includes(req.user.role);
      if (!isAdmin) {
        const user = await User.findById(req.user.id);
        const orgId = req.user.organization?._id || req.user.organization || user?.organization;
        const sub = await Subscription.findOne({
          $or: [
            ...(orgId ? [{ organization: orgId }] : []),
            { user: req.user.id }
          ],
          status: 'active'
        }).sort({ createdAt: -1 });

        const rawPlan = (sub?.plan || user?.plan || 'free').toLowerCase();
        const isPlanActive = sub ? sub.status === 'active' : !!user?.isPlanActive;
        const isPaidTier = isPlanActive && ['starter', 'enterprise', 'growth'].includes(rawPlan);

        if (!isPaidTier && (numPrice < 1 || numPrice > 10)) {
          return res.status(400).json({
            success: false,
            error: 'Free plan organizers can create token tickets priced between ₹1 and ₹10 only. Upgrade to Starter or Enterprise plan to set custom ticket pricing.'
          });
        }
      }
    }

    const ticket = await Ticket.create({
      ...normalized,
      event: eventId
    });

    res.status(201).json({
      success: true,
      message: 'Ticket tier created successfully',
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update ticket tier details
// @route   PUT /api/tickets/:id
router.put('/:id', async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket tier not found' });
    }
    if (!(await canManageTicket(ticket, req.user))) {
      return res.status(403).json({ success: false, error: 'You are not authorized to manage this ticket tier.' });
    }

    const normalized = normalizeTicketDetails({
      ...ticket.toObject(),
      ...req.body,
      status: req.body.status || (ticket.status === 'paused' ? 'paused' : 'active')
    });
    const validationError = validateTicketDetails(normalized, ticket.soldCount || 0);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }
    const {
      title,
      description,
      type,
      price,
      currency,
      capacity,
      salesStart,
      salesEnd,
      minQuantity,
      maxQuantity,
      perUserLimit,
      benefits,
      accessDetails,
      visibility,
      refundPolicy,
      status
    } = normalized;

    const newType = type;
    const newPriceVal = price;

    if (newType === 'paid' || (newType !== 'free' && newPriceVal > 0)) {
      const isAdmin = ['super_admin', 'admin', 'sub_admin', 'subadmin'].includes(req.user.role);
      if (!isAdmin) {
        const user = await User.findById(req.user.id);
        const orgId = req.user.organization?._id || req.user.organization || user?.organization;
        const sub = await Subscription.findOne({
          $or: [
            ...(orgId ? [{ organization: orgId }] : []),
            { user: req.user.id }
          ],
          status: 'active'
        }).sort({ createdAt: -1 });

        const rawPlan = (sub?.plan || user?.plan || 'free').toLowerCase();
        const isPlanActive = sub ? sub.status === 'active' : !!user?.isPlanActive;
        const isPaidTier = isPlanActive && ['starter', 'enterprise', 'growth'].includes(rawPlan);

        if (!isPaidTier && (newPriceVal < 1 || newPriceVal > 10)) {
          return res.status(400).json({
            success: false,
            error: 'Free plan organizers can create token tickets priced between ₹1 and ₹10 only. Upgrade to Starter or Enterprise plan to set custom ticket pricing.'
          });
        }
      }
    }

    ticket.title = title;
    ticket.description = description;
    ticket.type = type;
    ticket.price = newPriceVal;
    ticket.currency = currency;
    ticket.capacity = capacity;
    ticket.salesStart = salesStart;
    ticket.salesEnd = salesEnd;
    ticket.minQuantity = minQuantity;
    ticket.maxQuantity = maxQuantity;
    ticket.perUserLimit = perUserLimit;
    ticket.benefits = benefits;
    ticket.accessDetails = accessDetails;
    ticket.visibility = visibility;
    ticket.refundPolicy = refundPolicy;
    ticket.status = status === 'paused'
      ? 'paused'
      : ticket.capacity !== -1 && ticket.soldCount >= ticket.capacity
        ? 'sold_out'
        : 'active';

    await ticket.save();

    res.status(200).json({
      success: true,
      message: 'Ticket tier updated successfully. Existing orders retain their original price and ticket details.',
      ticket
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete ticket tier
// @route   DELETE /api/tickets/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket tier not found' });
    }

    if (!(await canManageTicket(ticket, req.user))) {
      return res.status(403).json({ success: false, error: 'You are not authorized to manage this ticket tier.' });
    }

    const existingOrder = await Order.exists({ 'items.ticket': ticket._id });
    if (existingOrder || Number(ticket.soldCount || 0) > 0) {
      return res.status(409).json({
        success: false,
        error: 'This ticket tier has existing sales or orders and cannot be deleted. Pause it instead; existing order records will remain intact.'
      });
    }

    await Ticket.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Ticket tier deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
