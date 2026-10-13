/**
 * @file promotionAudienceService.js
 * @description Audience aggregator and Growth Plan entitlement checker for VisitExpo Organizer Email Promotions.
 */

import mongoose from 'mongoose';
import User from '../models/User.js';
import Event from '../models/Event.js';
import Lead from '../models/Lead.js';
import Visitor from '../models/Visitor.js';
import EventEngagement from '../models/EventEngagement.js';
import Subscription from '../models/Subscription.js';

/**
 * Check if a user / organizer has active Growth Plan access
 */
export const hasGrowthPromotionAccess = async (userOrId) => {
  if (!userOrId) return false;
  let user = userOrId;
  if (typeof userOrId === 'string' || userOrId instanceof mongoose.Types.ObjectId) {
    user = await User.findById(userOrId);
  }
  if (!user) return false;

  // Super admin / admin has bypass access
  if (user.role === 'super_admin' || user.role === 'admin') {
    return true;
  }

  // Direct growth flag or plan string
  if (user.hasGrowthPlan === true || String(user.plan).toLowerCase().trim() === 'growth') {
    return true;
  }

  // Active subscription with plan === 'growth'
  try {
    const growthSub = await Subscription.findOne({
      user: user._id,
      plan: 'growth',
      status: { $in: ['active', 'trialing'] }
    });
    if (growthSub) return true;
  } catch (err) {
    console.warn('[AudienceService] Error checking growth subscription:', err.message);
  }

  return false;
};

/**
 * Fetch and deduplicate target audience members for an organizer and event
 */
export const getTargetAudienceForEvent = async ({
  organizerUser,
  eventId,
  audienceTypes = ['leads', 'visitors', 'followers', 'interested']
}) => {
  const normalizedTypes = Array.isArray(audienceTypes)
    ? audienceTypes.map(t => String(t).toLowerCase().trim())
    : ['leads', 'visitors', 'followers', 'interested'];

  // Resolve event details
  let event = null;
  if (eventId) {
    event = await Event.findById(eventId).populate('organizer', 'name email company organization');
  }

  const recipientMap = new Map();
  let leadsCount = 0;
  let visitorsCount = 0;
  let followersCount = 0;
  let interestedCount = 0;

  // 1. Leads
  if (normalizedTypes.includes('leads') && eventId) {
    const leads = await Lead.find({ event: eventId });
    for (const l of leads) {
      if (l.email && l.email.includes('@')) {
        leadsCount++;
        const email = l.email.toLowerCase().trim();
        const realName = (l.name && l.name.trim()) || 'Valued Lead';
        if (!recipientMap.has(email)) {
          recipientMap.set(email, {
            email,
            name: realName,
            company: l.company || '',
            designation: l.designation || '',
            phone: l.phone || '',
            audienceType: 'lead',
            allAudiences: ['lead']
          });
        } else {
          const rec = recipientMap.get(email);
          if (!rec.allAudiences.includes('lead')) rec.allAudiences.push('lead');
          if (l.name && (!rec.name || rec.name.startsWith('Valued') || rec.name.startsWith('Registered') || rec.name.startsWith('Event') || rec.name.startsWith('Interested'))) {
            rec.name = realName;
          }
          if (l.company && !rec.company) rec.company = l.company;
          if (l.designation && !rec.designation) rec.designation = l.designation;
        }
      }
    }
  }

  // 2. Registered Visitors
  if (normalizedTypes.includes('visitors') && eventId) {
    const visitors = await Visitor.find({
      event: eventId,
      registrationStatus: { $ne: 'cancelled' }
    });
    for (const v of visitors) {
      if (v.email && v.email.includes('@')) {
        visitorsCount++;
        const email = v.email.toLowerCase().trim();
        const realName = (v.name && v.name.trim()) || 'Registered Visitor';
        if (!recipientMap.has(email)) {
          recipientMap.set(email, {
            email,
            name: realName,
            company: v.company || '',
            designation: v.designation || '',
            phone: v.phone || '',
            audienceType: 'visitor',
            allAudiences: ['visitor']
          });
        } else {
          const rec = recipientMap.get(email);
          if (!rec.allAudiences.includes('visitor')) rec.allAudiences.push('visitor');
          if (v.name && (!rec.name || rec.name.startsWith('Valued') || rec.name.startsWith('Registered') || rec.name.startsWith('Event') || rec.name.startsWith('Interested'))) {
            rec.name = realName;
          }
          if (v.company && !rec.company) rec.company = v.company;
          if (v.designation && !rec.designation) rec.designation = v.designation;
        }
      }
    }
  }

  // 3. Followers & Interested from EventEngagement
  if ((normalizedTypes.includes('followers') || normalizedTypes.includes('interested')) && event) {
    const eventSlug = event.slug || '';
    const engagementQuery = {
      $or: [
        { eventId: String(event._id) },
        ...(eventSlug ? [{ eventSlug }] : [])
      ],
      status: 'active'
    };

    const engagements = await EventEngagement.find(engagementQuery);

    for (const eng of engagements) {
      if (!eng.userEmail || !eng.userEmail.includes('@')) continue;
      const email = eng.userEmail.toLowerCase().trim();
      const isFollower = eng.type === 'follower' || eng.type === 'both' || eng.isFollowed === true;
      const isInterested = eng.type === 'interested' || eng.type === 'both' || eng.isInterested === true;
      const realName = (eng.userName && eng.userName.trim()) || (isFollower ? 'Event Follower' : 'Interested Attendee');

      if (normalizedTypes.includes('followers') && isFollower) {
        followersCount++;
        if (!recipientMap.has(email)) {
          recipientMap.set(email, {
            email,
            name: realName,
            company: eng.userCompany || '',
            designation: eng.userDesignation || '',
            phone: eng.userPhone || '',
            audienceType: 'follower',
            allAudiences: ['follower']
          });
        } else {
          const rec = recipientMap.get(email);
          if (!rec.allAudiences.includes('follower')) rec.allAudiences.push('follower');
          if (eng.userName && (!rec.name || rec.name.startsWith('Valued') || rec.name.startsWith('Registered') || rec.name.startsWith('Event') || rec.name.startsWith('Interested'))) {
            rec.name = realName;
          }
        }
      }

      if (normalizedTypes.includes('interested') && isInterested) {
        interestedCount++;
        if (!recipientMap.has(email)) {
          recipientMap.set(email, {
            email,
            name: realName,
            company: eng.userCompany || '',
            designation: eng.userDesignation || '',
            phone: eng.userPhone || '',
            audienceType: 'interested',
            allAudiences: ['interested']
          });
        } else {
          const rec = recipientMap.get(email);
          if (!rec.allAudiences.includes('interested')) rec.allAudiences.push('interested');
          if (eng.userName && (!rec.name || rec.name.startsWith('Valued') || rec.name.startsWith('Registered') || rec.name.startsWith('Event') || rec.name.startsWith('Interested'))) {
            rec.name = realName;
          }
        }
      }
    }
  }

  const recipients = Array.from(recipientMap.values());

  return {
    totalUnique: recipients.length,
    breakdown: {
      leads: leadsCount,
      visitors: visitorsCount,
      followers: followersCount,
      interested: interestedCount
    },
    recipients,
    sampleRecipients: recipients.slice(0, 8).map(r => ({
      name: r.name,
      maskedEmail: r.email.replace(/(.{2})(.*)(@.*)/, '$1***$3'),
      audienceType: r.audienceType,
      allAudiences: r.allAudiences
    }))
  };
};

export default {
  hasGrowthPromotionAccess,
  getTargetAudienceForEvent
};
