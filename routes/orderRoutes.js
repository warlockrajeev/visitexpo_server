/**
 * @file orderRoutes.js
 * @description Transactions, checkout simulation, and order logs.
 */

import express from 'express';
import Ticket from '../models/Ticket.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Event from '../models/Event.js';
import Visitor from '../models/Visitor.js';
import Lead from '../models/Lead.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// ==========================================
// PUBLIC BUYER TICKET PURCHASE CHECKOUT API
// ==========================================
router.post('/checkout', async (req, res, next) => {
  try {
    const { eventId, ticketId, quantity, buyer, attendanceType } = req.body;

    if (!eventId || !ticketId || !quantity || !buyer || !buyer.name || !buyer.email) {
      return res.status(400).json({
        success: false,
        error: 'Event ID, Ticket ID, Quantity, and Buyer Details (name, email) are required'
      });
    }

    // 1. Verify Event and Ticket Tier exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, error: 'Target event not found' });
    }

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket tier not found' });
    }

    // Check capacity if limited
    if (ticket.capacity !== -1 && ticket.soldCount + quantity > ticket.capacity) {
      return res.status(400).json({ success: false, error: 'Selected ticket tier has insufficient capacity remaining' });
    }

    // 2. Ensure Visitor is registered for this event
    let visitor = await Visitor.findOne({ event: eventId, email: buyer.email.toLowerCase() });
    if (!visitor) {
      const mockQRCode = `visitexpo-${eventId}-${buyer.email.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      visitor = await Visitor.create({
        name: buyer.name,
        email: buyer.email.toLowerCase(),
        phone: buyer.phone || '9999900000',
        company: buyer.company || 'Individual',
        designation: buyer.designation || 'Visitor',
        country: buyer.country || 'India',
        qrCode: mockQRCode,
        attendanceType: attendanceType || (ticket.type === 'vip' || ticket.price > 0 ? 'in_person' : 'virtual'),
        event: eventId
      });

      // Auto create a Lead
      await Lead.create({
        name: buyer.name,
        email: buyer.email.toLowerCase(),
        phone: buyer.phone || '9999900000',
        company: buyer.company || 'Individual',
        designation: buyer.designation || 'Visitor',
        country: buyer.country || 'India',
        leadScore: ticket.type === 'vip' ? 70 : 40,
        source: 'website',
        status: 'new',
        event: eventId,
        notes: `Registered via ticket checkout (${ticket.title} tier).`,
        activityTimeline: [
          {
            type: 'note',
            content: `Lead captured via ticket order. Purchased tier: ${ticket.title}`
          }
        ]
      });
    }

    // 3. Create Order
    const totalAmount = ticket.price * quantity;
    const orderNumber = `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const order = await Order.create({
      orderNumber,
      event: eventId,
      organizer: event.organizer,
      buyer: {
        name: buyer.name,
        email: buyer.email.toLowerCase(),
        phone: buyer.phone
      },
      items: [
        {
          ticket: ticketId,
          title: ticket.title,
          price: ticket.price,
          quantity
        }
      ],
      totalAmount,
      status: totalAmount > 0 ? 'pending' : 'completed', // Free tickets are completed immediately
      paymentMethod: totalAmount > 0 ? 'credit_card' : 'free_pass',
      paymentId: totalAmount > 0 ? '' : 'FREE_PASS'
    });

    // 4. Simulate Payment Processing (Auto success for demonstration)
    if (totalAmount > 0) {
      const paymentId = `pay_${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
      
      // Update Order Status
      order.status = 'completed';
      order.paymentId = paymentId;
      await order.save();

      // Create Payment Log
      await Payment.create({
        order: order._id,
        transactionId: paymentId,
        amount: totalAmount,
        currency: ticket.currency || 'INR',
        gateway: 'stripe',
        status: 'successful'
      });
    }

    // 5. Update Ticket Sales Metrics
    ticket.soldCount += quantity;
    if (ticket.capacity !== -1 && ticket.soldCount >= ticket.capacity) {
      ticket.status = 'sold_out';
    }
    await ticket.save();

    res.status(201).json({
      success: true,
      message: 'Checkout completed successfully',
      orderNumber: order.orderNumber,
      totalPaid: totalAmount,
      status: order.status,
      visitorDetails: {
        name: visitor.name,
        qrCode: visitor.qrCode,
        attendanceType: visitor.attendanceType
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// PRIVATE ORGANIZER MANAGEMENT APIS
// ==========================================
router.use(protect);
router.use(authorize('super_admin', 'organizer', 'event_manager', 'sales_team'));

// @desc    Get all orders for a specific event
// @route   GET /api/orders
router.get('/', async (req, res, next) => {
  try {
    const { eventId, page, limit } = req.query;

    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Event ID parameter is required' });
    }

    const query = { event: eventId };

    const pgNum = parseInt(page, 10) || 1;
    const pgLimit = parseInt(limit, 10) || 20;
    const skip = (pgNum - 1) * pgLimit;

    const [docs, total] = await Promise.all([
      Order.find(query)
        .populate('items.ticket', 'title type')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pgLimit),
      Order.countDocuments(query)
    ]);

    // Sum revenue for KPIs
    const completedOrders = await Order.find({ event: eventId, status: 'completed' });
    const totalRevenue = completedOrders.reduce((sum, ord) => sum + ord.totalAmount, 0);

    res.status(200).json({
      success: true,
      data: {
        docs,
        total,
        totalRevenue,
        page: pgNum,
        pages: Math.ceil(total / pgLimit)
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
