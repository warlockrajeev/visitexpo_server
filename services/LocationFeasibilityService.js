/**
 * @file LocationFeasibilityService.js
 * @description Location Market Feasibility & Event Presence Intelligence Engine.
 * Analyzes location visitor demand, competitor exhibitions, category popularity,
 * and generates actionable Go/No-Go feasibility reports for event organizers.
 */

import Event from '../models/Event.js';
import Visitor from '../models/Visitor.js';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import EventEngagement from '../models/EventEngagement.js';
import Venue from '../models/Venue.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function getUtcDayStart(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getPeakConcurrentEvents(events, rangeStart, rangeEnd) {
  const changes = [];

  events.forEach(event => {
    if (!event.startDate || !event.endDate) return;

    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) return;

    const start = Math.max(getUtcDayStart(startDate), rangeStart);
    const endExclusive = Math.min(getUtcDayStart(endDate) + DAY_IN_MS, rangeEnd);
    if (start >= endExclusive) return;

    changes.push({ time: start, change: 1 });
    changes.push({ time: endExclusive, change: -1 });
  });

  changes.sort((a, b) => a.time - b.time || a.change - b.change);
  let concurrentEvents = 0;
  let peakConcurrentEvents = 0;

  changes.forEach(({ change }) => {
    concurrentEvents += change;
    peakConcurrentEvents = Math.max(peakConcurrentEvents, concurrentEvents);
  });

  return peakConcurrentEvents;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getRecommendedLaunchWindow(events, now, rangeEnd) {
  const monthWindows = Array.from({ length: 12 }, (_, index) => {
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index, 1);
    const monthEnd = Math.min(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + index + 1, 1),
      rangeEnd
    );
    const monthDate = new Date(monthStart);
    return {
      start: monthStart,
      end: monthEnd,
      label: monthDate.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
      eventCount: 0
    };
  });

  let hasDatedUpcomingEvents = false;
  events.forEach(event => {
    if (!event.startDate || !event.endDate) return;
    const startDate = new Date(event.startDate);
    const endDate = new Date(event.endDate);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) return;
    const eventStart = getUtcDayStart(startDate);
    const eventEnd = getUtcDayStart(endDate) + DAY_IN_MS;
    if (eventEnd <= getUtcDayStart(now) || eventStart >= rangeEnd) return;
    hasDatedUpcomingEvents = true;

    monthWindows.forEach(month => {
      if (eventStart < month.end && eventEnd > Math.max(month.start, getUtcDayStart(now))) {
        month.eventCount += 1;
      }
    });
  });

  if (!hasDatedUpcomingEvents) return 'Data Not Available — no dated upcoming sector listings';

  const lowestEventCount = Math.min(...monthWindows.map(month => month.eventCount));
  const recommendedMonths = monthWindows
    .filter(month => month.eventCount === lowestEventCount)
    .map(month => month.label);
  return `${recommendedMonths.join(', ')} (${lowestEventCount} listed competing events)`;
}

function getMedian(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

// Normalized metro cluster mappings
const CITY_CLUSTERS = {
  'delhi': ['delhi', 'new delhi', 'noida', 'greater noida', 'gurugram', 'gurgaon', 'faridabad', 'ghaziabad'],
  'new delhi': ['new delhi', 'delhi', 'noida', 'greater noida', 'gurugram', 'gurgaon'],
  'mumbai': ['mumbai', 'navi mumbai', 'thane', 'mumbai metro'],
  'bengaluru': ['bengaluru', 'bangalore'],
  'bangalore': ['bengaluru', 'bangalore'],
  'hyderabad': ['hyderabad', 'secunderabad', 'telangana'],
  'ahmedabad': ['ahmedabad', 'gandhinagar'],
  'chennai': ['chennai', 'tamil nadu'],
  'kolkata': ['kolkata', 'west bengal'],
  'pune': ['pune', 'pcmc'],
  'jaipur': ['jaipur', 'rajasthan'],
  'lucknow': ['lucknow', 'uttar pradesh'],
  'chandigarh': ['chandigarh', 'mohali', 'panchkula'],
  'indore': ['indore', 'madhya pradesh'],
  'surat': ['surat', 'gujarat'],
  'kochi': ['kochi', 'cochin', 'kerala'],
  'goa': ['goa', 'panaji']
};

const KNOWN_CITIES = new Set([
  ...Object.keys(CITY_CLUSTERS),
  ...Object.values(CITY_CLUSTERS).flat(),
  'agra', 'amritsar', 'bhopal', 'bhubaneswar', 'coimbatore', 'dehradun',
  'dubai', 'guwahati', 'jodhpur', 'kanpur', 'kozhikode', 'ludhiana',
  'madurai', 'mangaluru', 'mysuru', 'nagpur', 'nashik', 'patna',
  'raipur', 'rajkot', 'ranchi', 'thiruvananthapuram', 'tiruchirappalli',
  'udaipur', 'vadodara', 'varanasi', 'vijayawada', 'visakhapatnam'
]);

function normalizeCityName(city) {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class LocationFeasibilityService {
  /**
   * Resolve city search patterns
   */
  getCityVariants(cityInput) {
    if (!cityInput) return [];
    const normalized = cityInput.trim().toLowerCase();
    const cluster = CITY_CLUSTERS[normalized] || [normalized];
    return Array.from(new Set([normalized, ...cluster]));
  }

  /**
   * Main Feasibility Analysis Method
   */
  async analyzeLocation({ city, category = '', user = null }) {
    if (!city || typeof city !== 'string' || city.trim() === '') {
      throw new Error('Valid location or city name is required.');
    }

    const cleanCity = city.trim();
    const normalizedCity = normalizeCityName(cleanCity);
    if (normalizedCity.length < 3 || /\d/.test(cleanCity)) {
      const error = new Error('City not found. Please enter a valid city name.');
      error.statusCode = 404;
      throw error;
    }

    const cityCluster = CITY_CLUSTERS[normalizedCity] || [normalizedCity];
    const publishedCities = await Event.distinct('city', { status: 'published' });
    const knownPublishedCities = new Set(
      publishedCities.filter(cityName => typeof cityName === 'string').map(normalizeCityName)
    );
    if (
      !KNOWN_CITIES.has(normalizedCity) &&
      !knownPublishedCities.has(normalizedCity)
    ) {
      const error = new Error('City not found. Please enter a valid city name.');
      error.statusCode = 404;
      throw error;
    }

    const cityVariants = Array.from(new Set([normalizedCity, ...cityCluster]));
    const cityRegexList = cityVariants.map(v => new RegExp(`^${escapeRegex(v)}$`, 'i'));
    const venueRegexList = cityVariants.map(
      v => new RegExp(`(?:^|[^a-z])${escapeRegex(v)}(?:$|[^a-z])`, 'i')
    );

    // Check Plan / Access Rights:
    // Starter & Enterprise: Included (Free of extra charge)
    // Super Admin / Admin: Included
    // Free User: Unlocked only if user.hasUnlockedLocationResearch is true
    const userRole = (user?.role || '').toLowerCase();
    const userPlan = (user?.plan || 'free').toLowerCase();
    const isPlanActive = user?.isPlanActive ?? true;
    const isSuperAdmin = ['super_admin', 'admin', 'sub_admin', 'subadmin'].includes(userRole);
    const isPaidPlan = isPlanActive && ['starter', 'enterprise', 'growth'].includes(userPlan);
    const hasPaidFeasibilityUnlock = !!user?.hasUnlockedLocationResearch;

    const isFullAccess = isSuperAdmin || isPaidPlan || hasPaidFeasibilityUnlock;

    // 1. Query existing events present in this city
    const eventQuery = {
      status: 'published',
      $or: [
        { city: { $in: cityRegexList } },
        { venue: { $in: venueRegexList } }
      ]
    };

    const cityEvents = await Event.find(eventQuery)
      .select('title slug city venue startDate endDate categories banner isClaimed viewCount interestedCount paidTicketPrice isFreeEvent')
      .sort({ startDate: 1 })
      .lean();

    const now = new Date();
    const selectedCategory = category.trim() && category.trim().toLowerCase() !== 'all'
      ? category.trim()
      : '';
    const categoryRegex = selectedCategory
      ? new RegExp(escapeRegex(selectedCategory), 'i')
      : null;
    const presentEvents = categoryRegex
      ? cityEvents.filter(event => (event.categories || []).some(value => categoryRegex.test(value || '')))
      : cityEvents;

    const historicalEventQuery = {
      status: 'completed',
      eventType: { $in: ['physical', 'hybrid'] },
      endDate: {
        $gte: new Date(now.getTime() - (3 * 365 * DAY_IN_MS)),
        $lt: now
      },
      $or: [
        { city: { $in: cityRegexList } },
        { venue: { $in: venueRegexList } }
      ]
    };
    if (categoryRegex) historicalEventQuery.categories = categoryRegex;
    const historicalEvents = await Event.find(historicalEventQuery)
      .select('_id exhibitors paidTicketPrice isFreeEvent currency')
      .lean();
    const historicalEventIds = historicalEvents.map(event => event._id);
    const historicalAttendance = historicalEventIds.length
      ? await Visitor.aggregate([
          {
            $match: {
              event: { $in: historicalEventIds },
              registrationStatus: 'confirmed',
              attendanceType: 'in_person',
              checkInStatus: 'checked_in'
            }
          },
          { $group: { _id: '$event', checkedInCount: { $sum: 1 } } }
        ])
      : [];
    const attendanceByEvent = new Map(
      historicalAttendance.map(item => [String(item._id), item.checkedInCount])
    );
    const historicCheckedInCounts = historicalEvents
      .map(event => attendanceByEvent.get(String(event._id)) || 0)
      .filter(count => count > 0);
    const medianHistoricalAttendance = getMedian(historicCheckedInCounts);
    const medianHistoricalExhibitors = getMedian(
      historicalEvents
        .map(event => (event.exhibitors || []).length)
        .filter(count => count > 0)
    );
    const historicTicketPrices = historicalEvents
      .filter(event =>
        !event.isFreeEvent &&
        String(event.currency || 'INR').toUpperCase() === 'INR' &&
        Number(event.paidTicketPrice) > 0
      )
      .map(event => Number(event.paidTicketPrice));
    const medianHistoricalTicketPrice = getMedian(historicTicketPrices);

    const rangeStart = getUtcDayStart(now);
    const rangeEnd = rangeStart + 365 * DAY_IN_MS;
    const totalEventsPresent = presentEvents.length;
    const upcomingEvents = presentEvents.filter(e => {
      if (!e.startDate || !e.endDate) return false;
      const startDate = new Date(e.startDate);
      const endDate = new Date(e.endDate);
      return !Number.isNaN(startDate.getTime()) &&
        !Number.isNaN(endDate.getTime()) &&
        endDate >= startDate &&
        getUtcDayStart(startDate) > rangeStart &&
        getUtcDayStart(startDate) < rangeEnd;
    });
    const ongoingEvents = presentEvents.filter(e => {
      if (!e.startDate || !e.endDate) return false;
      const startDate = new Date(e.startDate);
      const endDate = new Date(e.endDate);
      return !Number.isNaN(startDate.getTime()) &&
        !Number.isNaN(endDate.getTime()) &&
        getUtcDayStart(startDate) <= rangeStart &&
        getUtcDayStart(endDate) >= rangeStart;
    });
    const pastEvents = presentEvents.filter(e => {
      if (!e.endDate) return false;
      const endDate = new Date(e.endDate);
      return !Number.isNaN(endDate.getTime()) && getUtcDayStart(endDate) < rangeStart;
    });
    const countActiveEvents = events => events.filter(event => {
      if (!event.endDate) return true;
      const endDate = new Date(event.endDate);
      return Number.isNaN(endDate.getTime()) || getUtcDayStart(endDate) >= rangeStart;
    }).length;
    const activeCompetitionCount = countActiveEvents(presentEvents);
    const allActiveCompetitionCount = countActiveEvents(cityEvents);
    const datedActiveCompetitionCount = presentEvents.filter(event => {
      if (!event.startDate || !event.endDate) return false;
      const startDate = new Date(event.startDate);
      const endDate = new Date(event.endDate);
      return !Number.isNaN(startDate.getTime()) &&
        !Number.isNaN(endDate.getTime()) &&
        endDate >= startDate &&
        getUtcDayStart(endDate) >= rangeStart;
    }).length;
    const dateDataCoverage = activeCompetitionCount === 0
      ? 1
      : datedActiveCompetitionCount / activeCompetitionCount;
    const peakConcurrentEvents = getPeakConcurrentEvents(presentEvents, rangeStart, rangeEnd);
    const hasCityListingData = cityEvents.length > 0;
    const hasIndustryListingData = hasCityListingData && (!selectedCategory || presentEvents.length > 0);
    const hasDateCompetitionData = hasIndustryListingData &&
      (activeCompetitionCount === 0 || datedActiveCompetitionCount > 0);

    // 2. Query delegate & trade visitor interest
    const eventSlugs = presentEvents.map(e => e.slug).filter(Boolean);
    const eventIds = presentEvents.map(e => e._id);
    const userQuery = categoryRegex
      ? {
          $and: [
            {
              $or: [
                { city: { $in: cityRegexList } },
                { preferredLocations: { $in: cityRegexList } }
              ]
            },
            { interests: { $regex: categoryRegex } }
          ]
        }
      : {
          $or: [
            { city: { $in: cityRegexList } },
            { preferredLocations: { $in: cityRegexList } }
          ]
        };

    const [engagementCount, registeredVisitorCount, leadInquiriesCount, localUserCount, venueRecords] = await Promise.all([
      EventEngagement.countDocuments({
        $and: [
          {
            $or: [
              { eventSlug: { $in: eventSlugs } },
              { eventId: { $in: eventIds.map(String) } }
            ]
          },
          { $or: [{ status: 'active' }, { status: { $exists: false } }] },
          { $or: [{ isInterested: true }, { type: { $in: ['interested', 'both'] } }] }
        ]
      }),
      Visitor.countDocuments({
        event: { $in: eventIds },
        $or: [{ registrationStatus: 'confirmed' }, { registrationStatus: { $exists: false } }]
      }),
      Lead.countDocuments({ event: { $in: eventIds }, status: { $ne: 'lost' } }),
      User.countDocuments(userQuery),
      Venue.find({ city: { $in: cityRegexList } })
        .select('name city totalArea bestSuited')
        .lean()
    ]);

    // Demand is based on measured platform activity rather than a fixed city baseline.
    const computedAudienceInterest = localUserCount + registeredVisitorCount + engagementCount + leadInquiriesCount;

    // 3. Category distribution in this location
    const categoryCounts = {};
    cityEvents.forEach(evt => {
      new Set(evt.categories || []).forEach(cat => {
        const c = (cat || '').trim();
        if (c) categoryCounts[c] = (categoryCounts[c] || 0) + 1;
      });
    });

    const topCategoriesInLocation = Object.entries(categoryCounts)
      .map(([name, count]) => ({
        name,
        count,
        sharePct: Math.round((count / Math.max(1, cityEvents.length)) * 100)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const audienceDemandPoints = clamp(
      Math.round(25 * Math.log1p(computedAudienceInterest) / Math.log1p(10000)),
      0,
      25
    );
    const competitionPoints = hasIndustryListingData
      ? Math.round(35 * (1 - Math.min(activeCompetitionCount, 30) / 30))
      : null;
    const upcomingDensityPoints = 10 * (1 - Math.min(upcomingEvents.length, 40) / 40);
    const dateOverlapPoints = 10 * (1 - Math.min(peakConcurrentEvents, 10) / 10);
    const dateOverlapScore = hasDateCompetitionData
      ? Math.round((upcomingDensityPoints + dateOverlapPoints) * dateDataCoverage)
      : null;
    const marketSaturationPoints = hasCityListingData
      ? Math.round(20 * (1 - Math.min(cityEvents.length, 60) / 60))
      : null;
    const scoreBreakdown = {
      audienceDemand: {
        score: audienceDemandPoints,
        maximum: 25,
        observed: `${computedAudienceInterest.toLocaleString()} platform activity records`,
        explanation: `${localUserCount} ${selectedCategory ? 'local accounts with a matching recorded interest' : 'local account records'} + ${registeredVisitorCount} confirmed registrations + ${engagementCount} active interest records + ${leadInquiriesCount} non-lost leads for matching city event listings. These records are not deduplicated people. Log-scaled against 10,000 records.`
      },
      competition: {
        score: competitionPoints,
        maximum: 35,
        observed: hasIndustryListingData
          ? `${activeCompetitionCount} active ${selectedCategory ? `${selectedCategory} ` : ''}events`
          : `Data Not Available — no matching ${selectedCategory} event listings`,
        explanation: hasIndustryListingData
          ? 'Published events in the selected sector with no end date or an end date today or later. Each event reduces this factor; it reaches zero at 30.'
          : 'Competition cannot be inferred from an empty matching directory.'
      },
      dateOverlap: {
        score: dateOverlapScore,
        maximum: 20,
        observed: hasDateCompetitionData
          ? `${upcomingEvents.length} upcoming in 12 months; peak overlap ${peakConcurrentEvents}; dates available for ${datedActiveCompetitionCount}/${activeCompetitionCount} active sector events`
          : 'Data Not Available — no usable comparable event dates',
        explanation: 'Half measures upcoming sector events (40-event benchmark); half measures the maximum number running on the same calendar days (10-event benchmark). The result is reduced when active events lack usable dates.'
      },
      marketSaturation: {
        score: marketSaturationPoints,
        maximum: 20,
        observed: hasCityListingData
          ? `${cityEvents.length} published events across all sectors`
          : 'Data Not Available — no city listings found',
        explanation: hasCityListingData
          ? 'All city-wide published listings, including past events, reflect historical market density. Current/future competition is separately counted above. Saturation reaches its cap at 60 listings.'
          : 'An empty directory does not establish that the real-world market is unsaturated.'
      }
    };
    const hasCompleteScoreInputs = Object.values(scoreBreakdown).every(factor => factor.score !== null);
    const feasibilityScore = hasCompleteScoreInputs
      ? Object.values(scoreBreakdown).reduce((total, factor) => total + factor.score, 0)
      : null;

    // 5. Align the recommendation with both the score and observed competition.
    const competitionDensity = !hasIndustryListingData
      ? 'Data Not Available'
      : activeCompetitionCount >= 12
      ? 'High'
      : activeCompetitionCount >= 5
      ? 'Moderate'
      : 'Low';
    let verdict;
    let verdictBadge;
    let verdictColor;
    let recommendationHeadline;
    const demandSummary = `${computedAudienceInterest.toLocaleString()} platform activity records`;
    const competitionSummary = `${activeCompetitionCount} active ${selectedCategory ? `${selectedCategory} ` : ''}competitors`;
    const marketSummary = `${allActiveCompetitionCount} active events across all sectors`;
    const timingSummary = `${upcomingEvents.length} upcoming in 12 months, with a peak overlap of ${peakConcurrentEvents}`;
    let decisionRationale = feasibilityScore === null
      ? `${cleanCity} has ${demandSummary}, but the VisitExpo directory does not contain enough matching city and sector listings with usable dates to calculate a reliable feasibility score.`
      : `${cleanCity} scores ${feasibilityScore}/100 from ${demandSummary}, ${competitionSummary}, ${marketSummary}, and ${timingSummary}.`;

    if (feasibilityScore === null) {
      verdict = 'INSUFFICIENT DATA — VALIDATE MARKET';
      verdictBadge = 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      verdictColor = 'amber';
      recommendationHeadline = `Data is insufficient to score ${cleanCity} for this sector.`;
      decisionRationale += ' Missing directory data is not treated as zero competition.';
    } else if (competitionDensity === 'High') {
      verdict = 'HIGH COMPETITION — CAREFUL TIMING REQUIRED';
      verdictBadge = 'bg-rose-500/10 text-rose-500 border-rose-500/20';
      verdictColor = 'rose';
      recommendationHeadline = `Differentiate carefully and avoid peak dates in ${cleanCity}.`;
      decisionRationale += ' Consider a distinct sub-sector or a date outside the observed peak overlap before committing.';
    } else if (audienceDemandPoints <= 5) {
      verdict = 'LOW RECORDED PLATFORM ACTIVITY — VALIDATE BEFORE LAUNCH';
      verdictBadge = 'bg-rose-500/10 text-rose-500 border-rose-500/20';
      verdictColor = 'rose';
      recommendationHeadline = `Validate buyer interest before committing to ${cleanCity}.`;
      decisionRationale += ' Current recorded platform activity is limited; validate demand with local buyers and trade associations first.';
    } else if (feasibilityScore >= 70) {
      verdict = 'HIGH POTENTIAL — RECOMMENDED TO LAUNCH';
      verdictBadge = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      verdictColor = 'emerald';
      recommendationHeadline = `Recorded platform activity supports launch planning in ${cleanCity}.`;
      decisionRationale += ' Current platform signals support launch planning; validate dates and buyer commitments before booking.';
    } else if (feasibilityScore >= 50) {
      verdict = 'MODERATE VIABILITY — TARGET A NICHE THEME';
      verdictBadge = 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      verdictColor = 'amber';
      recommendationHeadline = `Viable with distinctive positioning in ${cleanCity}.`;
      decisionRationale += ' Validate a focused audience and choose dates that avoid the busiest event window.';
    } else {
      verdict = 'CAUTIOUS VIABILITY — VALIDATE TIMING';
      verdictBadge = 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      verdictColor = 'amber';
      recommendationHeadline = `Validate demand and timing before launching in ${cleanCity}.`;
      decisionRationale += ' Secure buyer and exhibitor commitments before making a launch decision.';
    }

    // 6. Show historical-derived planning estimates only when there is a usable sample.
    const estimatedVisitorFootfall = historicCheckedInCounts.length >= 3
      ? `${Math.round(medianHistoricalAttendance).toLocaleString()} visitors (median checked-in attendance from ${historicCheckedInCounts.length} completed comparable events; estimate, not a guarantee)`
      : 'Data Not Available — fewer than 3 completed comparable events have check-in records';
    const historicalExhibitorCount = historicalEvents
      .map(event => (event.exhibitors || []).length)
      .filter(count => count > 0);
    const historicalExhibitorBenchmark = historicalExhibitorCount.length >= 3
      ? `${Math.round(medianHistoricalExhibitors).toLocaleString()} exhibitors (median listed across ${historicalExhibitorCount.length} completed comparable events; historical benchmark, not stall capacity)`
      : 'Data Not Available — fewer than 3 completed comparable events have exhibitor records';
    const historicalTicketPrice = historicTicketPrices.length >= 3
      ? `₹${Math.round(medianHistoricalTicketPrice).toLocaleString('en-IN')} median listed ticket price across ${historicTicketPrices.length} completed comparable events (historical reference only)`
      : 'Data Not Available — insufficient completed-event ticket-price records';
    const recommendedTicketStrategy = 'Data Not Available — verified buyer willingness-to-pay and conversion data are not collected.';
    const lowestCompetitionWindow = getRecommendedLaunchWindow(presentEvents, now, rangeEnd);

    // Venue directory records are shown as listings, not as verified availability.
    const venues = venueRecords.map(venue => ({
      name: venue.name,
      capacity: venue.totalArea || 'Data Not Available',
      type: venue.bestSuited || 'VisitExpo venue directory listing'
    }));

    // Build Response Data
    const intelligenceReport = {
      location: cleanCity,
      category: category || 'All Sectors',
      accessControl: {
        isFullAccess,
        userPlan,
        isIncludedInPlan: isPaidPlan || isSuperAdmin,
        unlockPrice: 4999,
        hasPaidFeasibilityUnlock,
        planBadgeText: isPaidPlan
          ? `Included with ${userPlan.toUpperCase()} Plan`
          : isSuperAdmin
          ? 'Super Admin Privileges'
          : hasPaidFeasibilityUnlock
          ? 'Unlocked via ₹4,999 Validation Pass'
          : 'Free Plan — Unlock for ₹4,999'
      },
      summary: {
        feasibilityScore,
        verdict,
        verdictBadge,
        verdictColor,
        recommendationHeadline,
        decisionRationale,
        totalEventsPresent,
        upcomingEventsCount: upcomingEvents.length,
        ongoingEventsCount: ongoingEvents.length,
        pastEventsCount: pastEvents.length,
        audienceInterestVolume: computedAudienceInterest,
        competitionDensity,
        industryCompetitionCount: activeCompetitionCount,
        allActiveCompetitionCount,
        peakConcurrentEventsNext12Months: peakConcurrentEvents,
        scoreBreakdown,
        dataAsOf: now.toISOString(),
        dataSourceLabel: 'VisitExpo event directory and recorded platform activity; listings are not independently verified.',
        estimatedVisitorFootfall,
        historicalExhibitorBenchmark,
        historicalTicketPrice,
        lowestCompetitionWindow,
        recommendedTicketStrategy,
        historicalComparableEventCount: historicalEvents.length,
      },
      // Detailed metrics (unlocked or blurred for free users)
      metrics: {
        buyerDemandIndex: Math.round((audienceDemandPoints / 25) * 100),
        competitionSaturationIndex: hasCityListingData
          ? Math.round((Math.min(cityEvents.length, 60) / 60) * 100)
          : null,
        venueDirectoryCount: venueRecords.length,
        exhibitorBookingReadiness: feasibilityScore === null ? null : feasibilityScore,
        localAccountRecords: localUserCount,
        confirmedEventRegistrations: registeredVisitorCount,
        activeInterestRecords: engagementCount,
        nonLostLeadRecords: leadInquiriesCount,
        topCategoriesInLocation
      },
      eventsPresent: isFullAccess
        ? presentEvents.map(e => ({
            id: e._id,
            title: e.title,
            slug: e.slug,
            venue: e.venue,
            city: e.city,
            startDate: e.startDate,
            endDate: e.endDate,
            categories: e.categories,
            banner: e.banner,
            isClaimed: e.isClaimed,
            viewCount: e.viewCount || 0,
            interestedCount: e.interestedCount || 0,
            isFreeEvent: e.isFreeEvent,
            paidTicketPrice: e.paidTicketPrice
          }))
        : presentEvents.slice(0, 2).map(e => ({
            id: e._id,
            title: e.title,
            slug: e.slug,
            venue: e.venue,
            city: e.city,
            startDate: e.startDate,
            endDate: e.endDate,
            categories: e.categories,
            isClaimed: e.isClaimed
          })),
      venues,
      swotAnalysis: {
        strengths: [
          ...(computedAudienceInterest > 0
            ? [`${computedAudienceInterest.toLocaleString()} platform activity records match this city and sector`]
            : []),
          ...(activeCompetitionCount === 0
            ? ['No active competing event listings were found in current platform data; validate off-platform competition']
            : []),
          ...(venueRecords.length > 0
            ? [`${venueRecords.length} venue directory records are available for this location`]
            : [])
        ],
        weaknesses: [
          ...(computedAudienceInterest === 0
            ? ['No platform activity records are currently available for the selected city and sector']
            : []),
          ...(activeCompetitionCount > 0
            ? [`${activeCompetitionCount} active ${selectedCategory ? `${selectedCategory} ` : ''}competitors; dates are available for ${datedActiveCompetitionCount} of them`]
            : []),
          ...(venueRecords.length === 0
            ? ['No venue directory records are available for this location']
            : [])
        ],
        opportunities: ['Data Not Available — the platform has no verified market-growth or buyer-conversion dataset.'],
        threats: ['Data Not Available — off-platform and nationwide event listings are not included in this analysis.']
      }
    };

    return intelligenceReport;
  }
}

export default new LocationFeasibilityService();
