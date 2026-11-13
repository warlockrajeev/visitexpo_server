/**
 * @file companyProfileHelper.js
 * @description Shared helper to resolve and synchronize a user's company/organization name
 * across User, Organization, Exhibitor, and Visitor records for all roles (visitor, exhibitor, organizer).
 */

import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Visitor from '../models/Visitor.js';
import Exhibitor from '../models/Exhibitor.js';

const PLACEHOLDER_ORG_SUFFIX = "'s Organization";

function isMeaningfulCompany(value) {
  const trimmed = String(value || '').trim();
  return Boolean(trimmed) && trimmed.toLowerCase() !== 'trade delegate';
}

/**
 * Resolve the user's current company name from backend models.
 * Checks User.company, populated Organization.name (ignoring default placeholder unless nothing else exists),
 * and role-specific Visitor / Exhibitor registrations by email.
 */
export async function resolveUserCompany(userInput) {
  if (!userInput) return '';

  let userDoc = userInput;
  if (typeof userInput === 'string' || userInput._bsontype === 'ObjectId') {
    userDoc = await User.findById(userInput).populate('organization').lean();
    if (!userDoc) return '';
  }

  if (isMeaningfulCompany(userDoc.company)) {
    return userDoc.company.trim();
  }

  let orgName = userDoc.organization?.name ? String(userDoc.organization.name).trim() : '';
  if (!orgName && userDoc.organization && typeof userDoc.organization !== 'object') {
    const orgDoc = await Organization.findById(userDoc.organization).select('name').lean();
    orgName = orgDoc?.name ? String(orgDoc.name).trim() : '';
  }

  if (isMeaningfulCompany(orgName) && !orgName.includes(PLACEHOLDER_ORG_SUFFIX)) {
    return orgName;
  }

  const normalizedEmail = String(userDoc.email || '').trim().toLowerCase();
  if (normalizedEmail) {
    if (userDoc.role === 'exhibitor') {
      const exhibitorDoc = await Exhibitor.findOne({ contactEmail: normalizedEmail })
        .sort({ updatedAt: -1 })
        .select('name')
        .lean();
      if (isMeaningfulCompany(exhibitorDoc?.name)) {
        return exhibitorDoc.name.trim();
      }
    } else if (userDoc.role === 'visitor') {
      const visitorDoc = await Visitor.findOne({
        email: normalizedEmail,
        company: { $exists: true, $nin: [null, ''] }
      })
        .sort({ updatedAt: -1 })
        .select('company')
        .lean();
      if (isMeaningfulCompany(visitorDoc?.company)) {
        return visitorDoc.company.trim();
      }
    }
  }

  return isMeaningfulCompany(orgName) ? orgName : '';
}

/**
 * Replace/sync the user's stored company name in the backend across User, Organization,
 * and role-specific records when a user enters a new/different company name.
 */
export async function syncUserCompanyName(userId, rawCompany) {
  const cleanCompany = String(rawCompany || '').trim();
  if (!userId || !isMeaningfulCompany(cleanCompany) || cleanCompany.length < 2) {
    return { updated: false, company: cleanCompany, user: null };
  }

  const userDoc = await User.findById(userId).populate('organization');
  if (!userDoc) {
    return { updated: false, company: cleanCompany, user: null };
  }

  const previousResolved = await resolveUserCompany(userDoc);
  const changed = previousResolved !== cleanCompany || String(userDoc.company || '').trim() !== cleanCompany;

  userDoc.company = cleanCompany;
  await userDoc.save();

  // Sync linked Organization name for organizers/exhibitors (or any user with an organization record)
  const orgId = userDoc.organization?._id || userDoc.organization;
  if (orgId) {
    await Organization.findByIdAndUpdate(orgId, { name: cleanCompany }).catch(() => {});
  }

  // Sync matching Visitor / Exhibitor records by email so future lookups & badges match
  const normalizedEmail = String(userDoc.email || '').trim().toLowerCase();
  if (normalizedEmail) {
    if (userDoc.role === 'visitor') {
      await Visitor.updateMany(
        { email: normalizedEmail },
        { $set: { company: cleanCompany } }
      ).catch(() => {});
    } else if (userDoc.role === 'exhibitor') {
      const exhibitorDocs = await Exhibitor.find({ contactEmail: normalizedEmail });
      for (const doc of exhibitorDocs) {
        if (doc.name !== cleanCompany) {
          doc.name = cleanCompany;
          await doc.save().catch(() => {});
        }
      }
    }
  }

  const populatedUser = await User.findById(userDoc._id).select('-password').populate('organization');
  return {
    updated: changed,
    previousCompany: previousResolved,
    company: cleanCompany,
    user: populatedUser
  };
}

