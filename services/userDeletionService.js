/**
 * @file userDeletionService.js
 * @description Comprehensive cascade deletion service for User accounts.
 * When a user is deleted, all their associated platform data is permanently removed across:
 * - User credentials and profiles
 * - Event engagements (interested, followers, bookmarks)
 * - Visitor passes and registrations
 * - Exhibitor applications and booth staff assignments
 * - Order history and ticket purchases
 * - CRM Leads and sales activity timelines
 * - User reviews and ratings
 * - Support helpdesk tickets and inquiry responses
 * - Contact messages
 * - In-app and push notifications
 * - Marketing campaigns created by the user
 * - Organizations owned solely by the user
 * - Events created or claimed by the user (recorded in DeletedEvent)
 */

import mongoose from 'mongoose';
import User from '../models/User.js';
import EventEngagement from '../models/EventEngagement.js';
import Visitor from '../models/Visitor.js';
import Exhibitor from '../models/Exhibitor.js';
import Order from '../models/Order.js';
import Lead from '../models/Lead.js';
import Review from '../models/Review.js';
import SupportTicket from '../models/SupportTicket.js';
import ContactMessage from '../models/ContactMessage.js';
import Notification from '../models/Notification.js';
import Campaign from '../models/Campaign.js';
import Organization from '../models/Organization.js';
import Event from '../models/Event.js';
import Ticket from '../models/Ticket.js';
import DeletedEvent from '../models/DeletedEvent.js';
import AuditLog from '../models/AuditLog.js';

/**
 * Permanently delete a user and all of their platform data across all collections.
 *
 * @param {string} userIdOrEmail - User ID or Email to delete
 * @param {string|null} callerId - ID of user initiating the deletion (for self-delete check)
 * @returns {Promise<Object>} Deletion summary and statistics
 */
export async function deleteUserAndAllPlatformData(userIdOrEmail, callerId = null) {
  if (!userIdOrEmail) {
    throw new Error('User ID or Email is required for deletion');
  }

  const identifier = String(userIdOrEmail).trim();
  const isEmail = identifier.includes('@');

  // 1. Locate the target user
  let user = null;
  if (isEmail) {
    user = await User.findOne({ email: identifier.toLowerCase() });
  } else if (mongoose.isValidObjectId(identifier)) {
    user = await User.findById(identifier);
  } else {
    user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { name: identifier }
      ]
    });
  }

  // If user not found in User collection, we still clean up orphan attendee/visitor data by email
  const userEmail = user?.email?.toLowerCase().trim() || (isEmail ? identifier.toLowerCase() : '');
  const targetUserId = user?._id || (mongoose.isValidObjectId(identifier) ? identifier : null);
  const targetUserIdStr = targetUserId ? String(targetUserId) : null;

  // 2. Safety checks
  if (user) {
    if (user.email === 'admin@visitexpo.in') {
      const err = new Error('The root super admin account (admin@visitexpo.in) cannot be deleted.');
      err.statusCode = 400;
      throw err;
    }

    if (callerId && targetUserId && String(callerId) === String(targetUserId)) {
      const err = new Error('You cannot delete your own super admin account.');
      err.statusCode = 400;
      throw err;
    }
  }

  const emailRegex = userEmail
    ? new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
    : null;

  const stats = {
    userDeleted: false,
    userName: user?.name || userEmail || 'Unknown User',
    userEmail: userEmail || 'N/A',
    engagementsDeleted: 0,
    visitorsDeleted: 0,
    exhibitorsDeleted: 0,
    ordersDeleted: 0,
    leadsDeleted: 0,
    reviewsDeleted: 0,
    supportTicketsDeleted: 0,
    contactMessagesDeleted: 0,
    notificationsDeleted: 0,
    campaignsDeleted: 0,
    eventsDeleted: 0,
    organizationsCleaned: 0
  };

  // 3. Delete EventEngagements (Attendees & Followers)
  const engagementConditions = [];
  if (targetUserId) {
    engagementConditions.push({ user: targetUserId });
    engagementConditions.push({ userId: targetUserIdStr });
  }
  if (emailRegex) {
    engagementConditions.push({ userEmail: emailRegex });
  }

  if (engagementConditions.length > 0) {
    const engRes = await EventEngagement.deleteMany({ $or: engagementConditions });
    stats.engagementsDeleted = engRes.deletedCount || 0;
  }

  // 4. Delete Visitor passes & registrations
  if (emailRegex) {
    const visRes = await Visitor.deleteMany({ email: emailRegex });
    stats.visitorsDeleted = visRes.deletedCount || 0;
  }

  // 5. Delete Exhibitor records and remove staff references
  if (emailRegex) {
    const exhRes = await Exhibitor.deleteMany({ contactEmail: emailRegex });
    stats.exhibitorsDeleted = exhRes.deletedCount || 0;

    await Exhibitor.updateMany(
      {},
      { $pull: { staff: { email: emailRegex } } }
    );
  }

  // 6. Delete Orders placed by buyer
  if (emailRegex) {
    const orderRes = await Order.deleteMany({ 'buyer.email': emailRegex });
    stats.ordersDeleted = orderRes.deletedCount || 0;
  }

  // 7. Delete Leads and clear sales assignments / activity timeline entries
  if (emailRegex) {
    const leadRes = await Lead.deleteMany({ email: emailRegex });
    stats.leadsDeleted = leadRes.deletedCount || 0;
  }
  if (targetUserId) {
    await Lead.updateMany(
      { assignedSales: targetUserId },
      { $set: { assignedSales: null } }
    );
    await Lead.updateMany(
      {},
      { $pull: { activityTimeline: { performedBy: targetUserId } } }
    );
  }

  // 8. Delete Reviews submitted by user
  if (emailRegex) {
    const revRes = await Review.deleteMany({ email: emailRegex });
    stats.reviewsDeleted = revRes.deletedCount || 0;
  }

  // 9. Delete SupportTickets and responses
  const ticketConditions = [];
  if (targetUserId) ticketConditions.push({ user: targetUserId });
  if (emailRegex) ticketConditions.push({ reporterEmail: emailRegex });

  if (ticketConditions.length > 0) {
    const stRes = await SupportTicket.deleteMany({ $or: ticketConditions });
    stats.supportTicketsDeleted = stRes.deletedCount || 0;
  }
  if (targetUserId) {
    await SupportTicket.updateMany(
      {},
      { $pull: { responses: { sender: targetUserId } } }
    );
  }

  // 10. Delete ContactMessages
  if (emailRegex) {
    const cmRes = await ContactMessage.deleteMany({ email: emailRegex });
    stats.contactMessagesDeleted = cmRes.deletedCount || 0;
  }

  // 11. Delete Notifications
  if (targetUserId) {
    const notifRes = await Notification.deleteMany({ user: targetUserId });
    stats.notificationsDeleted = notifRes.deletedCount || 0;
  }

  // 12. Delete Marketing Campaigns created by user
  if (targetUserId) {
    const campRes = await Campaign.deleteMany({ createdBy: targetUserId });
    stats.campaignsDeleted = campRes.deletedCount || 0;
  }

  // 13. Clean up AuditLogs performed by user
  if (targetUserId) {
    await AuditLog.deleteMany({ performedBy: targetUserId });
  }

  // 14. Handle Events organized or claimed by this user
  if (targetUserId) {
    const userEvents = await Event.find({
      $or: [
        { organizer: targetUserId },
        { claimedBy: targetUserId }
      ]
    }).select('_id slug title wpPostId');

    if (userEvents.length > 0) {
      const eventIds = userEvents.map(e => e._id);
      const eventSlugs = userEvents.map(e => e.slug).filter(Boolean);

      // Record in DeletedEvent to prevent resurgence from syncs
      for (const ev of userEvents) {
        try {
          await DeletedEvent.findOneAndUpdate(
            { eventId: String(ev._id) },
            {
              eventId: String(ev._id),
              slug: ev.slug,
              title: ev.title,
              wpPostId: ev.wpPostId || '',
              deletedAt: new Date(),
              deletedBy: callerId && mongoose.isValidObjectId(callerId) ? callerId : null,
              reason: `Deleted along with organizer account (${user?.name || userEmail})`
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        } catch (e) {
          console.warn('[userDeletionService] DeletedEvent insert note:', e.message);
        }
      }

      // Delete child records of user's events
      await Promise.all([
        Ticket.deleteMany({ event: { $in: eventIds } }),
        Visitor.deleteMany({ event: { $in: eventIds } }),
        Exhibitor.deleteMany({ event: { $in: eventIds } }),
        Lead.deleteMany({ event: { $in: eventIds } }),
        Campaign.deleteMany({ event: { $in: eventIds } }),
        EventEngagement.deleteMany({
          $or: [
            { eventId: { $in: eventIds.map(String) } },
            { eventSlug: { $in: eventSlugs } }
          ]
        }),
        Event.deleteMany({ _id: { $in: eventIds } })
      ]);

      stats.eventsDeleted = userEvents.length;
    }
  }

  // 15. Clean up Organization team members & orphan organizations
  if (targetUserId) {
    await Organization.updateMany(
      {},
      { $pull: { teamMembers: { user: targetUserId } } }
    );

    // If user owned an organization that now has 0 team members, clean it up
    if (user?.organization) {
      const org = await Organization.findById(user.organization);
      if (org && (!org.teamMembers || org.teamMembers.length === 0)) {
        const remainingEvents = await Event.countDocuments({ organizer: org._id });
        if (remainingEvents === 0) {
          await Organization.findByIdAndDelete(org._id);
          stats.organizationsCleaned++;
        }
      }
    }
  }

  // 16. Finally, permanently delete the User document(s)
  if (targetUserId) {
    await User.findByIdAndDelete(targetUserId);
    stats.userDeleted = true;
  }
  if (emailRegex) {
    const uRes = await User.deleteMany({ email: emailRegex });
    if (uRes.deletedCount > 0) stats.userDeleted = true;
  }

  return {
    success: true,
    message: `User account "${stats.userName}" (${stats.userEmail}) and all associated platform data permanently deleted.`,
    stats
  };
}
