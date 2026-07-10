/**
 * @file adminRoutes.js
 * @description Super Admin management metrics, platform health and operational CRUD dashboards.
 */

import express from 'express';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Event from '../models/Event.js';
import Exhibitor from '../models/Exhibitor.js';
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
      completedOrders,
      pendingOrganizers,
      pendingExhibitors,
      pendingClaims,
      pendingEvents
    ] = await Promise.all([
      User.countDocuments(),
      Organization.countDocuments(),
      Event.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      Order.find({ status: 'completed' }),
      User.countDocuments({ role: 'organizer', isVerified: false }),
      Exhibitor.countDocuments({ status: 'pending' }),
      Event.countDocuments({ isClaimed: true, status: 'draft' }),
      Event.countDocuments({ status: 'draft', isClaimed: { $ne: true } })
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
          totalRevenue,
          pendingOrganizers,
          pendingExhibitors,
          pendingClaims,
          pendingEvents
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

// @desc    Get pending organizer account registrations
// @route   GET /api/admin/pending-organizers
router.get('/pending-organizers', async (req, res, next) => {
  try {
    const pendingUsers = await User.find({ role: 'organizer', isVerified: false })
      .populate('organization')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: pendingUsers
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Approve or Reject Organizer registration
// @route   PUT /api/admin/organizers/:id/status
router.put('/organizers/:id/status', async (req, res, next) => {
  try {
    const { action } = req.body; // 'approve' or 'reject'
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    if (action === 'approve') {
      user.isVerified = true;
      await user.save();
    } else if (action === 'reject') {
      // Delete or mark inactive
      await User.findByIdAndDelete(req.params.id);
    }

    res.status(200).json({
      success: true,
      message: `Organizer account request set to ${action}d successfully`
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get verified/approved organizers history
// @route   GET /api/admin/organizer-history
router.get('/organizer-history', async (req, res, next) => {
  try {
    const verifiedUsers = await User.find({ role: 'organizer', isVerified: true })
      .populate('organization')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: verifiedUsers
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get pending exhibitor registrations across all events
// @route   GET /api/admin/pending-exhibitors
router.get('/pending-exhibitors', async (req, res, next) => {
  try {
    const pendingExhibitors = await Exhibitor.find({ status: 'pending' })
      .populate('event', 'title city startDate venue')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: pendingExhibitors
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Approve or Reject Exhibitor registration (Super Admin)
// @route   PUT /api/admin/exhibitors/:id/status
router.put('/exhibitors/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body; // 'approved' or 'rejected'

    if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Valid status is required' });
    }

    const exhibitor = await Exhibitor.findById(req.params.id);
    if (!exhibitor) {
      return res.status(404).json({ success: false, error: 'Exhibitor request not found' });
    }

    exhibitor.status = status;
    await exhibitor.save();

    // Sync isVerified on User
    const associatedUser = await User.findOne({ email: exhibitor.contactEmail });
    if (associatedUser && associatedUser.role === 'exhibitor') {
      if (status === 'approved') {
        associatedUser.isVerified = true;
        await associatedUser.save();
      } else {
        // Only mark unverified if they have NO other approved exhibitor accounts
        const otherApproved = await Exhibitor.findOne({
          contactEmail: exhibitor.contactEmail,
          _id: { $ne: exhibitor._id },
          status: 'approved'
        });
        if (!otherApproved) {
          associatedUser.isVerified = false;
          await associatedUser.save();
        }
      }
    }

    // Sync to event if approved
    if (status === 'approved') {
      const event = await Event.findById(exhibitor.event);
      if (event) {
        const exists = event.exhibitors.some(e => e.name === exhibitor.name);
        if (!exists) {
          event.exhibitors.push({
            name: exhibitor.name,
            logo: exhibitor.logo,
            boothNumber: exhibitor.boothNumber,
            website: exhibitor.website,
            description: exhibitor.description
          });
          await event.save();
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Exhibitor onboarding request set to ${status} successfully`,
      exhibitor
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get processed exhibitors history (approved or rejected)
// @route   GET /api/admin/exhibitor-history
router.get('/exhibitor-history', async (req, res, next) => {
  try {
    const processedExhibitors = await Exhibitor.find({ status: { $in: ['approved', 'rejected'] } })
      .populate('event', 'title city startDate venue')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: processedExhibitors
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get pending event ownership claims
// @route   GET /api/admin/pending-claims
router.get('/pending-claims', async (req, res, next) => {
  try {
    const pendingClaims = await Event.find({ isClaimed: true, status: 'draft' })
      .populate('claimedBy', 'name email')
      .populate('organizer', 'name contact')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: pendingClaims
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get approved event ownership claims history
// @route   GET /api/admin/claim-history
router.get('/claim-history', async (req, res, next) => {
  try {
    const claimHistory = await Event.find({ isClaimed: true, status: 'published' })
      .populate('claimedBy', 'name email')
      .populate('organizer', 'name contact')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: claimHistory
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Approve or Reject Event Ownership Claim
// @route   PUT /api/admin/claims/:id/status
router.put('/claims/:id/status', async (req, res, next) => {
  try {
    const { action } = req.body; // 'approve' or 'reject'
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Claimed event record not found' });
    }

    if (action === 'approve') {
      event.status = 'published';
      await event.save();
      // Also verify claiming user if exists
      if (event.claimedBy) {
        await User.findByIdAndUpdate(event.claimedBy, { isVerified: true });
      }
    } else if (action === 'reject') {
      event.isClaimed = false;
      event.claimedBy = null;
      event.status = 'draft';
      await event.save();
    }

    res.status(200).json({
      success: true,
      message: `Event claim request set to ${action}d successfully`
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get pending event onboarding submissions
// @route   GET /api/admin/pending-events
router.get('/pending-events', async (req, res, next) => {
  try {
    const pendingEvents = await Event.find({ status: 'draft', isClaimed: { $ne: true } })
      .populate('organizer', 'name contact')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: pendingEvents
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get approved/moderated new events history
// @route   GET /api/admin/event-history
router.get('/event-history', async (req, res, next) => {
  try {
    const eventHistory = await Event.find({ status: { $in: ['published', 'cancelled'] }, isClaimed: { $ne: true } })
      .populate('organizer', 'name contact')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: eventHistory
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Approve or Reject Event Onboarding Submission
// @route   PUT /api/admin/events/:id/status
router.put('/events/:id/status', async (req, res, next) => {
  try {
    const { action } = req.body; // 'approve' or 'reject'
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event record not found' });
    }

    if (action === 'approve') {
      event.status = 'published';

      // Real-time Sync to WordPress Pages
      const wpUser = process.env.WORDPRESS_API_USER;
      const wpPass = process.env.WORDPRESS_API_PASSWORD;
      const wpKey = process.env.WORDPRESS_API_KEY;
      const wpUrl = process.env.WORDPRESS_URL || 'https://visitexpo.in';

      if (wpKey) {
        try {
          const wpPayload = {
            title: event.title,
            content: `<!-- wp:paragraph -->\n<p>${event.description || ''}</p>\n<!-- /wp:paragraph -->`,
            slug: event.slug,
            wpPostId: event.wpPostId || ''
          };

          const endpoint = `${wpUrl}/wp-json/visitexpo/v1/create-event`;
          console.log(`[WP-Sync] Pushing event approval to WordPress Custom Endpoint: ${endpoint}`);
          
          const wpResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-VisitExpo-Key': wpKey
            },
            body: JSON.stringify(wpPayload)
          });

          if (wpResponse.ok) {
            const wpData = await wpResponse.json();
            event.wpPostId = String(wpData.id);
            event.wpUrl = wpData.link;
            console.log(`[WP-Sync] Successfully synced page via WordPress Custom Endpoint. ID: ${wpData.id}, Link: ${wpData.link}`);
          } else {
            const errText = await wpResponse.text();
            console.error(`[WP-Sync] WordPress Custom Endpoint returned error: ${wpResponse.status} - ${errText}`);
          }
        } catch (wpErr) {
          console.error('[WP-Sync] Failed to connect to WordPress Custom REST API:', wpErr);
        }
      } else if (wpUser && wpPass) {
        try {
          const authBuffer = Buffer.from(`${wpUser}:${wpPass}`).toString('base64');
          
          const wpPayload = {
            title: event.title,
            content: `<!-- wp:paragraph -->\n<p>${event.description || ''}</p>\n<!-- /wp:paragraph -->`,
            status: 'publish',
            slug: event.slug
          };

          const endpoint = event.wpPostId 
            ? `${wpUrl}/wp-json/wp/v2/pages/${event.wpPostId}`
            : `${wpUrl}/wp-json/wp/v2/pages`;

          console.log(`[WP-Sync] Pushing event approval to WordPress standard API. Endpoint: ${endpoint}`);
          const wpResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Basic ${authBuffer}`
            },
            body: JSON.stringify(wpPayload)
          });

          if (wpResponse.ok) {
            const wpData = await wpResponse.json();
            event.wpPostId = String(wpData.id);
            event.wpUrl = wpData.link;
            console.log(`[WP-Sync] Successfully synced page in WordPress. ID: ${wpData.id}, Link: ${wpData.link}`);
          } else {
            const errText = await wpResponse.text();
            console.error(`[WP-Sync] WordPress API returned error: ${wpResponse.status} - ${errText}`);
          }
        } catch (wpErr) {
          console.error('[WP-Sync] Failed to connect to WordPress REST API:', wpErr);
        }
      } else {
        console.log('[WP-Sync] Skipped: WordPress API credentials / API Key not found in env configuration.');
      }

      await event.save();
    } else if (action === 'reject') {
      event.status = 'cancelled';
      await event.save();
    }

    res.status(200).json({
      success: true,
      message: `Event onboarding request set to ${action}d successfully`,
      event
    });
  } catch (error) {
    next(error);
  }
});

export default router;
