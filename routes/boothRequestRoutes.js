/**
 * @file boothRequestRoutes.js
 * @description API endpoints for Expo Booth Requests (submitted directly to VisitExpo Admin,
 * synced user company name, live request counts per expo, and Admin management queries).
 */

import express from 'express';
import mongoose from 'mongoose';
import BoothRequest from '../models/BoothRequest.js';
import BoothOrganizerNotification from '../models/BoothOrganizerNotification.js';
import Event from '../models/Event.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import FeaturedOrganizer from '../models/FeaturedOrganizer.js';
import { protect, authorize } from '../middlewares/auth.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { syncUserCompanyName } from '../services/companyProfileHelper.js';
import { notifyFollowersOnActivity } from '../services/followNotificationService.js';
import { sendOrganizerBoothCountNotification } from '../services/emailService.js';
import { logUserActivity } from '../utils/activityLogger.js';

const router = express.Router();

const GENERIC_ORG_NAMES = new Set(['organizer', 'organiser', 'event organizer', 'event organiser', 'unknown', 'n/a', 'na', '-']);

function isMeaningfulOrgName(name) {
  const clean = String(name || '').trim();
  if (!clean) return false;
  return !GENERIC_ORG_NAMES.has(clean.toLowerCase());
}

function isValidEmailAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function formatEventDateRange(startDate, endDate) {
  if (!startDate) return '';
  try {
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) return '';
    const opts = { day: '2-digit', month: 'short', year: 'numeric' };
    const startStr = start.toLocaleDateString('en-IN', opts);
    if (!endDate) return startStr;
    const end = new Date(endDate);
    if (Number.isNaN(end.getTime()) || end.toDateString() === start.toDateString()) {
      return startStr;
    }
    return `${startStr} – ${end.toLocaleDateString('en-IN', opts)}`;
  } catch {
    return '';
  }
}

/**
 * Bulk-resolves Event + Organizer contact details for a list of event slugs / ObjectIds.
 * Checks Event.orgEmail, Organization.contact.email, claimedBy/createdBy User, and FeaturedOrganizer.
 */
async function resolveOrganizersForBoothEvents(eventRefs = []) {
  const slugSet = new Set();
  const idSet = new Set();

  for (const ref of eventRefs) {
    const slug = String(ref?.eventSlug || '').trim().toLowerCase();
    if (slug) slugSet.add(slug);
    if (ref?.event && mongoose.isValidObjectId(ref.event)) {
      idSet.add(String(ref.event));
    }
  }

  const orConditions = [];
  if (slugSet.size > 0) orConditions.push({ slug: { $in: [...slugSet] } });
  if (idSet.size > 0) {
    orConditions.push({ _id: { $in: [...idSet].map((id) => new mongoose.Types.ObjectId(id)) } });
  }

  const events = orConditions.length
    ? await Event.find({ $or: orConditions })
        .select('_id title slug venue city state country startDate endDate organizer claimedBy createdBy isClaimed orgName orgEmail orgPhone orgWebsite')
        .lean()
    : [];

  const orgIds = [...new Set(events.map((e) => (e.organizer ? String(e.organizer) : '')).filter(Boolean))];
  const userIds = [
    ...new Set(
      events
        .flatMap((e) => [e.claimedBy ? String(e.claimedBy) : '', e.createdBy ? String(e.createdBy) : ''])
        .filter(Boolean)
    )
  ];
  const meaningfulOrgNames = [
    ...new Set(events.map((e) => String(e.orgName || '').trim()).filter(isMeaningfulOrgName))
  ];

  const [orgsById, usersById, featuredOrgs, orgsByName] = await Promise.all([
    orgIds.length
      ? Organization.find({ _id: { $in: orgIds.map((id) => new mongoose.Types.ObjectId(id)) } })
          .select('_id name contact website logo')
          .lean()
      : [],
    userIds.length
      ? User.find({ _id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } })
          .select('_id name email workEmail phone company organization')
          .lean()
      : [],
    meaningfulOrgNames.length
      ? FeaturedOrganizer.find({
          name: {
            $in: meaningfulOrgNames.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))
          }
        })
          .select('name applicantEmail applicantPhone website')
          .lean()
      : [],
    meaningfulOrgNames.length
      ? Organization.find({
          name: {
            $in: meaningfulOrgNames.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))
          }
        })
          .select('_id name contact website')
          .lean()
      : []
  ]);

  const orgByIdMap = new Map(orgsById.map((o) => [String(o._id), o]));
  const userByIdMap = new Map(usersById.map((u) => [String(u._id), u]));
  const featuredByNameMap = new Map(featuredOrgs.map((f) => [String(f.name || '').trim().toLowerCase(), f]));
  const orgByNameMap = new Map(orgsByName.map((o) => [String(o.name || '').trim().toLowerCase(), o]));

  const eventBySlugMap = new Map();
  const eventByIdMap = new Map();

  for (const ev of events) {
    const linkedOrg = ev.organizer ? orgByIdMap.get(String(ev.organizer)) : null;
    const claimedUser = ev.claimedBy ? userByIdMap.get(String(ev.claimedBy)) : null;
    const createdUser = ev.createdBy ? userByIdMap.get(String(ev.createdBy)) : null;
    const orgNameLower = isMeaningfulOrgName(ev.orgName) ? String(ev.orgName).trim().toLowerCase() : '';
    const matchedOrgByName = orgNameLower ? orgByNameMap.get(orgNameLower) : null;
    const matchedFeatured = orgNameLower ? featuredByNameMap.get(orgNameLower) : null;

    const resolvedName =
      (linkedOrg?.name && String(linkedOrg.name).trim()) ||
      (isMeaningfulOrgName(ev.orgName) ? String(ev.orgName).trim() : '') ||
      (claimedUser?.company && String(claimedUser.company).trim()) ||
      (claimedUser?.name && String(claimedUser.name).trim()) ||
      (matchedOrgByName?.name && String(matchedOrgByName.name).trim()) ||
      (matchedFeatured?.name && String(matchedFeatured.name).trim()) ||
      (createdUser?.company && String(createdUser.company).trim()) ||
      (createdUser?.name && String(createdUser.name).trim()) ||
      '';

    let resolvedEmail = '';
    let emailSource = 'none';
    const emailCandidates = [
      { value: ev.orgEmail, source: 'event' },
      { value: linkedOrg?.contact?.email, source: 'organization' },
      { value: claimedUser?.workEmail || claimedUser?.email, source: 'claimed_user' },
      { value: matchedOrgByName?.contact?.email, source: 'organization' },
      { value: matchedFeatured?.applicantEmail, source: 'featured_organizer' },
      { value: createdUser?.workEmail || createdUser?.email, source: 'created_user' }
    ];

    for (const candidate of emailCandidates) {
      const cleaned = String(candidate.value || '').trim().toLowerCase();
      if (cleaned && isValidEmailAddress(cleaned)) {
        resolvedEmail = cleaned;
        emailSource = candidate.source;
        break;
      }
    }

    const resolvedPhone =
      String(ev.orgPhone || '').trim() ||
      String(linkedOrg?.contact?.phone || '').trim() ||
      String(claimedUser?.phone || '').trim() ||
      String(matchedOrgByName?.contact?.phone || '').trim() ||
      String(matchedFeatured?.applicantPhone || '').trim() ||
      String(createdUser?.phone || '').trim() ||
      '';

    const resolvedWebsite =
      String(ev.orgWebsite || '').trim() ||
      String(linkedOrg?.website || '').trim() ||
      String(matchedOrgByName?.website || '').trim() ||
      String(matchedFeatured?.website || '').trim() ||
      '';

    const details = {
      eventId: String(ev._id),
      eventTitle: ev.title || '',
      eventSlug: ev.slug || '',
      eventVenue: ev.venue || '',
      eventCity: ev.city || '',
      eventStartDate: ev.startDate || null,
      eventEndDate: ev.endDate || null,
      eventDateRange: formatEventDateRange(ev.startDate, ev.endDate),
      isClaimed: Boolean(ev.isClaimed),
      name: resolvedName,
      email: resolvedEmail,
      phone: resolvedPhone,
      website: resolvedWebsite,
      source: emailSource
    };

    if (ev.slug) eventBySlugMap.set(String(ev.slug).toLowerCase(), details);
    eventByIdMap.set(String(ev._id), details);
  }

  return { eventBySlugMap, eventByIdMap };
}

function buildEventConditions({ eventSlug, eventId }) {
  const conditions = [];
  const cleanSlug = String(eventSlug || '').trim().toLowerCase();
  if (cleanSlug) {
    const escapedSlug = cleanSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    conditions.push({ eventSlug: new RegExp(`^${escapedSlug}$`, 'i') });
  }
  if (eventId && mongoose.isValidObjectId(eventId)) {
    conditions.push({ event: new mongoose.Types.ObjectId(eventId) });
  }
  return conditions;
}

function buildEventCountFilter({ eventSlug, eventId }) {
  const conditions = buildEventConditions({ eventSlug, eventId });
  if (conditions.length === 0) return null;
  return {
    $or: conditions,
    requestCategory: 'stall',
    status: { $ne: 'rejected' }
  };
}

/**
 * GET /api/booth-requests/count
 * Public endpoint returning live count of booth requests for a specific expo,
 * and (when Authorization Bearer token is present) whether the current user has already requested a booth.
 */
router.get('/count', async (req, res) => {
  try {
    const eventConditions = buildEventConditions({
      eventSlug: req.query.eventSlug,
      eventId: req.query.eventId
    });
    if (eventConditions.length === 0) {
      return res.status(200).json({ success: true, count: 0, hasRequested: false });
    }

    const filter = {
      $or: eventConditions,
      requestCategory: 'stall',
      status: { $ne: 'rejected' }
    };
    const count = await BoothRequest.countDocuments(filter);

    let hasRequested = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);
      if (decoded && String(decoded.role || '').toLowerCase() !== 'visitor') {
        const userConditions = [];
        if (decoded.id && mongoose.isValidObjectId(decoded.id)) {
          userConditions.push({ userId: new mongoose.Types.ObjectId(decoded.id) });
        }
        if (decoded.email) {
          userConditions.push({ email: String(decoded.email).trim().toLowerCase() });
        }
        if (userConditions.length > 0) {
          const existing = await BoothRequest.exists({
            $and: [
              { $or: eventConditions },
              { requestCategory: 'stall' },
              { status: { $ne: 'rejected' } },
              { $or: userConditions }
            ]
          });
          hasRequested = Boolean(existing);
        }
      }
    }

    res.status(200).json({ success: true, count, hasRequested });
  } catch (err) {
    console.error('Error counting booth requests:', err);
    res.status(500).json({ success: false, error: 'Failed to load booth request count.' });
  }
});

/**
 * GET /api/booth-requests/my
 * Authenticated endpoint returning the current user's booth request history (all statuses & categories).
 */
router.get('/my', protect, async (req, res) => {
  try {
    const userConditions = [];
    if (req.user?.id && mongoose.isValidObjectId(req.user.id)) {
      userConditions.push({ userId: new mongoose.Types.ObjectId(req.user.id) });
    }
    if (req.user?.email) {
      userConditions.push({ email: String(req.user.email).trim().toLowerCase() });
    }
    if (userConditions.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        stats: { total: 0, new: 0, in_progress: 0, responded: 0, approved: 0 }
      });
    }

    const requests = await BoothRequest.find({ $or: userConditions })
      .sort({ createdAt: -1 })
      .lean();

    const stats = requests.reduce(
      (acc, r) => {
        acc.total += 1;
        if (acc[r.status] !== undefined) acc[r.status] += 1;
        return acc;
      },
      { total: 0, new: 0, in_progress: 0, responded: 0, approved: 0 }
    );

    res.status(200).json({ success: true, data: requests, stats });
  } catch (err) {
    console.error('Error loading user booth requests:', err);
    res.status(500).json({ success: false, error: 'Failed to load your booth request history.' });
  }
});

/**
 * POST /api/booth-requests
 * Submit a Booth / Event inquiry request directly to VisitExpo Admin.
 * Synchronizes user company name in backend if entered/changed.
 */
router.post('/', protect, async (req, res) => {
  try {
    const {
      eventId,
      eventSlug,
      eventTitle,
      eventVenue,
      eventCity,
      name,
      email,
      phone,
      company,
      designation,
      requestCategory,
      inquiryType,
      message
    } = req.body;

    const cleanSlug = String(eventSlug || '').trim().toLowerCase();
    const cleanTitle = String(eventTitle || cleanSlug || 'Exhibition').trim();
    if (!cleanSlug && !eventId) {
      return res.status(400).json({ success: false, error: 'Event identifier is required.' });
    }

    const requesterName = String(name || req.user?.name || '').trim();
    const requesterEmail = String(email || req.user?.email || '').trim().toLowerCase();
    const requesterPhone = String(phone || '').trim();
    const requesterCompany = String(company || '').trim();
    const requesterDesignation = String(designation || '').trim();
    const requesterMessage = String(message || '').trim();

    if (!requesterName || requesterName.length < 2) {
      return res.status(400).json({ success: false, error: 'Full name is required.' });
    }
    if (!requesterEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
      return res.status(400).json({ success: false, error: 'Valid work email is required.' });
    }

    const isGibberishOrSymbols = (str) => {
      if (!str || typeof str !== 'string') return false;
      const s = str.trim();
      if (!s) return false;
      const alphaNum = (s.match(/[a-zA-Z0-9]/g) || []).length;
      return alphaNum < 2 || /^[^a-zA-Z0-9]+$/.test(s);
    };

    const allowedCategory = ['stall', 'visitor_pass', 'general'].includes(requestCategory)
      ? requestCategory
      : 'stall';

    if (String(req.user?.role || '').toLowerCase() === 'visitor' && allowedCategory === 'stall') {
      return res.status(403).json({
        success: false,
        error: 'Booth requests are only available for Exhibitor and Organiser accounts.'
      });
    }

    if (allowedCategory === 'stall' && !requesterCompany) {
      return res.status(400).json({ success: false, error: 'Company / Organization name is required for stall booking.' });
    }
    if (requesterCompany && isGibberishOrSymbols(requesterCompany)) {
      return res.status(400).json({ success: false, error: 'Please provide a valid company name (at least 2 letters or numbers).' });
    }
    if (requesterDesignation && isGibberishOrSymbols(requesterDesignation)) {
      return res.status(400).json({ success: false, error: 'Please provide a valid designation / role.' });
    }
    if (requesterMessage && isGibberishOrSymbols(requesterMessage)) {
      return res.status(400).json({ success: false, error: 'Please provide a meaningful message (avoid pure symbols).' });
    }

    // Resolve MongoDB event ref if present (optional for WordPress/directory expos)
    let matchedEvent = null;
    if (eventId && mongoose.isValidObjectId(eventId)) {
      matchedEvent = await Event.findById(eventId).select('_id slug title city venue').lean();
    }
    if (!matchedEvent && cleanSlug) {
      matchedEvent = await Event.findOne({ slug: cleanSlug }).select('_id slug title city venue').lean();
    }

    const resolvedSlug = matchedEvent?.slug || cleanSlug || cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const requestEventConditions = buildEventConditions({
      eventSlug: resolvedSlug,
      eventId: matchedEvent?._id || eventId
    });
    const requesterConditions = [{ email: requesterEmail }];
    if (req.user?.id && mongoose.isValidObjectId(req.user.id)) {
      requesterConditions.push({ userId: new mongoose.Types.ObjectId(req.user.id) });
    }

    const existingRequest = await BoothRequest.findOne({
      $and: [
        { $or: requestEventConditions },
        { requestCategory: allowedCategory },
        { $or: requesterConditions }
      ]
    }).sort({ createdAt: -1 });

    if (existingRequest) {
      return res.status(409).json({
        success: false,
        error: `You have already submitted a ${allowedCategory === 'stall' ? 'stall inquiry' : 'visitor pass request'} for this exhibition.`,
        data: existingRequest
      });
    }

    const createdRequest = await BoothRequest.create({
      event: matchedEvent?._id || null,
      eventSlug: resolvedSlug,
      eventTitle: matchedEvent?.title || cleanTitle,
      eventCity: String(eventCity || matchedEvent?.city || '').trim(),
      eventVenue: String(eventVenue || matchedEvent?.venue || '').trim(),
      userId: req.user?.id || null,
      name: requesterName,
      email: requesterEmail,
      phone: requesterPhone,
      company: requesterCompany,
      designation: requesterDesignation,
      requestCategory: allowedCategory,
      inquiryType: String(
        inquiryType ||
          (allowedCategory === 'stall'
            ? 'Book Stall Space'
            : allowedCategory === 'visitor_pass'
            ? 'Visitor Entry Pass'
            : 'General Inquiry')
      ).trim(),
      message: requesterMessage,
      status: 'new'
    });

    // Replace/sync the user's company name in backend if entered
    let updatedCompany = requesterCompany;
    if (req.user?.id && requesterCompany.length >= 2) {
      const syncRes = await syncUserCompanyName(req.user.id, requesterCompany);
      if (syncRes?.company) updatedCompany = syncRes.company;
    }

    const countFilter = buildEventCountFilter({
      eventSlug: resolvedSlug,
      eventId: matchedEvent?._id || eventId
    });
    const count = countFilter ? await BoothRequest.countDocuments(countFilter) : 1;

    // Notify followers of the requester about this activity
    try {
      notifyFollowersOnActivity({
        actorUserId: req.user?.id || null,
        actorEmail: requesterEmail,
        actorName: requesterName,
        eventId: matchedEvent?._id || null,
        eventSlug: resolvedSlug,
        eventTitle: matchedEvent?.title || cleanTitle,
        activityType: 'booth_requested',
        title: `Booth Activity by ${requesterName}`,
        message: `${requesterName}${updatedCompany ? ` (${updatedCompany})` : ''} submitted a booth request for "${matchedEvent?.title || cleanTitle}".`,
        url: `/expo/${resolvedSlug}`
      });
    } catch (_) {}

    void logUserActivity({
      req,
      user: {
        id: req.user?.id || null,
        name: requesterName,
        email: requesterEmail,
        phone: requesterPhone,
        role: req.user?.role || 'exhibitor',
        company: updatedCompany
      },
      activityType: 'form_submit',
      category: 'form',
      actionLabel: `Submitted Booth Request Form for ${matchedEvent?.title || cleanTitle}`,
      description: `${createdRequest.inquiryType}${updatedCompany ? ` • ${updatedCompany}` : ''}`,
      pagePath: `/expo/${resolvedSlug}`,
      targetEvent: {
        eventId: matchedEvent?._id ? String(matchedEvent._id) : '',
        title: matchedEvent?.title || cleanTitle,
        slug: resolvedSlug,
        city: createdRequest.eventCity || ''
      },
      formInfo: {
        formName: 'Booth & Stall Request Form',
        status: 'submitted',
        fieldsSummary: {
          inquiryType: createdRequest.inquiryType,
          company: updatedCompany,
          designation: requesterDesignation,
          message: requesterMessage
        }
      },
      source: 'server_hook'
    });

    res.status(201).json({
      success: true,
      message: 'Booth request submitted directly to VisitExpo Admin.',
      data: createdRequest,
      updatedCompany,
      count
    });
  } catch (err) {
    console.error('Error submitting booth request:', err);
    res.status(500).json({ success: false, error: 'Failed to submit booth request.' });
  }
});

// ============================================================================
// ADMIN-PROTECTED BOOTH REQUEST QUERIES MANAGEMENT
// ============================================================================

/**
 * GET /api/booth-requests/admin/all
 * List all booth request queries for the Admin Panel with search, status/type filters,
 * resolved event organizer details, per-event count summaries, and KPI stats.
 */
router.get('/admin/all', protect, authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const { status, requestCategory, search, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }
    if (requestCategory && requestCategory !== 'all') {
      filter.requestCategory = requestCategory;
    }
    if (search && String(search).trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { name: regex },
        { email: regex },
        { company: regex },
        { eventTitle: regex },
        { eventCity: regex },
        { message: regex }
      ];
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

    const [
      requests,
      filteredTotal,
      totalAll,
      newCount,
      inProgressCount,
      respondedCount,
      approvedCount,
      eventAggs,
      notificationAggs,
      totalAlertsSent
    ] = await Promise.all([
      BoothRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      BoothRequest.countDocuments(filter),
      BoothRequest.countDocuments(),
      BoothRequest.countDocuments({ status: 'new' }),
      BoothRequest.countDocuments({ status: 'in_progress' }),
      BoothRequest.countDocuments({ status: 'responded' }),
      BoothRequest.countDocuments({ status: 'approved' }),
      BoothRequest.aggregate([
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: { $toLower: '$eventSlug' },
            event: { $first: '$event' },
            eventSlug: { $first: { $toLower: '$eventSlug' } },
            eventTitle: { $first: '$eventTitle' },
            eventCity: { $first: '$eventCity' },
            eventVenue: { $first: '$eventVenue' },
            latestRequestAt: { $max: '$createdAt' },
            totalAll: { $sum: 1 },
            activeCount: {
              $sum: { $cond: [{ $ne: ['$status', 'rejected'] }, 1, 0] }
            },
            stallCount: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$requestCategory', 'stall'] }, { $ne: ['$status', 'rejected'] }] },
                  1,
                  0
                ]
              }
            },
            visitorPassCount: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$requestCategory', 'visitor_pass'] }, { $ne: ['$status', 'rejected'] }] },
                  1,
                  0
                ]
              }
            },
            generalCount: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$requestCategory', 'general'] }, { $ne: ['$status', 'rejected'] }] },
                  1,
                  0
                ]
              }
            },
            newCount: {
              $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] }
            },
            rejectedCount: {
              $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
            }
          }
        },
        { $sort: { latestRequestAt: -1 } }
      ]),
      BoothOrganizerNotification.aggregate([
        { $match: { status: 'sent' } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: { $toLower: '$eventSlug' },
            sentCount: { $sum: 1 },
            lastSentAt: { $first: '$createdAt' },
            lastSentTo: { $first: '$organizerEmail' },
            lastReportedCount: { $first: '$reportedCount' },
            lastCountScope: { $first: '$countScope' },
            lastSentByAdmin: { $first: '$sentByAdmin' }
          }
        }
      ]),
      BoothOrganizerNotification.countDocuments({ status: 'sent' })
    ]);

    const allEventRefs = [
      ...eventAggs.map((agg) => ({ eventSlug: agg.eventSlug, event: agg.event })),
      ...requests.map((r) => ({ eventSlug: r.eventSlug, event: r.event }))
    ];
    const { eventBySlugMap, eventByIdMap } = await resolveOrganizersForBoothEvents(allEventRefs);
    const notifBySlugMap = new Map(notificationAggs.map((n) => [String(n._id || '').toLowerCase(), n]));

    const eventSummaryMap = new Map();
    const eventSummaries = eventAggs.map((agg) => {
      const slugKey = String(agg.eventSlug || '').toLowerCase();
      const orgInfo =
        eventBySlugMap.get(slugKey) ||
        (agg.event ? eventByIdMap.get(String(agg.event)) : null) ||
        null;
      const notifInfo = notifBySlugMap.get(slugKey) || null;

      const summary = {
        eventId: orgInfo?.eventId || (agg.event ? String(agg.event) : null),
        eventSlug: slugKey,
        eventTitle: orgInfo?.eventTitle || agg.eventTitle || slugKey,
        eventVenue: orgInfo?.eventVenue || agg.eventVenue || '',
        eventCity: orgInfo?.eventCity || agg.eventCity || '',
        eventStartDate: orgInfo?.eventStartDate || null,
        eventEndDate: orgInfo?.eventEndDate || null,
        eventDateRange: orgInfo?.eventDateRange || '',
        latestRequestAt: agg.latestRequestAt,
        totalRequests: agg.activeCount,
        totalAllRequests: agg.totalAll,
        stallCount: agg.stallCount,
        visitorPassCount: agg.visitorPassCount,
        generalCount: agg.generalCount,
        newCount: agg.newCount,
        rejectedCount: agg.rejectedCount,
        organizerDetails: {
          name: orgInfo?.name || '',
          email: orgInfo?.email || '',
          phone: orgInfo?.phone || '',
          website: orgInfo?.website || '',
          source: orgInfo?.source || 'none',
          isClaimed: Boolean(orgInfo?.isClaimed)
        },
        notificationSummary: notifInfo
          ? {
              sentCount: notifInfo.sentCount,
              lastSentAt: notifInfo.lastSentAt,
              lastSentTo: notifInfo.lastSentTo,
              lastReportedCount: notifInfo.lastReportedCount,
              lastCountScope: notifInfo.lastCountScope || 'all',
              lastSentByAdmin: notifInfo.lastSentByAdmin || 'admin'
            }
          : null
      };

      eventSummaryMap.set(slugKey, summary);
      return summary;
    });

    const enrichedRequests = requests.map((item) => {
      const slugKey = String(item.eventSlug || '').toLowerCase();
      const summary = eventSummaryMap.get(slugKey) || null;
      const orgInfo =
        summary?.organizerDetails ||
        eventBySlugMap.get(slugKey) ||
        (item.event ? eventByIdMap.get(String(item.event)) : null) || {
          name: '',
          email: '',
          phone: '',
          website: '',
          source: 'none',
          isClaimed: false
        };

      return {
        ...item,
        organizerDetails: {
          name: orgInfo.name || '',
          email: orgInfo.email || '',
          phone: orgInfo.phone || '',
          website: orgInfo.website || '',
          source: orgInfo.source || 'none',
          isClaimed: Boolean(orgInfo.isClaimed)
        },
        eventBoothSummary: summary
          ? {
              totalRequests: summary.totalRequests,
              stallCount: summary.stallCount,
              visitorPassCount: summary.visitorPassCount,
              generalCount: summary.generalCount,
              eventDateRange: summary.eventDateRange,
              notificationSummary: summary.notificationSummary
            }
          : {
              totalRequests: 1,
              stallCount: item.requestCategory === 'stall' ? 1 : 0,
              visitorPassCount: item.requestCategory === 'visitor_pass' ? 1 : 0,
              generalCount: item.requestCategory === 'general' ? 1 : 0,
              eventDateRange: '',
              notificationSummary: null
            }
      };
    });

    res.status(200).json({
      success: true,
      total: filteredTotal,
      page: Number(page),
      totalPages: Math.max(1, Math.ceil(filteredTotal / Number(limit))),
      stats: {
        total: totalAll,
        new: newCount,
        in_progress: inProgressCount,
        responded: respondedCount,
        approved: approvedCount,
        eventsWithRequests: eventSummaries.length,
        organizerAlertsSent: totalAlertsSent
      },
      data: enrichedRequests,
      eventSummaries
    });
  } catch (err) {
    console.error('Error fetching admin booth requests:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch booth requests.' });
  }
});

/**
 * GET /api/booth-requests/admin/notifications
 * Fetch organizer count-notification dispatch history (optionally filtered by eventSlug).
 */
router.get('/admin/notifications', protect, authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const { eventSlug, limit = 50 } = req.query;
    const filter = {};
    if (eventSlug && String(eventSlug).trim()) {
      filter.eventSlug = String(eventSlug).trim().toLowerCase();
    }

    const logs = await BoothOrganizerNotification.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
      .lean();

    res.status(200).json({
      success: true,
      data: logs
    });
  } catch (err) {
    console.error('Error fetching organizer notification logs:', err);
    res.status(500).json({ success: false, error: 'Failed to load organizer notification history.' });
  }
});

/**
 * PUT /api/booth-requests/admin/event-organizer
 * Save or update an event's organizer contact details (name, email, phone, website) directly from Admin Booth Desk.
 */
router.put('/admin/event-organizer', protect, authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const { eventSlug, eventId, organizerName, organizerEmail, organizerPhone, organizerWebsite } = req.body;
    const cleanSlug = String(eventSlug || '').trim().toLowerCase();
    const cleanEmail = String(organizerEmail || '').trim().toLowerCase();

    if (!cleanSlug && !eventId) {
      return res.status(400).json({ success: false, error: 'Event identifier is required.' });
    }
    if (cleanEmail && !isValidEmailAddress(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid organizer email address.' });
    }

    let targetEvent = null;
    if (eventId && mongoose.isValidObjectId(eventId)) {
      targetEvent = await Event.findById(eventId);
    }
    if (!targetEvent && cleanSlug) {
      targetEvent = await Event.findOne({ slug: cleanSlug });
    }
    if (!targetEvent) {
      return res.status(404).json({ success: false, error: 'Event record not found in database.' });
    }

    if (organizerName !== undefined) targetEvent.orgName = String(organizerName).trim();
    if (organizerEmail !== undefined) targetEvent.orgEmail = cleanEmail;
    if (organizerPhone !== undefined) targetEvent.orgPhone = String(organizerPhone).trim();
    if (organizerWebsite !== undefined) targetEvent.orgWebsite = String(organizerWebsite).trim();
    await targetEvent.save();

    res.status(200).json({
      success: true,
      message: 'Organizer contact details updated for event.',
      data: {
        eventId: String(targetEvent._id),
        eventSlug: targetEvent.slug,
        orgName: targetEvent.orgName,
        orgEmail: targetEvent.orgEmail,
        orgPhone: targetEvent.orgPhone,
        orgWebsite: targetEvent.orgWebsite
      }
    });
  } catch (err) {
    console.error('Error updating event organizer details:', err);
    res.status(500).json({ success: false, error: 'Failed to update event organizer details.' });
  }
});

/**
 * POST /api/booth-requests/admin/notify-organizer
 * Sends a count-only Booth Request summary email to the event organizer.
 * NEVER includes requester PII (names, emails, phones, companies, messages).
 */
router.post('/admin/notify-organizer', protect, authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const {
      eventSlug,
      eventId,
      recipientEmail,
      organizerName,
      countScope = 'all',
      customSubject = '',
      customNote = '',
      saveOrganizerEmailToEvent = true
    } = req.body;

    const cleanSlug = String(eventSlug || '').trim().toLowerCase();
    const cleanScope = countScope === 'stall' ? 'stall' : 'all';

    if (!cleanSlug && !eventId) {
      return res.status(400).json({ success: false, error: 'Event slug or event ID is required.' });
    }

    const { eventBySlugMap, eventByIdMap } = await resolveOrganizersForBoothEvents([
      { eventSlug: cleanSlug, event: eventId }
    ]);
    const resolvedOrg =
      eventBySlugMap.get(cleanSlug) ||
      (eventId ? eventByIdMap.get(String(eventId)) : null) ||
      null;

    const targetEmail = String(recipientEmail || resolvedOrg?.email || '')
      .trim()
      .toLowerCase();
    if (!targetEmail || !isValidEmailAddress(targetEmail)) {
      return res.status(400).json({
        success: false,
        error: 'A valid organizer email address is required to send the notification.'
      });
    }

    const targetOrganizerName =
      String(organizerName || resolvedOrg?.name || '').trim() || 'Event Organizer';

    // Compute live request counts directly from MongoDB (never fetch requester PII for the email)
    const eventConditions = buildEventConditions({
      eventSlug: resolvedOrg?.eventSlug || cleanSlug,
      eventId: resolvedOrg?.eventId || eventId
    });
    if (eventConditions.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid event reference.' });
    }

    const [totalActive, stallCount, visitorPassCount, generalCount, sampleReq] = await Promise.all([
      BoothRequest.countDocuments({ $or: eventConditions, status: { $ne: 'rejected' } }),
      BoothRequest.countDocuments({ $or: eventConditions, requestCategory: 'stall', status: { $ne: 'rejected' } }),
      BoothRequest.countDocuments({ $or: eventConditions, requestCategory: 'visitor_pass', status: { $ne: 'rejected' } }),
      BoothRequest.countDocuments({ $or: eventConditions, requestCategory: 'general', status: { $ne: 'rejected' } }),
      BoothRequest.findOne({ $or: eventConditions })
        .select('event eventSlug eventTitle eventVenue eventCity')
        .sort({ createdAt: -1 })
        .lean()
    ]);

    const reportedCount = cleanScope === 'stall' ? stallCount : totalActive;
    if (reportedCount <= 0) {
      return res.status(400).json({
        success: false,
        error:
          cleanScope === 'stall'
            ? 'No active Stall Space requests found for this event. Switch scope to "All Requests" if sending visitor/general counts.'
            : 'No active booth requests found for this event.'
      });
    }

    const finalEventSlug = resolvedOrg?.eventSlug || sampleReq?.eventSlug || cleanSlug;
    const finalEventTitle = resolvedOrg?.eventTitle || sampleReq?.eventTitle || finalEventSlug;
    const finalEventVenue = resolvedOrg?.eventVenue || sampleReq?.eventVenue || '';
    const finalEventCity = resolvedOrg?.eventCity || sampleReq?.eventCity || '';
    const finalEventId = resolvedOrg?.eventId || (sampleReq?.event ? String(sampleReq.event) : null);

    const mailResult = await sendOrganizerBoothCountNotification({
      to: targetEmail,
      organizerName: targetOrganizerName,
      eventTitle: finalEventTitle,
      eventSlug: finalEventSlug,
      eventVenue: finalEventVenue,
      eventCity: finalEventCity,
      eventDateRange: resolvedOrg?.eventDateRange || '',
      reportedCount,
      countScope: cleanScope,
      stallCount,
      visitorPassCount,
      generalCount,
      customSubject: String(customSubject || '').trim(),
      customNote: String(customNote || '').trim()
    });

    const computedSubject =
      String(customSubject || '').trim() ||
      `${reportedCount} ${cleanScope === 'stall' ? 'Booth / Stall Request' : 'Booth & Event Request'}${reportedCount === 1 ? '' : 's'} Received for ${finalEventTitle} — VisitExpo`;

    const notificationLog = await BoothOrganizerNotification.create({
      event: finalEventId && mongoose.isValidObjectId(finalEventId) ? new mongoose.Types.ObjectId(finalEventId) : null,
      eventSlug: finalEventSlug,
      eventTitle: finalEventTitle,
      organizerName: targetOrganizerName,
      organizerEmail: targetEmail,
      countScope: cleanScope,
      reportedCount,
      totalRequestCount: totalActive,
      stallCount,
      visitorPassCount,
      generalCount,
      subject: computedSubject,
      customNote: String(customNote || '').trim(),
      sentByAdmin: req.user?.email || 'admin',
      status: mailResult.success ? 'sent' : 'failed',
      messageId: mailResult.messageId || '',
      errorMessage: mailResult.success ? '' : String(mailResult.error || 'Email delivery failed')
    });

    // Optionally persist the organizer email (and name if generic/empty) back to the Event document
    let savedToEvent = false;
    if (saveOrganizerEmailToEvent && finalEventId && mongoose.isValidObjectId(finalEventId)) {
      const eventDoc = await Event.findById(finalEventId);
      if (eventDoc) {
        let changed = false;
        if (targetEmail && targetEmail !== String(eventDoc.orgEmail || '').trim().toLowerCase()) {
          eventDoc.orgEmail = targetEmail;
          changed = true;
        }
        if (
          organizerName &&
          isMeaningfulOrgName(organizerName) &&
          !isMeaningfulOrgName(eventDoc.orgName)
        ) {
          eventDoc.orgName = String(organizerName).trim();
          changed = true;
        }
        if (changed) {
          await eventDoc.save();
          savedToEvent = true;
        }
      }
    }

    if (!mailResult.success) {
      return res.status(502).json({
        success: false,
        error: mailResult.error || 'Failed to send email to organizer.',
        data: { notification: notificationLog, savedToEvent }
      });
    }

    res.status(200).json({
      success: true,
      message: `Count-only booth request alert (${reportedCount}) sent to ${targetEmail}.`,
      data: {
        notification: notificationLog,
        counts: {
          reportedCount,
          totalRequests: totalActive,
          stallCount,
          visitorPassCount,
          generalCount
        },
        recipientEmail: targetEmail,
        savedToEvent
      }
    });
  } catch (err) {
    console.error('Error sending organizer booth count notification:', err);
    res.status(500).json({ success: false, error: 'Failed to send organizer notification email.' });
  }
});

/**
 * PUT /api/booth-requests/admin/:id
 * Update booth request status or admin notes.
 */
router.put('/admin/:id', protect, authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const validStatuses = ['new', 'in_progress', 'responded', 'approved', 'rejected', 'archived'];

    const existing = await BoothRequest.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Booth request not found.' });
    }

    if (status) {
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status value.' });
      }
      existing.status = status;
      if (status !== 'new' && !existing.respondedAt) {
        existing.respondedAt = new Date();
      }
    }
    if (adminNotes !== undefined) {
      existing.adminNotes = String(adminNotes);
    }
    existing.reviewedByAdmin = req.user?.email || 'admin';
    await existing.save();

    res.status(200).json({
      success: true,
      message: 'Booth request updated successfully.',
      data: existing
    });
  } catch (err) {
    console.error('Error updating booth request:', err);
    res.status(500).json({ success: false, error: 'Failed to update booth request.' });
  }
});

/**
 * DELETE /api/booth-requests/admin/:id
 * Permanently delete a booth request query from Admin Panel.
 */
router.delete('/admin/:id', protect, authorize('super_admin', 'admin'), async (req, res) => {
  try {
    const deleted = await BoothRequest.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Booth request not found.' });
    }
    res.status(200).json({
      success: true,
      message: 'Booth request deleted permanently.'
    });
  } catch (err) {
    console.error('Error deleting booth request:', err);
    res.status(500).json({ success: false, error: 'Failed to delete booth request.' });
  }
});

export default router;
