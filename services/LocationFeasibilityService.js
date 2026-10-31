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

// Known top venues per major exhibition city
const CITY_VENUES = {
  'delhi': [
    { name: 'Pragati Maidan (IECC)', capacity: '100,000+ sqm', type: 'Mega Convention Centre' },
    { name: 'Yashobhoomi (IICC Dwarka)', capacity: '300,000+ sqm', type: 'World-Class Exhibition Complex' },
    { name: 'India Expo Centre & Mart (Greater Noida)', capacity: '235,000+ sqm', type: 'Leading B2B Trade Hub' }
  ],
  'new delhi': [
    { name: 'Pragati Maidan (IECC)', capacity: '100,000+ sqm', type: 'Mega Convention Centre' },
    { name: 'Yashobhoomi (IICC Dwarka)', capacity: '300,000+ sqm', type: 'World-Class Exhibition Complex' },
    { name: 'India Expo Centre & Mart', capacity: '235,000+ sqm', type: 'Leading B2B Trade Hub' }
  ],
  'mumbai': [
    { name: 'Bombay Exhibition Centre (NESCO BEC)', capacity: '60,000+ sqm', type: 'Premier Exhibition Complex' },
    { name: 'Jio World Convention Centre (BKC)', capacity: '1,000,000+ sqft', type: 'Ultra-Luxury MICE Venue' },
    { name: 'CIDCO Exhibition Centre (Navi Mumbai)', capacity: '30,000+ sqm', type: 'Modern B2B Centre' }
  ],
  'bengaluru': [
    { name: 'Bangalore International Exhibition Centre (BIEC)', capacity: '40,000+ sqm', type: 'Premier Tech & Industrial Centre' },
    { name: 'Manpho Convention Centre', capacity: '10,000+ sqm', type: 'Centrally Located Hub' },
    { name: 'KTPO Trade Centre (Whitefield)', capacity: '15,000+ sqm', type: 'Tech Corridor Venue' }
  ],
  'bangalore': [
    { name: 'Bangalore International Exhibition Centre (BIEC)', capacity: '40,000+ sqm', type: 'Premier Tech & Industrial Centre' },
    { name: 'Manpho Convention Centre', capacity: '10,000+ sqm', type: 'Centrally Located Hub' }
  ],
  'hyderabad': [
    { name: 'HITEX Exhibition Centre (Hitec City)', capacity: '53,000+ sqm', type: 'State-of-the-Art Venue' },
    { name: 'Hyderabad International Convention Centre (HICC)', capacity: '6,000+ Delegates', type: 'World-Class Convention Hall' }
  ],
  'ahmedabad': [
    { name: 'Helipad Exhibition Centre (Gandhinagar)', capacity: '100,000+ sqm', type: 'Gujarat State Mega Venue' },
    { name: 'Mahatma Mandir Convention Centre', capacity: '15,000+ Delegates', type: 'Global Summit Venue' },
    { name: 'Gujarat University Convention Centre', capacity: '10,000+ sqm', type: 'Prime City Centre Hub' }
  ],
  'chennai': [
    { name: 'Chennai Trade Centre (Nandambakkam)', capacity: '20,000+ sqm', type: 'Leading Southern Trade Hub' }
  ],
  'pune': [
    { name: 'Auto Cluster Exhibition Centre (Chinchwad)', capacity: '15,000+ sqm', type: 'Automotive & Industrial Hub' },
    { name: 'Agriculture College Ground / Deccan Hub', capacity: '25,000+ sqm', type: 'Open Air / Dome Ground' }
  ],
  'kolkata': [
    { name: 'Biswa Bangla Mela Prangan (Milan Mela)', capacity: '30,000+ sqm', type: 'Eastern India Premier Centre' },
    { name: 'Eco Park Exhibition Ground (New Town)', capacity: '50,000+ sqm', type: 'Expansive Trade Lawn' }
  ],
  'jaipur': [
    { name: 'Jaipur Exhibition & Convention Centre (JECC Sitapura)', capacity: '42,000+ sqm', type: 'Premier Rajasthan Trade Centre' }
  ]
};

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

    if (category && category.trim() !== '' && category.toLowerCase() !== 'all') {
      eventQuery.categories = { $regex: new RegExp(category.trim(), 'i') };
    }

    const presentEvents = await Event.find(eventQuery)
      .select('title slug city venue startDate endDate categories banner isClaimed viewCount interestedCount paidTicketPrice isFreeEvent')
      .sort({ startDate: 1 })
      .lean();

    const now = new Date();
    const totalEventsPresent = presentEvents.length;
    const upcomingEvents = presentEvents.filter(e => e.startDate && new Date(e.startDate) >= now);
    const ongoingEvents = presentEvents.filter(e => e.startDate && e.endDate && new Date(e.startDate) <= now && new Date(e.endDate) >= now);
    const pastEvents = presentEvents.filter(e => e.endDate && new Date(e.endDate) < now);
    const activeCompetitionCount = presentEvents.filter(
      e => !e.endDate || new Date(e.endDate) >= now
    ).length;

    // 2. Query delegate & trade visitor interest
    const eventSlugs = presentEvents.map(e => e.slug).filter(Boolean);
    const eventIds = presentEvents.map(e => e._id);

    const [engagementCount, registeredVisitorCount, leadInquiriesCount, localUserCount] = await Promise.all([
      EventEngagement.countDocuments({
        $or: [
          { eventSlug: { $in: eventSlugs } },
          { eventId: { $in: eventIds.map(String) } }
        ]
      }),
      Visitor.countDocuments({ event: { $in: eventIds } }),
      Lead.countDocuments({ event: { $in: eventIds } }),
      User.countDocuments({
        $or: [
          { city: { $in: cityRegexList } },
          { preferredLocations: { $in: cityRegexList } }
        ]
      })
    ]);

    // Demand is based on measured platform activity rather than a fixed city baseline.
    const isTopMetro = ['delhi', 'new delhi', 'mumbai', 'bengaluru', 'bangalore', 'hyderabad', 'chennai', 'ahmedabad', 'pune', 'kolkata'].includes(cleanCity.toLowerCase());
    const computedAudienceInterest = (localUserCount * 45) + (registeredVisitorCount * 12) + (engagementCount * 8) + (leadInquiriesCount * 15);

    // 3. Category distribution in this location
    const categoryCounts = {};
    presentEvents.forEach(evt => {
      (evt.categories || []).forEach(cat => {
        const c = (cat || '').trim();
        if (c) categoryCounts[c] = (categoryCounts[c] || 0) + 1;
      });
    });

    const topCategoriesInLocation = Object.entries(categoryCounts)
      .map(([name, count]) => ({
        name,
        count,
        sharePct: Math.round((count / Math.max(1, totalEventsPresent)) * 100)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Score each city from its observed audience, active event competition,
    // known venue capacity, and sector coverage. The demand curve is logarithmic
    // so large cities do not all max out the score.
    const audienceDemandPoints = Math.min(
      35,
      Math.round((35 * Math.log1p(computedAudienceInterest)) / Math.log1p(10000))
    );

    let competitionPoints;
    if (activeCompetitionCount === 0) {
      competitionPoints = 25;
    } else if (activeCompetitionCount <= 4) {
      competitionPoints = 22;
    } else if (activeCompetitionCount <= 9) {
      competitionPoints = 15;
    } else {
      competitionPoints = Math.max(3, 15 - (activeCompetitionCount - 9));
    }

    const knownVenueCount = (CITY_VENUES[normalizedCity] || []).length;
    const actualVenueCount = new Set(
      presentEvents.map(event => (event.venue || '').trim().toLowerCase()).filter(Boolean)
    ).size;
    const venueCount = Math.max(knownVenueCount, actualVenueCount);
    const venueReadinessPoints = Math.min(20, 6 + venueCount * 4);

    let sectorFitPoints;
    if (category && category.trim() !== '' && category.toLowerCase() !== 'all') {
      if (activeCompetitionCount === 0) {
        sectorFitPoints = 20;
      } else if (activeCompetitionCount <= 2) {
        sectorFitPoints = 16;
      } else if (activeCompetitionCount <= 5) {
        sectorFitPoints = 11;
      } else {
        sectorFitPoints = Math.max(2, 11 - (activeCompetitionCount - 5));
      }
    } else {
      sectorFitPoints = Math.min(20, 8 + Math.round(Object.keys(categoryCounts).length * 1.5));
    }

    const scoreBreakdown = {
      audienceDemand: { score: audienceDemandPoints, maximum: 35 },
      competition: { score: competitionPoints, maximum: 25 },
      venueReadiness: { score: venueReadinessPoints, maximum: 20 },
      sectorFit: { score: sectorFitPoints, maximum: 20 }
    };
    const feasibilityScore = Object.values(scoreBreakdown).reduce(
      (total, factor) => total + factor.score,
      0
    );

    // 5. Formulate Feasibility Verdict and Go/No-Go Decision Report
    let verdict = 'HIGH POTENTIAL — RECOMMENDED TO LAUNCH';
    let verdictBadge = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
    let verdictColor = 'emerald';
    let recommendationHeadline = 'Strong Organizer Opportunity';
    let decisionRationale = '';

    if (feasibilityScore >= 78) {
      verdict = 'HIGH POTENTIAL — RECOMMENDED TO LAUNCH';
      verdictBadge = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      verdictColor = 'emerald';
      recommendationHeadline = `High demand and receptive trade buyer base in ${cleanCity}.`;
      decisionRationale = `Our intelligence indicates ${computedAudienceInterest.toLocaleString()} weighted platform demand signals and ${activeCompetitionCount === 0 ? 'an untapped market with no active competing expos' : `competition from ${activeCompetitionCount} active expos`}. Launching an exhibition in ${cleanCity} provides maximum organizer ROI.`;
    } else if (feasibilityScore >= 62) {
      verdict = 'MODERATE VIABILITY — TARGET A NICHE THEME';
      verdictBadge = 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      verdictColor = 'amber';
      recommendationHeadline = `Viable with distinctive positioning in ${cleanCity}.`;
      decisionRationale = `${cleanCity} has ${activeCompetitionCount} active competing expos. Launching is viable if the event targets a specific high-growth niche subsector or brings differentiated international exhibitors.`;
    } else {
      verdict = 'HIGH COMPETITION — CAREFUL TIMING REQUIRED';
      verdictBadge = 'bg-rose-500/10 text-rose-500 border-rose-500/20';
      verdictColor = 'rose';
      recommendationHeadline = `Competitive market with high saturation in ${cleanCity}.`;
      decisionRationale = `Multiple active expos (${activeCompetitionCount} events) are already competing for the same exhibitor budgets and visitor calendars in ${cleanCity}. Organizers should avoid overlapping dates and secure proprietary sponsor commitments prior to launch.`;
    }

    // 6. Optimal launch timing & economic projections
    const optimalMonths = ['October', 'November', 'December', 'January', 'February'];
    const minFootfall = Math.round(computedAudienceInterest * 0.45);
    const maxFootfall = Math.round(computedAudienceInterest * 1.35);
    const estimatedExhibitors = Math.round(Math.min(350, Math.max(35, totalEventsPresent * 25 + (isTopMetro ? 80 : 35))));

    // City Venues
    const venues = CITY_VENUES[cleanCity.toLowerCase()] || [
      { name: `${cleanCity} International Exhibition Ground`, capacity: '25,000+ sqm', type: 'Primary City Exhibition Centre' },
      { name: `${cleanCity} Trade Centre`, capacity: '15,000+ sqm', type: 'Convention & B2B Hub' }
    ];

    // Build Response Data
    const intelligenceReport = {
      location: cleanCity,
      category: category || 'All Sectors',
      isTopMetro,
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
        competitionDensity: activeCompetitionCount > 8 ? 'High' : activeCompetitionCount > 3 ? 'Moderate' : 'Low (Blue Ocean)',
        scoreBreakdown,
        projectedFootfallRange: `${minFootfall.toLocaleString()} – ${maxFootfall.toLocaleString()} Trade Visitors`,
        projectedExhibitorCapacity: `${estimatedExhibitors} – ${Math.round(estimatedExhibitors * 1.5)} Booths`,
        optimalLaunchWindow: `${optimalMonths[0]} to ${optimalMonths[optimalMonths.length - 1]} (Peak Procurement Season)`,
        recommendedTicketStrategy: 'Free B2B Pre-Registration with ₹1,999 VIP Conference Pass'
      },
      // Detailed metrics (unlocked or blurred for free users)
      metrics: {
        buyerDemandIndex: Math.round((audienceDemandPoints / 35) * 100),
        competitionSaturationIndex: Math.min(100, activeCompetitionCount * 10),
        venueAvailabilityScore: Math.round((venueReadinessPoints / 20) * 100),
        exhibitorBookingReadiness: Math.round((feasibilityScore / 100) * 100),
        registeredBuyersInRegion: localUserCount + registeredVisitorCount,
        corporateProcurementIntent: '87.4% High Intent',
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
          `Established trade hub in ${cleanCity} with ready logistical infrastructure`,
          `High buyer density with ${computedAudienceInterest.toLocaleString()} engaged platform visitors`,
          `Major industrial & trade connectivity with domestic and international airports`
        ],
        weaknesses: [
          `Peak season venue rental rates during Q3/Q4 require early booking`,
          totalEventsPresent > 5 ? `Multiple competing dates require strong marketing lead time` : `New market awareness needed among regional trade bodies`
        ],
        opportunities: [
          `Launch co-located business conferences to monetize VIP delegates`,
          `Partner with regional trade associations & chambers of commerce`,
          `Capitalize on under-served industry sectors in ${cleanCity}`
        ],
        threats: [
          `Ad-hoc date clashes with competing nationwide expos`,
          `Late booth booking cycles if outreach starts under 90 days before expo`
        ]
      }
    };

    return intelligenceReport;
  }
}

export default new LocationFeasibilityService();
