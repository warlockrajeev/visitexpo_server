/**
 * @file activityLogger.js
 * @description Non-blocking activity logger utility and historical activity synchronizer
 * powering the Admin Activity Monitor page.
 */

import mongoose from 'mongoose';
import UserActivity from '../models/UserActivity.js';
import User from '../models/User.js';
import '../models/Event.js';
import '../models/Organization.js';
import EventEngagement from '../models/EventEngagement.js';
import Visitor from '../models/Visitor.js';
import BoothRequest from '../models/BoothRequest.js';
import EventRequest from '../models/EventRequest.js';
import ContactMessage from '../models/ContactMessage.js';
import Review from '../models/Review.js';
import Exhibitor from '../models/Exhibitor.js';
import { verifyAccessToken } from './jwt.js';

const SENSITIVE_FIELD_REGEX = /(pass|pwd|otp|token|secret|cvv|pin|card|auth|cookie|credential)/i;

export function sanitizeFormFields(input) {
  if (!input || typeof input !== 'object') return null;
  const output = {};
  const entries = Object.entries(input).slice(0, 25);

  for (const [rawKey, rawVal] of entries) {
    const key = String(rawKey || '').trim().slice(0, 60);
    if (!key) continue;

    if (SENSITIVE_FIELD_REGEX.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }

    if (rawVal === null || rawVal === undefined) continue;
    if (typeof rawVal === 'boolean' || typeof rawVal === 'number') {
      output[key] = rawVal;
    } else if (Array.isArray(rawVal)) {
      output[key] = rawVal
        .slice(0, 10)
        .map((item) => String(item ?? '').trim().slice(0, 80))
        .filter(Boolean);
    } else if (typeof rawVal === 'object') {
      output[key] = '[Object]';
    } else {
      const str = String(rawVal).trim();
      if (str) {
        output[key] = str.length > 180 ? `${str.slice(0, 177)}...` : str;
      }
    }
  }

  return Object.keys(output).length > 0 ? output : null;
}

export function extractClientIp(req) {
  if (!req) return '';
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

export async function resolveUserContext(req, providedUser = null) {
  let tokenUser = req?.user || null;

  if (!tokenUser && req?.headers?.authorization?.startsWith('Bearer ')) {
    try {
      const token = req.headers.authorization.split(' ')[1];
      const decoded = verifyAccessToken(token);
      if (decoded) {
        tokenUser = decoded;
      }
    } catch {}
  }

  const candidateId = tokenUser?.id || tokenUser?._id || providedUser?.id || providedUser?._id || null;
  const candidateEmail = (tokenUser?.email || providedUser?.email || '').toLowerCase().trim();

  let dbUser = null;
  try {
    if (candidateId && mongoose.isValidObjectId(candidateId)) {
      dbUser = await User.findById(candidateId)
        .populate('organization', 'name')
        .select('name email phone role company organization')
        .lean();
    } else if (candidateEmail) {
      dbUser = await User.findOne({ email: candidateEmail })
        .populate('organization', 'name')
        .select('name email phone role company organization')
        .lean();
    }
  } catch {}

  const resolvedUserId =
    (dbUser?._id && mongoose.isValidObjectId(dbUser._id) ? dbUser._id : null) ||
    (candidateId && mongoose.isValidObjectId(candidateId) ? new mongoose.Types.ObjectId(candidateId) : null);

  const userName = String(
    dbUser?.name || providedUser?.name || tokenUser?.name || (candidateEmail ? candidateEmail.split('@')[0] : '') || 'Guest Visitor'
  ).trim();

  const userEmail = String(dbUser?.email || candidateEmail || '').toLowerCase().trim();
  const userPhone = String(dbUser?.phone || providedUser?.phone || tokenUser?.phone || '').trim();
  const userRole = String(dbUser?.role || providedUser?.role || tokenUser?.role || (userEmail ? 'visitor' : 'guest'))
    .toLowerCase()
    .trim();
  const userCompany = String(
    dbUser?.company ||
      dbUser?.organization?.name ||
      providedUser?.company ||
      providedUser?.organization?.name ||
      ''
  ).trim();

  return {
    user: resolvedUserId,
    userName,
    userEmail,
    userPhone,
    userRole,
    userCompany
  };
}

/**
 * Records a single user activity entry safely (never throws into request handlers).
 */
export async function logUserActivity({
  req = null,
  user = null,
  sessionId = '',
  activityType = 'page_visit',
  category = 'navigation',
  actionLabel = 'Performed Action',
  description = '',
  pagePath = '',
  pageTitle = '',
  referrerPath = '',
  targetEvent = null,
  formInfo = null,
  elementInfo = null,
  metadata = null,
  source = 'server_hook',
  sourceRefId = ''
}) {
  try {
    const userCtx = await resolveUserContext(req, user);

    const doc = {
      ...userCtx,
      sessionId: String(sessionId || '').trim().slice(0, 120),
      activityType: String(activityType || 'page_visit').trim().slice(0, 60),
      category: String(category || 'navigation').trim().slice(0, 40),
      actionLabel: String(actionLabel || 'Activity Recorded').trim().slice(0, 240),
      description: String(description || '').trim().slice(0, 500),
      pagePath: String(pagePath || '').trim().slice(0, 300),
      pageTitle: String(pageTitle || '').trim().slice(0, 200),
      referrerPath: String(referrerPath || '').trim().slice(0, 300),
      targetEvent: targetEvent
        ? {
            eventId: String(targetEvent.eventId || targetEvent._id || targetEvent.id || '').trim().slice(0, 80),
            title: String(targetEvent.title || '').trim().slice(0, 200),
            slug: String(targetEvent.slug || '').toLowerCase().trim().slice(0, 200),
            category: String(targetEvent.category || '').trim().slice(0, 80),
            city: String(targetEvent.city || '').trim().slice(0, 80)
          }
        : undefined,
      formInfo: formInfo
        ? {
            formName: String(formInfo.formName || '').trim().slice(0, 140),
            formId: String(formInfo.formId || '').trim().slice(0, 80),
            status: String(formInfo.status || 'submitted').trim().slice(0, 40),
            fieldsSummary: sanitizeFormFields(formInfo.fieldsSummary)
          }
        : undefined,
      elementInfo: elementInfo
        ? {
            tag: String(elementInfo.tag || '').trim().slice(0, 30),
            text: String(elementInfo.text || '').trim().slice(0, 160),
            href: String(elementInfo.href || '').trim().slice(0, 300),
            ariaLabel: String(elementInfo.ariaLabel || '').trim().slice(0, 160)
          }
        : undefined,
      metadata: sanitizeFormFields(metadata),
      ipAddress: extractClientIp(req),
      userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 300),
      source: String(source || 'server_hook').trim(),
      sourceRefId: String(sourceRefId || '').trim()
    };

    if (doc.sourceRefId) {
      await UserActivity.updateOne(
        { sourceRefId: doc.sourceRefId },
        { $setOnInsert: doc },
        { upsert: true }
      );
      return null;
    }

    return await UserActivity.create(doc);
  } catch (err) {
    console.warn('[ActivityLogger] Could not record activity:', err.message);
    return null;
  }
}

let lastHistoricalSyncAt = 0;

/**
 * Idempotently imports historical user actions from existing collections into UserActivity
 * using unique sourceRefId keys so existing user activity appears immediately in Activity Monitor.
 */
export async function syncHistoricalActivitiesToMonitor(force = false) {
  const now = Date.now();
  if (!force && now - lastHistoricalSyncAt < 60 * 1000) {
    return { synced: 0, skippedCache: true };
  }
  lastHistoricalSyncAt = now;

  try {
    const [engagements, visitors, boothRequests, eventRequests, contactMsgs, reviews, exhibitors, users] =
      await Promise.all([
        EventEngagement.find({ status: 'active' }).sort({ updatedAt: -1 }).limit(150).lean(),
        Visitor.find().populate('event', 'title slug city categories').sort({ createdAt: -1 }).limit(150).lean(),
        BoothRequest.find().sort({ createdAt: -1 }).limit(100).lean(),
        EventRequest.find().sort({ createdAt: -1 }).limit(100).lean(),
        ContactMessage.find().sort({ createdAt: -1 }).limit(100).lean(),
        Review.find().sort({ createdAt: -1 }).limit(100).lean(),
        Exhibitor.find().populate('event', 'title slug city').sort({ createdAt: -1 }).limit(100).lean(),
        User.find().populate('organization', 'name').sort({ createdAt: -1 }).limit(100).lean()
      ]);

    const ops = [];

    for (const eng of engagements) {
      const refId = `eng:${eng._id}`;
      const isInterested = eng.isInterested || eng.type === 'interested' || eng.type === 'both';
      const isFollowed = eng.isFollowed || eng.type === 'follower' || eng.type === 'both';
      const activityType = isInterested
        ? 'event_interest'
        : isFollowed
        ? 'event_follow'
        : eng.isBookmarked
        ? 'event_bookmark'
        : 'event_interest';
      const actionVerb = isInterested
        ? 'Marked Interested on'
        : isFollowed
        ? 'Followed'
        : 'Bookmarked';

      ops.push({
        updateOne: {
          filter: { sourceRefId: refId },
          update: {
            $setOnInsert: {
              sourceRefId: refId,
              user: eng.user || (eng.userId && mongoose.isValidObjectId(eng.userId) ? eng.userId : null),
              userName: eng.userName || 'Verified Member',
              userEmail: eng.userEmail || '',
              userPhone: eng.userPhone || '',
              userRole: (eng.userRole || 'visitor').toLowerCase(),
              userCompany: eng.userCompany || '',
              activityType,
              category: 'engagement',
              actionLabel: `${actionVerb} ${eng.eventTitle || eng.eventSlug || 'Event'}`,
              description: `${eng.userName || eng.userEmail} ${actionVerb.toLowerCase()} "${eng.eventTitle || eng.eventSlug}"`,
              pagePath: eng.eventSlug ? `/expo/${eng.eventSlug}` : '/events',
              targetEvent: {
                eventId: String(eng.eventId || ''),
                title: eng.eventTitle || '',
                slug: eng.eventSlug || '',
                category: eng.eventCategory || '',
                city: eng.eventCity || ''
              },
              source: 'backfill',
              createdAt: eng.updatedAt || eng.createdAt || new Date(),
              updatedAt: eng.updatedAt || eng.createdAt || new Date()
            }
          },
          upsert: true,
          timestamps: false
        }
      });
    }

    for (const vis of visitors) {
      const refId = `vis:${vis._id}`;
      const evTitle = vis.event?.title || 'Exhibition Event';
      const evSlug = vis.event?.slug || '';
      const statusLabel =
        vis.registrationStatus === 'pending'
          ? 'Requested Visitor Pass for'
          : vis.registrationStatus === 'confirmed'
          ? 'Obtained Visitor Pass for'
          : `Visitor Pass (${vis.registrationStatus || 'registered'}) for`;

      ops.push({
        updateOne: {
          filter: { sourceRefId: refId },
          update: {
            $setOnInsert: {
              sourceRefId: refId,
              userName: vis.name || 'Visitor',
              userEmail: vis.email || '',
              userPhone: vis.phone || '',
              userRole: 'visitor',
              userCompany: vis.company || '',
              activityType: 'pass_request',
              category: 'pass',
              actionLabel: `${statusLabel} ${evTitle}`,
              description: `Attendance: ${vis.attendanceType || 'in_person'} • Status: ${vis.registrationStatus || 'pending'}`,
              pagePath: evSlug ? `/expo/${evSlug}` : '/events',
              targetEvent: {
                eventId: vis.event?._id ? String(vis.event._id) : '',
                title: evTitle,
                slug: evSlug,
                city: vis.event?.city || ''
              },
              formInfo: {
                formName: 'Visitor Pass Request Form',
                status: vis.registrationStatus || 'submitted',
                fieldsSummary: sanitizeFormFields({
                  name: vis.name,
                  email: vis.email,
                  company: vis.company,
                  attendanceType: vis.attendanceType
                })
              },
              source: 'backfill',
              createdAt: vis.createdAt || new Date(),
              updatedAt: vis.updatedAt || vis.createdAt || new Date()
            }
          },
          upsert: true,
          timestamps: false
        }
      });
    }

    for (const br of boothRequests) {
      const refId = `booth:${br._id}`;
      ops.push({
        updateOne: {
          filter: { sourceRefId: refId },
          update: {
            $setOnInsert: {
              sourceRefId: refId,
              user: br.userId || null,
              userName: br.name || 'Exhibitor',
              userEmail: br.email || '',
              userPhone: br.phone || '',
              userRole: 'exhibitor',
              userCompany: br.company || '',
              activityType: 'form_submit',
              category: 'form',
              actionLabel: `Submitted Booth Request Form for ${br.eventTitle || br.eventSlug}`,
              description: `${br.inquiryType || 'Book Stall Space'}${br.company ? ` • ${br.company}` : ''}`,
              pagePath: br.eventSlug ? `/expo/${br.eventSlug}` : '/events',
              targetEvent: {
                eventId: br.event ? String(br.event) : '',
                title: br.eventTitle || '',
                slug: br.eventSlug || '',
                city: br.eventCity || ''
              },
              formInfo: {
                formName: 'Booth & Stall Request Form',
                status: 'submitted',
                fieldsSummary: sanitizeFormFields({
                  company: br.company,
                  designation: br.designation,
                  inquiryType: br.inquiryType,
                  message: br.message
                })
              },
              source: 'backfill',
              createdAt: br.createdAt || new Date(),
              updatedAt: br.updatedAt || br.createdAt || new Date()
            }
          },
          upsert: true,
          timestamps: false
        }
      });
    }

    for (const er of eventRequests) {
      const refId = `ereq:${er._id}`;
      const formLabel =
        er.requestType === 'speaker'
          ? 'Speaker Application Form'
          : er.requestType === 'delegation'
          ? 'Corporate Delegation Form'
          : 'Travel & Hotel Discount Form';
      ops.push({
        updateOne: {
          filter: { sourceRefId: refId },
          update: {
            $setOnInsert: {
              sourceRefId: refId,
              user: er.userId || null,
              userName: er.name || 'Applicant',
              userEmail: er.email || '',
              userPhone: er.phone || '',
              userRole: 'visitor',
              userCompany: er.company || '',
              activityType: 'form_submit',
              category: 'form',
              actionLabel: `Submitted ${formLabel} for ${er.eventTitle || er.eventSlug}`,
              description: er.sessionTopic || er.delegationInterests || er.travelPreference || formLabel,
              pagePath: er.eventSlug ? `/expo/${er.eventSlug}` : '/events',
              targetEvent: {
                eventId: er.event ? String(er.event) : '',
                title: er.eventTitle || '',
                slug: er.eventSlug || '',
                city: er.eventCity || ''
              },
              formInfo: {
                formName: formLabel,
                status: 'submitted',
                fieldsSummary: sanitizeFormFields({
                  requestType: er.requestType,
                  company: er.company,
                  sessionTopic: er.sessionTopic,
                  teamSize: er.teamSize,
                  travelPreference: er.travelPreference
                })
              },
              source: 'backfill',
              createdAt: er.createdAt || new Date(),
              updatedAt: er.updatedAt || er.createdAt || new Date()
            }
          },
          upsert: true,
          timestamps: false
        }
      });
    }

    for (const cm of contactMsgs) {
      const refId = `contact:${cm._id}`;
      ops.push({
        updateOne: {
          filter: { sourceRefId: refId },
          update: {
            $setOnInsert: {
              sourceRefId: refId,
              userName: cm.name || 'Visitor',
              userEmail: cm.email || '',
              userPhone: cm.phone || '',
              userRole: (cm.role || 'visitor').toLowerCase(),
              userCompany: cm.meta?.company || '',
              activityType: 'form_submit',
              category: 'form',
              actionLabel: `Submitted Contact / Inquiry Form (${cm.source || 'landing_contact'})`,
              description: (cm.message || '').slice(0, 180),
              pagePath: '/',
              formInfo: {
                formName: `Contact Inquiry (${cm.source || 'landing_contact'})`,
                status: 'submitted',
                fieldsSummary: sanitizeFormFields({
                  role: cm.role,
                  source: cm.source,
                  message: cm.message
                })
              },
              source: 'backfill',
              createdAt: cm.createdAt || new Date(),
              updatedAt: cm.updatedAt || cm.createdAt || new Date()
            }
          },
          upsert: true,
          timestamps: false
        }
      });
    }

    for (const rv of reviews) {
      const refId = `rev:${rv._id}`;
      ops.push({
        updateOne: {
          filter: { sourceRefId: refId },
          update: {
            $setOnInsert: {
              sourceRefId: refId,
              userName: rv.name || 'Reviewer',
              userEmail: rv.email || '',
              userRole: 'visitor',
              userCompany: rv.company || '',
              activityType: 'form_submit',
              category: 'form',
              actionLabel: `Submitted Event Review (${rv.rating || 5}★) for ${rv.eventTitle || 'Event'}`,
              description: rv.headline || rv.comment || '',
              pagePath: rv.eventSlug ? `/expo/${rv.eventSlug}` : '/events',
              targetEvent: {
                title: rv.eventTitle || '',
                slug: rv.eventSlug || ''
              },
              formInfo: {
                formName: 'Event Review Form',
                status: 'submitted',
                fieldsSummary: sanitizeFormFields({
                  rating: rv.rating,
                  headline: rv.headline
                })
              },
              source: 'backfill',
              createdAt: rv.createdAt || new Date(),
              updatedAt: rv.updatedAt || rv.createdAt || new Date()
            }
          },
          upsert: true,
          timestamps: false
        }
      });
    }

    for (const exh of exhibitors) {
      const refId = `exh:${exh._id}`;
      ops.push({
        updateOne: {
          filter: { sourceRefId: refId },
          update: {
            $setOnInsert: {
              sourceRefId: refId,
              user: exh.user || null,
              userName: exh.name || 'Exhibitor',
              userEmail: exh.contactEmail || '',
              userPhone: exh.contactPhone || '',
              userRole: 'exhibitor',
              userCompany: exh.name || '',
              activityType: 'form_submit',
              category: 'form',
              actionLabel: `Submitted Exhibitor Onboarding Form for ${exh.event?.title || 'Expo'}`,
              description: `Booth: ${exh.boothNumber || 'Pending'} • Status: ${exh.status || 'pending'}`,
              pagePath: exh.event?.slug ? `/expo/${exh.event.slug}` : '/onboarding/exhibitor',
              targetEvent: {
                eventId: exh.event?._id ? String(exh.event._id) : '',
                title: exh.event?.title || '',
                slug: exh.event?.slug || '',
                city: exh.event?.city || ''
              },
              formInfo: {
                formName: 'Exhibitor Booth Registration Form',
                status: exh.status || 'submitted',
                fieldsSummary: sanitizeFormFields({
                  company: exh.name,
                  boothNumber: exh.boothNumber,
                  website: exh.website
                })
              },
              source: 'backfill',
              createdAt: exh.createdAt || new Date(),
              updatedAt: exh.updatedAt || exh.createdAt || new Date()
            }
          },
          upsert: true,
          timestamps: false
        }
      });
    }

    for (const usr of users) {
      if (usr.role === 'super_admin') continue;
      const refId = `usr:${usr._id}`;
      ops.push({
        updateOne: {
          filter: { sourceRefId: refId },
          update: {
            $setOnInsert: {
              sourceRefId: refId,
              user: usr._id,
              userName: usr.name || 'User',
              userEmail: usr.email || '',
              userPhone: usr.phone || '',
              userRole: (usr.role || 'visitor').toLowerCase(),
              userCompany: usr.company || usr.organization?.name || '',
              activityType: 'auth',
              category: 'auth',
              actionLabel: `Registered ${String(usr.role || 'visitor').replace('_', ' ')} Account`,
              description: `${usr.name} (${usr.email}) registered as ${usr.role}`,
              pagePath: '/login',
              formInfo: {
                formName: 'Account Registration Form',
                status: 'submitted',
                fieldsSummary: sanitizeFormFields({
                  name: usr.name,
                  email: usr.email,
                  role: usr.role,
                  company: usr.company || usr.organization?.name
                })
              },
              source: 'backfill',
              createdAt: usr.createdAt || new Date(),
              updatedAt: usr.updatedAt || usr.createdAt || new Date()
            }
          },
          upsert: true,
          timestamps: false
        }
      });
    }

    if (ops.length > 0) {
      const result = await UserActivity.bulkWrite(ops, { ordered: false });
      return { synced: result.upsertedCount || 0 };
    }
    return { synced: 0 };
  } catch (err) {
    console.warn('[ActivityLogger] Historical backfill warning:', err.message);
    return { synced: 0, error: err.message };
  }
}
