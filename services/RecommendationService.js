/**
 * @file RecommendationService.js
 * @description Recommendation Engine for VisitExpo.
 * Suggests relevant trade exhibitions, B2B expos, and global summits based on:
 * - User geographic location (city, proximity, or coordinate radius)
 * - Industry & category interests (multi-select sectors, semantic clusters, keywords)
 * - Recency, timing, and upcoming schedule
 * - Social proof, attendee turnout, and engagement history
 */

import Event from '../models/Event.js';
import User from '../models/User.js';
import EventEngagement from '../models/EventEngagement.js';

// Semantic synonym clusters to match broader user interest keywords
const INTEREST_CLUSTERS = {
  technology: ['technology', 'it', 'software', 'ai', 'artificial intelligence', 'cloud', 'cybersecurity', 'telecom', 'tech', 'digital', 'saas', 'iot'],
  healthcare: ['medical', 'pharma', 'healthcare', 'health', 'hospital', 'clinical', 'biotech', 'dental', 'medicine', 'diagnostic'],
  automotive: ['auto', 'automotive', 'vehicle', 'mobility', 'ev', 'electric vehicle', 'car', 'components', 'motor', 'transport'],
  manufacturing: ['industrial', 'engineering', 'manufacturing', 'machinery', 'automation', 'tools', 'metal', 'fabrication', 'cnc', 'robotics'],
  food: ['food', 'beverage', 'culinary', 'hospitality', 'aahar', 'catering', 'bakery', 'organic', 'fmcg', 'dairy', 'kitchen'],
  construction: ['building', 'construction', 'architecture', 'interior', 'real estate', 'infrastructure', 'materials', 'ceramics', 'concrete'],
  energy: ['energy', 'power', 'solar', 'renewable', 'clean energy', 'electrical', 'elecrama', 'battery', 'wind', 'utilities'],
  textile: ['textile', 'apparel', 'garment', 'fashion', 'fabrics', 'cotton', 'yarn', 'silk', 'leather', 'clothing'],
  agriculture: ['agriculture', 'farming', 'agritech', 'horticulture', 'dairy', 'forestry', 'grain', 'fertilizers'],
  finance: ['finance', 'banking', 'fintech', 'insurance', 'investment', 'wealth', 'crypto', 'accounting'],
  education: ['education', 'training', 'learning', 'edtech', 'university', 'academic', 'careers', 'school']
};

// Known regional clusters (e.g. Delhi NCR)
const REGION_CLUSTERS = {
  'delhi': ['new delhi', 'delhi', 'noida', 'greater noida', 'gurugram', 'gurgaon', 'faridabad', 'ghaziabad'],
  'new delhi': ['new delhi', 'delhi', 'noida', 'greater noida', 'gurugram', 'gurgaon'],
  'mumbai': ['mumbai', 'navi mumbai', 'thane', 'pune'],
  'bengaluru': ['bengaluru', 'bangalore', 'mysuru', 'mysore'],
  'dubai': ['dubai', 'abu dhabi', 'sharjah', 'uae']
};

// Known city coordinates for proximity calculation
const CITY_COORDS = {
  'new delhi': { lat: 28.6139, lng: 77.2090 },
  'delhi': { lat: 28.6139, lng: 77.2090 },
  'mumbai': { lat: 19.0760, lng: 72.8777 },
  'greater noida': { lat: 28.4744, lng: 77.5040 },
  'bengaluru': { lat: 12.9716, lng: 77.5946 },
  'bangalore': { lat: 12.9716, lng: 77.5946 },
  'hyderabad': { lat: 17.3850, lng: 78.4867 },
  'chennai': { lat: 13.0827, lng: 80.2707 },
  'kolkata': { lat: 22.5726, lng: 88.3639 },
  'ahmedabad': { lat: 23.0225, lng: 72.5714 },
  'pune': { lat: 18.5204, lng: 73.8567 },
  'dubai': { lat: 25.2048, lng: 55.2708 },
  'london': { lat: 51.5074, lng: -0.1278 },
  'singapore': { lat: 1.3521, lng: 103.8198 }
};

function getDistanceKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

class RecommendationService {
  /**
   * Main recommendation engine query method
   */
  async getRecommendations({
    location = '',
    interests = '',
    lat = null,
    lng = null,
    userId = null,
    excludeEventId = null,
    limit = 10,
    timeframe = 'upcoming'
  }) {
    const now = new Date();
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));

    // 1. Gather User Context if logged in
    let userInterests = [];
    let userLocations = [];
    let userEngagedCategories = [];

    if (userId) {
      try {
        const user = await User.findById(userId).select('interests preferredLocations city');
        if (user) {
          if (Array.isArray(user.interests)) userInterests.push(...user.interests);
          if (Array.isArray(user.preferredLocations)) userLocations.push(...user.preferredLocations);
          if (user.city && !userLocations.includes(user.city)) userLocations.push(user.city);
        }

        // Pull categories from user's past engagements
        const engagements = await EventEngagement.find({ user: userId })
          .select('eventCategory')
          .limit(20);
        engagements.forEach((eng) => {
          if (eng.eventCategory && !userEngagedCategories.includes(eng.eventCategory)) {
            userEngagedCategories.push(eng.eventCategory);
          }
        });
      } catch (err) {
        console.warn('[RecommendationService] Could not pull user context:', err.message);
      }
    }

    // 2. Parse passed location and interest query params
    const queryLocations = (Array.isArray(location) ? location : location ? location.split(',') : [])
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);

    const queryInterests = (Array.isArray(interests) ? interests : interests ? interests.split(',') : [])
      .map((i) => i.trim().toLowerCase())
      .filter(Boolean);

    // Merge explicitly provided criteria with user profile criteria
    const targetLocations = Array.from(new Set([...queryLocations, ...userLocations.map((l) => l.toLowerCase())]));
    const targetInterests = Array.from(
      new Set([
        ...queryInterests,
        ...userInterests.map((i) => i.toLowerCase()),
        ...userEngagedCategories.map((c) => c.toLowerCase())
      ])
    );

    // 3. Fetch candidate events from database
    const query = {
      status: 'published'
    };

    if (excludeEventId) {
      query.$and = [
        { _id: { $ne: excludeEventId } },
        { slug: { $ne: excludeEventId } }
      ];
    }

    if (timeframe === 'upcoming') {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      query.$or = [
        { endDate: { $gte: yesterday } },
        { startDate: { $gte: yesterday } },
        { endDate: { $exists: false } }
      ];
    }

    const candidateEvents = await Event.find(query)
      .populate('organizer', 'name logo website')
      .lean();

    if (candidateEvents.length === 0) {
      return {
        success: true,
        count: 0,
        criteria: { targetLocations, targetInterests, timeframe },
        data: []
      };
    }

    // 4. Multi-Factor Scoring & Ranking Algorithm
    const scoredEvents = candidateEvents.map((ev) => {
      let score = 0;
      const matchReasons = [];
      const scoreBreakdown = {
        interest: 0,
        location: 0,
        recency: 0,
        social: 0
      };

      const evTitle = (ev.title || '').toLowerCase();
      const evDesc = (ev.description || '').toLowerCase();
      const evCity = (ev.city || '').toLowerCase();
      const evCountry = (ev.country || '').toLowerCase();
      const evVenue = (ev.venue || '').toLowerCase();
      const evCategories = (ev.categories || []).map((c) => c.toLowerCase());
      if (ev.category) evCategories.push(ev.category.toLowerCase());

      // =========================================================================
      // Factor 1: Industry & Interests Matching (Max 45 pts)
      // =========================================================================
      if (targetInterests.length > 0) {
        let bestInterestMatch = 0;
        let matchedInterestName = '';

        for (const interest of targetInterests) {
          if (!interest || interest === 'all') continue;

          // Direct category match
          const directMatch = evCategories.some((cat) => cat.includes(interest) || interest.includes(cat));
          if (directMatch) {
            if (bestInterestMatch < 42) {
              bestInterestMatch = 42;
              matchedInterestName = interest;
            }
          }

          // Semantic cluster expansion
          for (const [clusterKey, keywords] of Object.entries(INTEREST_CLUSTERS)) {
            const matchesInterest = keywords.some((k) => interest.includes(k) || k.includes(interest));
            if (matchesInterest) {
              const eventHasKeyword = keywords.some(
                (k) => evCategories.some((c) => c.includes(k)) || evTitle.includes(k) || evDesc.includes(k)
              );
              if (eventHasKeyword) {
                if (bestInterestMatch < 36) {
                  bestInterestMatch = 36;
                  matchedInterestName = interest;
                }
              }
            }
          }

          // Keyword in title
          if (evTitle.includes(interest)) {
            if (bestInterestMatch < 30) {
              bestInterestMatch = 30;
              matchedInterestName = interest;
            }
          }

          // Keyword in description
          if (evDesc.includes(interest)) {
            if (bestInterestMatch < 18) {
              bestInterestMatch = 18;
              matchedInterestName = interest;
            }
          }
        }

        scoreBreakdown.interest = bestInterestMatch;
        score += bestInterestMatch;

        if (matchedInterestName) {
          const formattedInterest = matchedInterestName.charAt(0).toUpperCase() + matchedInterestName.slice(1);
          matchReasons.push(`Matches your interest in ${formattedInterest}`);
        }
      } else {
        // Neutral interest baseline if no interest specified
        scoreBreakdown.interest = 20;
        score += 20;
      }

      // =========================================================================
      // Factor 2: Location & Proximity Matching (Max 35 pts)
      // =========================================================================
      if (targetLocations.length > 0) {
        let bestLocationMatch = 0;
        let matchedLocationName = '';

        for (const loc of targetLocations) {
          if (!loc || loc === 'all') continue;

          // Direct city match
          if (evCity === loc || evCity.includes(loc) || loc.includes(evCity)) {
            bestLocationMatch = Math.max(bestLocationMatch, 35);
            matchedLocationName = ev.city;
            break;
          }

          // Regional cluster match (e.g. Greater Noida matching Delhi NCR)
          const regionalCluster = REGION_CLUSTERS[loc] || [];
          if (regionalCluster.some((c) => evCity.includes(c) || c.includes(evCity))) {
            bestLocationMatch = Math.max(bestLocationMatch, 28);
            matchedLocationName = `${ev.city} (NCR)`;
            break;
          }

          // Venue matching location string
          if (evVenue.includes(loc)) {
            bestLocationMatch = Math.max(bestLocationMatch, 26);
            matchedLocationName = ev.venue.split(',')[0];
            break;
          }

          // Country match
          if (evCountry === loc || evCountry.includes(loc)) {
            bestLocationMatch = Math.max(bestLocationMatch, 16);
            matchedLocationName = ev.country;
          }
        }

        // Distance proximity if coordinates available
        if (lat && lng) {
          const userLat = parseFloat(lat);
          const userLng = parseFloat(lng);
          const cityCoord = CITY_COORDS[evCity];
          if (cityCoord) {
            const dist = getDistanceKm(userLat, userLng, cityCoord.lat, cityCoord.lng);
            if (dist !== null) {
              if (dist <= 60) {
                bestLocationMatch = Math.max(bestLocationMatch, 35);
                matchedLocationName = `${dist} km near you`;
              } else if (dist <= 180) {
                bestLocationMatch = Math.max(bestLocationMatch, 25);
                matchedLocationName = `Within ${dist} km`;
              }
            }
          }
        }

        scoreBreakdown.location = bestLocationMatch;
        score += bestLocationMatch;

        if (matchedLocationName) {
          matchReasons.push(`Hosted in ${matchedLocationName}`);
        }
      } else {
        // Neutral location baseline
        scoreBreakdown.location = 18;
        score += 18;
      }

      // =========================================================================
      // Factor 3: Timing, Recency & Event Readiness (Max 15 pts)
      // =========================================================================
      if (ev.startDate) {
        const start = new Date(ev.startDate);
        const end = ev.endDate ? new Date(ev.endDate) : start;
        const diffDays = Math.ceil((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (now >= start && now <= end) {
          // Event is happening right now
          scoreBreakdown.recency = 15;
          score += 15;
          matchReasons.push('Live Trade Fair Today');
        } else if (diffDays > 0 && diffDays <= 30) {
          // Happening within next 30 days
          scoreBreakdown.recency = 14;
          score += 14;
          matchReasons.push(`Starts soon in ${diffDays} days`);
        } else if (diffDays > 30 && diffDays <= 90) {
          scoreBreakdown.recency = 10;
          score += 10;
          matchReasons.push('Upcoming in next 3 months');
        } else if (diffDays > 90) {
          scoreBreakdown.recency = 6;
          score += 6;
        } else {
          // Concluded event
          scoreBreakdown.recency = 2;
          score += 2;
        }
      }

      // =========================================================================
      // Factor 4: Turnout & Verified Host Credibility (Max 5 pts)
      // =========================================================================
      if (ev.organizer || ev.orgName) {
        scoreBreakdown.social += 3;
        score += 3;
      }
      if (ev.attendeesCount && ev.attendeesCount > 5000) {
        scoreBreakdown.social += 2;
        score += 2;
      }

      // Normalize match score to percentage (60% to 99%)
      const matchScore = Math.min(99, Math.max(58, Math.round(score)));

      return {
        ...ev,
        matchScore,
        matchReasons: matchReasons.slice(0, 3),
        scoreBreakdown
      };
    });

    // 5. Sort by matchScore descending and take requested limit
    scoredEvents.sort((a, b) => b.matchScore - a.matchScore);
    const results = scoredEvents.slice(0, parsedLimit);

    return {
      success: true,
      count: results.length,
      totalMatched: scoredEvents.length,
      criteria: {
        targetLocations,
        targetInterests,
        timeframe
      },
      data: results
    };
  }

  /**
   * Save user recommendation preferences (cities & interests)
   */
  async saveUserPreferences(userId, { interests = [], preferredLocations = [] }) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (Array.isArray(interests)) {
      user.interests = Array.from(new Set(interests.map((i) => i.trim()))).filter(Boolean);
    }
    if (Array.isArray(preferredLocations)) {
      user.preferredLocations = Array.from(new Set(preferredLocations.map((l) => l.trim()))).filter(Boolean);
    }

    await user.save();
    return {
      interests: user.interests,
      preferredLocations: user.preferredLocations
    };
  }

  /**
   * Return metadata: distinct cities, top categories, and recommended clusters for UI pill bars
   */
  async getRecommendationMeta() {
    const [cities, categories] = await Promise.all([
      Event.distinct('city', { status: 'published' }),
      Event.distinct('categories', { status: 'published' })
    ]);

    const cleanCities = (cities || []).filter((c) => c && c.length > 2 && !/\d/.test(c)).sort();
    const cleanCategories = (categories || []).filter((c) => c && c.length > 2).sort();

    const curatedInterests = [
      'Technology & AI',
      'Healthcare & Pharma',
      'Manufacturing & Machinery',
      'Automotive & EV',
      'Food & Hospitality',
      'Building & Construction',
      'Renewable Energy',
      'Textiles & Garments',
      'Agriculture & Dairy',
      'Banking & FinTech',
      'Logistics & Supply Chain'
    ];

    return {
      success: true,
      cities: cleanCities.slice(0, 20),
      categories: cleanCategories.slice(0, 30),
      curatedInterests
    };
  }
}

export default new RecommendationService();
