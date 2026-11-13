/**
 * @file ticketingHelper.js
 * @description Shared helpers for normalizing event ticketing modes
 * ('free' | 'paid' | 'free_then_paid'), syncing coordinated Ticket tiers,
 * and computing live complimentary pass eligibility.
 */

export const TICKETING_MODES = ['free', 'paid', 'free_then_paid'];

/**
 * Normalizes incoming ticketing fields from wizard or edit forms while preserving
 * backwards compatibility with callers that only pass `isFreeEvent` / `paidTicketPrice`.
 */
export function normalizeTicketingFields(body = {}) {
  let mode = TICKETING_MODES.includes(body.ticketingMode) ? body.ticketingMode : null;
  if (!mode) {
    const isFree = body.isFreeEvent === true || body.isFreeEvent === 'true';
    mode = isFree ? 'free' : 'paid';
  }

  const freePassQuota = mode === 'free_then_paid'
    ? Math.max(0, parseInt(body.freePassQuota, 10) || 0)
    : 0;

  let freePassUntil = null;
  if (mode === 'free_then_paid' && body.freePassUntil) {
    const parsed = new Date(body.freePassUntil);
    if (!Number.isNaN(parsed.getTime())) {
      freePassUntil = parsed;
    }
  }

  const rawPrice = body.paidTicketPrice !== undefined ? body.paidTicketPrice : body.price;
  const paidTicketPrice = mode === 'free' ? 0 : Math.max(0, parseFloat(rawPrice) || 0);
  const currency = body.currency || 'INR';

  return {
    ticketingMode: mode,
    isFreeEvent: mode === 'free',
    paidTicketPrice,
    currency,
    freePassQuota,
    freePassUntil
  };
}

/**
 * Evaluates whether an event still has complimentary trade passes available
 * (applicable to `'free'` and `'free_then_paid'` ticketing modes).
 */
export function resolveLivePassState(event, claimedCount = null) {
  if (!event) {
    return {
      ticketingMode: 'free',
      isCurrentlyFree: true,
      currentPrice: 0,
      currency: 'INR',
      remainingFreePasses: null,
      entryLabel: 'Free Ticket for Industry Professionals'
    };
  }

  const mode = TICKETING_MODES.includes(event.ticketingMode)
    ? event.ticketingMode
    : (event.isFreeEvent === false ? 'paid' : 'free');
  const paidPrice = Number(event.paidTicketPrice) || 0;
  const currency = event.currency || 'INR';

  if (mode === 'free') {
    return {
      ticketingMode: 'free',
      isCurrentlyFree: true,
      currentPrice: 0,
      currency,
      remainingFreePasses: null,
      entryLabel: 'Free Ticket for Industry Professionals'
    };
  }

  if (mode === 'paid') {
    return {
      ticketingMode: 'paid',
      isCurrentlyFree: false,
      currentPrice: paidPrice,
      currency,
      remainingFreePasses: 0,
      entryLabel: `Paid Admission — ${currency} ${paidPrice}`
    };
  }

  // 'free_then_paid'
  const quota = Math.max(0, Number(event.freePassQuota) || 0);
  const used = claimedCount !== null ? claimedCount : Math.max(0, Number(event.freePassClaimedCount) || 0);
  const quotaAvailable = quota === 0 || used < quota;
  const untilDate = event.freePassUntil ? new Date(event.freePassUntil) : null;
  if (untilDate && !Number.isNaN(untilDate.getTime()) && untilDate.getHours() === 0 && untilDate.getMinutes() === 0) {
    untilDate.setHours(23, 59, 59, 999);
  }
  const withinDate = !untilDate || Number.isNaN(untilDate.getTime()) || Date.now() <= untilDate.getTime();
  const isCurrentlyFree = quotaAvailable && withinDate;
  const remainingFreePasses = quota > 0 ? Math.max(0, quota - used) : null;

  return {
    ticketingMode: 'free_then_paid',
    isCurrentlyFree,
    currentPrice: isCurrentlyFree ? 0 : paidPrice,
    currency,
    remainingFreePasses,
    entryLabel: isCurrentlyFree
      ? `Free Early Trade Pass${remainingFreePasses !== null ? ` (${remainingFreePasses} left)` : ''}, then ${currency} ${paidPrice}`
      : `Paid Admission — ${currency} ${paidPrice}`
  };
}

const DEFAULT_TIER_TITLES = [
  'Default Entry Pass',
  'General Admission',
  'Visitor Pass'
];
const EARLY_FREE_TIER_TITLE = 'Complimentary Trade Pass (Early Access)';

/**
 * Auto-creates or updates Ticket tier documents matching the event's ticketing mode.
 */
export async function syncDefaultTicketTierForEvent(TicketModel, eventId, body = {}) {
  if (
    body.ticketingMode === undefined &&
    body.isFreeEvent === undefined &&
    body.paidTicketPrice === undefined
  ) {
    return;
  }

  const normalized = normalizeTicketingFields(body);
  const { ticketingMode, paidTicketPrice, currency, freePassQuota, freePassUntil } = normalized;

  let mainTicket = await TicketModel.findOne({
    event: eventId,
    title: { $in: DEFAULT_TIER_TITLES }
  });
  let earlyFreeTicket = await TicketModel.findOne({
    event: eventId,
    title: EARLY_FREE_TIER_TITLE
  });

  if (ticketingMode === 'free_then_paid') {
    const quotaText = freePassQuota > 0 ? `first ${freePassQuota} trade visitors` : 'early-bird trade visitors';
    const untilText = freePassUntil
      ? ` until ${freePassUntil.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : '';
    const freeDesc = `Complimentary trade visitor pass for the ${quotaText}${untilText}, before standard paid entry applies.`;

    if (earlyFreeTicket) {
      earlyFreeTicket.type = 'free';
      earlyFreeTicket.price = 0;
      earlyFreeTicket.currency = currency;
      earlyFreeTicket.capacity = freePassQuota > 0 ? freePassQuota : -1;
      earlyFreeTicket.salesEnd = freePassUntil || null;
      earlyFreeTicket.description = freeDesc;
      earlyFreeTicket.benefits = ['Complimentary Trade Entry', 'Digital QR Visitor Badge'];
      earlyFreeTicket.status = earlyFreeTicket.capacity !== -1 && earlyFreeTicket.soldCount >= earlyFreeTicket.capacity
        ? 'sold_out'
        : 'active';
      await earlyFreeTicket.save();
    } else {
      await TicketModel.create({
        title: EARLY_FREE_TIER_TITLE,
        description: freeDesc,
        type: 'free',
        price: 0,
        currency,
        salesEnd: freePassUntil || null,
        capacity: freePassQuota > 0 ? freePassQuota : -1,
        benefits: ['Complimentary Trade Entry', 'Digital QR Visitor Badge'],
        event: eventId
      });
    }

    const paidDesc = `Standard paid admission (${currency} ${paidTicketPrice}) after complimentary trade pass allocation ends.`;
    if (mainTicket) {
      mainTicket.title = 'General Admission';
      mainTicket.type = 'paid';
      mainTicket.price = paidTicketPrice;
      mainTicket.currency = currency;
      mainTicket.description = paidDesc;
      await mainTicket.save();
    } else {
      await TicketModel.create({
        title: 'General Admission',
        description: paidDesc,
        type: 'paid',
        price: paidTicketPrice,
        currency,
        capacity: body.ticketCapacity || 1000,
        event: eventId
      });
    }
    return;
  }

  // Standard single-tier mode ('free' or 'paid') — remove early-bird tier if present
  if (earlyFreeTicket) {
    await TicketModel.deleteOne({ _id: earlyFreeTicket._id });
  }

  const isFree = ticketingMode === 'free';
  const price = isFree ? 0 : paidTicketPrice;
  const type = isFree ? 'free' : (price > 0 ? 'paid' : 'free');
  const title = isFree ? 'Visitor Pass' : 'General Admission';
  const description = isFree
    ? 'Complimentary visitor registration pass'
    : `Standard paid entry ticket — ${currency} ${price}`;

  if (mainTicket) {
    mainTicket.type = type;
    mainTicket.price = price;
    mainTicket.currency = currency;
    mainTicket.title = title;
    mainTicket.description = description;
    await mainTicket.save();
  } else {
    await TicketModel.create({
      title,
      description,
      type,
      price,
      currency,
      capacity: body.ticketCapacity || 1000,
      event: eventId
    });
  }
}

