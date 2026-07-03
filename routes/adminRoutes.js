/**
 * @file adminRoutes.js
 * @description Super Admin management metrics, platform health and operational CRUD dashboards.
 */

import express from 'express';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Event from '../models/Event.js';
import Order from '../models/Order.js';
import Subscription from '../models/Subscription.js';
import Invoice from '../models/Invoice.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// Wrap all admin routes in protect and super_admin authorize
router.use(protect);
router.use(authorize('super_admin'));

// @desc    Get admin dashboard summary KPIs
// @route   GET /api/admin/dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const [
      totalUsers,
      totalOrganizations,
      totalEvents,
      activeSubscriptions,
      completedOrders
    ] = await Promise.all([
      User.countDocuments(),
      Organization.countDocuments(),
      Event.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      Order.find({ status: 'completed' })
    ]);

    // Sum revenue
    const totalRevenue = completedOrders.reduce((sum, order) => sum + order.totalAmount, 0);

    // Get active subscription packages breakdown
    const subscriptions = await Subscription.find({ status: 'active' });
    const packagesCount = {
      free: 0,
      growth: 0,
      enterprise: 0
    };

    subscriptions.forEach((sub) => {
      if (packagesCount[sub.plan] !== undefined) {
        packagesCount[sub.plan]++;
      }
    });

    res.status(200).json({
      success: true,
      analytics: {
        kpis: {
          totalUsers,
          totalOrganizations,
          totalEvents,
          activeSubscriptions,
          totalRevenue
        },
        packagesBreakdown: packagesCount
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get all users (paginated + search)
// @route   GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const { search, role, page, limit } = req.query;
    const query = {};

    if (role && role !== 'all') {
      query.role = role;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const pgNum = parseInt(page, 10) || 1;
    const pgLimit = parseInt(limit, 10) || 10;
    const skip = (pgNum - 1) * pgLimit;

    const [docs, total] = await Promise.all([
      User.find(query)
        .populate('organization', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pgLimit),
      User.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        docs,
        total,
        page: pgNum,
        pages: Math.ceil(total / pgLimit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update user details or role / status
// @route   PUT /api/admin/users/:id
router.put('/users/:id', async (req, res, next) => {
  try {
    const { name, email, role, isVerified } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (name) user.name = name;
    if (email) user.email = email.toLowerCase();
    if (role) user.role = role;
    if (isVerified !== undefined) user.isVerified = isVerified;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get all organizations / tenants
// @route   GET /api/admin/organizations
router.get('/organizations', async (req, res, next) => {
  try {
    const { search, page, limit } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { 'contact.email': { $regex: search, $options: 'i' } }
      ];
    }

    const pgNum = parseInt(page, 10) || 1;
    const pgLimit = parseInt(limit, 10) || 10;
    const skip = (pgNum - 1) * pgLimit;

    const [docs, total] = await Promise.all([
      Organization.find(query)
        .populate('teamMembers.user', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pgLimit),
      Organization.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        docs,
        total,
        page: pgNum,
        pages: Math.ceil(total / pgLimit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update organization settings or status
// @route   PUT /api/admin/organizations/:id
router.put('/organizations/:id', async (req, res, next) => {
  try {
    const { name, email, phone, address, plan } = req.body;
    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return res.status(404).json({ success: false, error: 'Organization not found' });
    }

    if (name) organization.name = name;
    if (email) organization.contact.email = email;
    if (phone) organization.contact.phone = phone;
    if (address) organization.contact.address = address;
    if (plan) organization.subscription.plan = plan;

    await organization.save();

    res.status(200).json({
      success: true,
      message: 'Organization details updated successfully',
      organization
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get subscriptions records
// @route   GET /api/admin/subscriptions
router.get('/subscriptions', async (req, res, next) => {
  try {
    const subs = await Subscription.find()
      .populate('organization', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: subs
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get global billing invoices / transaction log
// @route   GET /api/admin/invoices
router.get('/invoices', async (req, res, next) => {
  try {
    const invoices = await Invoice.find()
      .populate('organization', 'name')
      .sort({ createdAt: -1 });

    // Fallback to Order collection if Invoice collection is empty
    if (invoices.length === 0) {
      const orders = await Order.find()
        .populate('organizer', 'name')
        .sort({ createdAt: -1 });
      
      const parsedInvoices = orders.map(ord => ({
        _id: ord._id,
        invoiceNumber: `INV-${ord.orderNumber.split('-')[1] || 'MOCK'}`,
        organization: ord.organizer,
        amount: ord.totalAmount,
        currency: 'INR',
        status: ord.status === 'completed' ? 'paid' : 'unpaid',
        createdAt: ord.createdAt
      }));

      return res.status(200).json({
        success: true,
        data: parsedInvoices
      });
    }

    res.status(200).json({
      success: true,
      data: invoices
    });
  } catch (error) {
    next(error);
  }
});

export default router;
