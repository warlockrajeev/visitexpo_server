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
import '../models/Organization.js';
import User from '../models/User.js';
import EventEngagement from '../models/EventEngagement.js';
import WordPressDirectorySyncService from './WordPressDirectorySyncService.js';

// Semantic synonym clusters to match broader user interest keywords
const INTEREST_CLUSTERS = {
  technology: ['technology', 'software', 'artificial intelligence', 'cloud', 'cybersecurity', 'telecom', 'tech', 'digital', 'saas', 'iot', 'data center', 'semiconductor'],
  healthcare: ['medical', 'pharma', 'healthcare', 'health', 'hospital', 'clinical', 'biotech', 'dental', 'medicine', 'diagnostic', 'surgical', 'laboratory'],
  automotive: ['automotive', 'vehicle', 'mobility', 'electric vehicle', 'automechanika', 'motor', 'tyre', 'two-wheeler'],
  manufacturing: ['industrial', 'engineering', 'manufacturing', 'machinery', 'automation', 'tools', 'metal', 'fabrication', 'cnc', 'robotics', 'foundry', 'welding'],
  food: ['food', 'beverage', 'culinary', 'hospitality', 'aahar', 'catering', 'bakery', 'organic', 'fmcg', 'kitchen', 'horeca'],
  construction: ['building', 'construction', 'architecture', 'interior', 'real estate', 'infrastructure', 'ceramics', 'concrete', 'cement', 'hvac'],
  energy: ['energy', 'power', 'solar', 'renewable', 'clean energy', 'electrical', 'elecrama', 'battery', 'wind', 'utilities', 'hydrogen', 'powergen'],
  textile: ['textile', 'apparel', 'garment', 'fashion', 'fabrics', 'cotton', 'yarn', 'silk', 'leather', 'clothing', 'footwear'],
  agriculture: ['agriculture', 'farming', 'agritech', 'horticulture', 'dairy', 'forestry', 'grain', 'fertilizers', 'poultry', 'livestock'],
  finance: ['finance', 'banking', 'fintech', 'insurance', 'investment', 'wealth', 'crypto', 'accounting', 'payments'],
  logistics: ['logistics', 'cargo', 'supply chain', 'warehousing', 'freight', 'shipping', 'maritime', 'aviation'],
  tourism: ['tourism', 'travel', 'hotel', 'leisure', 'destination', 'tour'],
  education: ['education', 'training', 'learning', 'edtech', 'university', 'academic', 'careers', 'school']
};

const SECTOR_DEFINITIONS = [
  {
    id: 'healthcare',
    query: 'healthcare',
    label: 'Healthcare & Pharma',
    regex: /\b(medicall|medical|pharma|pharmaceutical|healthcare|hospital|dental|biotech|biotechnology|ayurveda|ayush|lifescience|diagnostics|diagnostic|clinical|surgical|orthopaedic|ophthalmic|oncology|cardiology|neurology|neuroscience|nursing|nutraceutical|vaccine|medicines|pathology|radiology|labexpo|medtech|healthtech|pharmaexpo|cphi)\b/i
  },
  {
    id: 'automotive',
    query: 'automotive',
    label: 'Automotive & EV',
    regex: /\b(automotive|automobile|automechanika|auto\s+expo|motor\s+show|electric\s+vehicle|ev\s+expo|e-mobility|bharat\s+mobility|two-wheeler|tyre|tire|autoparts|auto\s+components|car\s+show|commercial\s+vehicle|charging\s+infrastructure|fleet\s+transport)\b/i
  },
  {
    id: 'construction',
    query: 'construction',
    label: 'Construction & Infra',
    regex: /\b(construction|buildcon|build\s+expo|building\s+materials|concrete|cement|ceramics|ceramic|architecture|architectural|interior\s+design|interiors|real\s+estate|infrastructure|hvac|plumbing|fenestration|zak\s+doors|facade|roofing|flooring|marble|stone\s+fair|bauma|conmach|acetech|smart\s+cities|urban\s+infra|elevator|escalator|woodworking|glass\s+expo|glasspex|glasspro|water\s+expo|wastewater|bath\s+and\s+sanitary)\b/i
  },
  {
    id: 'food',
    query: 'food',
    label: 'Food & Hospitality',
    regex: /\b(food|beverage|beverages|hospitality|aahar|bakery|culinary|catering|horeca|restaurant|confectionery|snacks|spices|tea\s+and\s+coffee|wine|spirits|fmcg|organic\s+food|halal|foodtech|propack|food\s+processing|nutritional|sweet|gourmet|hotel\s+supplies|annapoorna|indusfood|sial|gulfood|anuga)\b/i
  },
  {
    id: 'textile',
    query: 'textile',
    label: 'Textiles & Fashion',
    regex: /\b(textile|textiles|apparel|garment|garments|fashion|fabric|fabrics|yarn|weaving|knitting|denim|leather|footwear|handloom|home\s+textiles|embroidery|dyeing|hosiery|lingerie|sportswear|clothing|texprocil|bharat\s+tex|intex|gartex|texprocess|heimtextil)\b/i
  },
  {
    id: 'agriculture',
    query: 'agriculture',
    label: 'Agriculture & Dairy',
    regex: /\b(agriculture|agricultural|agritech|agri\s+expo|kisan|farming|horticulture|floriculture|dairy|poultry|livestock|aquaculture|fisheries|fertilizer|pesticide|seed|grain|rice|millets|tractor|irrigation|agronomic|turf\s+machinery|commercial\s+landscaping|agro|agroworld|krishi|forestry|organic\s+farming)\b/i
  },
  {
    id: 'energy',
    query: 'energy',
    label: 'Renewable Energy',
    regex: /\b(renewable\s+energy|solar|wind\s+energy|clean\s+energy|green\s+energy|powergen|power\s+and\s+energy|power\s+generation|utility\s+week|elecrama|electrical|electricity|battery\s+show|energy\s+storage|hydrogen|bioenergy|biofuel|smart\s+grid|utilities|oil\s+and\s+gas|petroleum|refining|petrochemical|nuclear|coal|rei\s+expo|intersolar)\b/i
  },
  {
    id: 'finance',
    query: 'finance',
    label: 'Finance & FinTech',
    regex: /\b(finance|financial|fintech|banking|insurance|insurtech|investment|wealth\s+management|blockchain|crypto|cryptocurrency|web3|payments|capital\s+markets|stock\s+exchange|accounting|taxation|audit|venture\s+capital|private\s+equity|bfsi)\b/i
  },
  {
    id: 'manufacturing',
    query: 'manufacturing',
    label: 'Manufacturing & Machinery',
    regex: /\b(manufacturing|machinery|machine\s+tool|machine\s+tools|imtex|engimach|engiexpo|industrial\s+exhibition|automation|robotics|industrial\s+engineering|metalworking|metallurgy|foundry|casting|forging|welding|laser|cnc|hydraulics|pneumatics|pumps|valves|fasteners|bearings|packaging|pack\s+expo|induspack|plastindia|plasto|plastics|polymers|recycling|prs\s+india|rubber|chemical|chemicals|coatings|paintindia|corrugated|printpack|printing|propaper|paper\s+expo|wire\s+and\s+cable|wire\s*&\s*cable|cable\s+and\s+wire|cable\s*&\s*wire|tube\s+fair|intec|acmee|subcon|tooltech)\b/i
  },
  {
    id: 'technology',
    query: 'technology',
    label: 'Technology & AI',
    regex: /\b(technology|artificial\s+intelligence|ai\s+india|ai\s+summit|ai\s+expo|gitex|gartner|it\s+symposium|cio\s+symposium|cybersecurity|cyber\s+security|cyber-physical|cloud\s+computing|software|saas|iot|internet\s+of\s+things|data\s+center|big\s+data|analytics|semiconductor|semicon|electronics|electronica|productronica|embedded|telecom|5g|6g|devsecops|devops|quantum|virtual\s+reality|augmented\s+reality|metaverse|gaming|esports|it\s+expo|tech\s+summit|tech\s+expo|et\s+tech|india\s+mobile\s+congress|convergence\s+india|infocomm|broadcast|av\s+integration|smart\s+cards|biometrics|drone|uav|space\s+tech)\b/i
  },
  {
    id: 'logistics',
    query: 'logistics',
    label: 'Logistics & Cargo',
    regex: /\b(logistics|supply\s+chain|warehousing|warehouse|cargo|freight|shipping|maritime|ports|cold\s+chain|material\s+handling|intralogistics|air\s+cargo|transport\s+and\s+logistics|logimat|fleet\s+management|rail\s+transport|aviation|aerospace)\b/i
  },
  {
    id: 'tourism',
    query: 'tourism',
    label: 'Travel & Tourism',
    regex: /\b(tourism|travel\s+mart|travel\s+and\s+tourism|ttf|otm|satte|iitbm|leisure|destination|cruise|mice\s+tourism|holiday\s+expo)\b/i
  },
  {
    id: 'education',
    query: 'education',
    label: 'Education & Training',
    regex: /\b(education|edtech|schools?\s+exhibition|university\s+fair|study\s+abroad|academic\s+summit|didac|skill\s+development|higher\s+education)\b/i
  }
];

const NON_SECTOR_SHOW_REGEX = /\b(pet\s+trade|pet\s+care|pet\s+universe|pet\s+industry|zooexpo|interzoo|anido|iiptf|aquagic|bridal|wedding|jewellery|jewelry|gems|gifts?\s+fair|stationery|toys?\s+fair|book\s+fair|lifestyle\s+fair|trade\s+fair|fanciers)\b/i;

function sanitizeSectorText(str) {
  return String(str || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/state-of-the-art/gi, 'modern')
    .replace(/state\s+of\s+the\s+art/gi, 'modern');
}

function classifyEventSector(event) {
  if (!event || typeof event !== 'object') return 'Trade & Industry';
  const titleText = sanitizeSectorText(event.title || event.name || '');

  if (NON_SECTOR_SHOW_REGEX.test(titleText)) {
    return 'Trade & Industry';
  }

  for (const sector of SECTOR_DEFINITIONS) {
    if (sector.regex.test(titleText)) return sector.label;
  }

  // Respect explicit non-generic category metadata before falling back to description heuristics
  const rawCats = [
    ...(Array.isArray(event.categories) ? event.categories : []),
    event.category
  ]
    .map((c) => String(c || '').trim())
    .filter(Boolean);

  for (const cat of rawCats) {
    if (/^(trade\s*&?\s*industry|general|uncategorized|featured|events?|expo|trade\s+shows?)$/i.test(cat)) {
      continue;
    }
    for (const sector of SECTOR_DEFINITIONS) {
      if (sector.label.toLowerCase() === cat.toLowerCase() || sector.regex.test(cat)) {
        return sector.label;
      }
    }
    return cat;
  }

  const descPreview = sanitizeSectorText(`${event.shortDescription || ''} ${String(event.description || '').slice(0, 350)}`);
  if (NON_SECTOR_SHOW_REGEX.test(descPreview)) {
    return 'Trade & Industry';
  }

  // Pick the sector with the most keyword matches in the intro snippet rather than first-array-order bias
  let bestLabel = 'Trade & Industry';
  let bestCount = 0;
  for (const sector of SECTOR_DEFINITIONS) {
    const globalRe = new RegExp(sector.regex.source, 'gi');
    const matches = descPreview.match(globalRe);
    if (matches && matches.length > bestCount) {
      bestCount = matches.length;
      bestLabel = sector.label;
    }
  }

  return bestLabel;
}

function matchEventToSector(event, interestQuery) {
  if (!event || !interestQuery) return { matched: false, score: 0, label: '' };
  const q = String(interestQuery).trim().toLowerCase();
  if (!q || q === 'all') return { matched: true, score: 30, label: 'All Sectors' };

  const sector = SECTOR_DEFINITIONS.find(
    (s) =>
      s.query === q ||
      s.id === q ||
      s.label.toLowerCase() === q ||
      s.label.toLowerCase().includes(q) ||
      q.includes(s.query)
  );

  const titleText = sanitizeSectorText(event.title || event.name || '');
  const descText = sanitizeSectorText(`${event.shortDescription || ''} ${event.description || ''}`);
  const inferredCategory = classifyEventSector(event);

  if (sector) {
    if (NON_SECTOR_SHOW_REGEX.test(titleText) || NON_SECTOR_SHOW_REGEX.test(descText)) {
      return { matched: false, score: 0, label: sector.label };
    }
    if (sector.regex.test(titleText)) {
      return { matched: true, score: 45, label: sector.label };
    }
    if (inferredCategory.toLowerCase() === sector.label.toLowerCase()) {
      return { matched: true, score: 40, label: sector.label };
    }
    return { matched: false, score: 0, label: sector.label };
  }

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRegex = new RegExp(`\\b${escaped}\\b`, 'i');
  if (wordRegex.test(titleText)) {
    return { matched: true, score: 42, label: interestQuery };
  }
  if (wordRegex.test(inferredCategory)) {
    return { matched: true, score: 38, label: interestQuery };
  }
  return { matched: false, score: 0, label: interestQuery };
}

// Known regional clusters (e.g. Delhi NCR)
const REGION_CLUSTERS = {
  'delhi ncr': ['new delhi', 'delhi', 'noida', 'greater noida', 'gurugram', 'gurgaon', 'faridabad', 'ghaziabad'],
  'delhi': ['new delhi', 'delhi', 'noida', 'greater noida', 'gurugram', 'gurgaon', 'faridabad', 'ghaziabad'],
  'new delhi': ['new delhi', 'delhi', 'noida', 'greater noida', 'gurugram', 'gurgaon'],
  'greater noida': ['greater noida', 'noida', 'new delhi', 'delhi'],
  'mumbai': ['mumbai', 'navi mumbai', 'thane', 'pune'],
  'bengaluru': ['bengaluru', 'bangalore', 'mysuru', 'mysore'],
  'dubai': ['dubai', 'abu dhabi', 'sharjah', 'uae']
};

// In-memory cache for candidate events to respond in sub-millisecond time
let candidateEventsCache = null;
let candidateCacheTimestamp = 0;
const CANDIDATE_CACHE_TTL = 10 * 60 * 1000; // 10 mins

// Known city & venue coordinates for proximity calculation
const CITY_COORDS = {
  'mumbai': { lat: 19.0760, lng: 72.8777, name: 'Mumbai' },
  'navi mumbai': { lat: 19.0330, lng: 73.0297, name: 'Navi Mumbai' },
  'thane': { lat: 19.2183, lng: 72.9781, name: 'Thane' },
  'new delhi': { lat: 28.6139, lng: 77.2090, name: 'New Delhi' },
  'delhi': { lat: 28.6139, lng: 77.2090, name: 'New Delhi' },
  'greater noida': { lat: 28.4744, lng: 77.5040, name: 'Greater Noida' },
  'noida': { lat: 28.5355, lng: 77.3910, name: 'Noida' },
  'gurugram': { lat: 28.4595, lng: 77.0266, name: 'Gurugram' },
  'gurgaon': { lat: 28.4595, lng: 77.0266, name: 'Gurugram' },
  'faridabad': { lat: 28.4089, lng: 77.3178, name: 'Faridabad' },
  'ghaziabad': { lat: 28.6692, lng: 77.4538, name: 'Ghaziabad' },
  'bengaluru': { lat: 12.9716, lng: 77.5946, name: 'Bengaluru' },
  'bangalore': { lat: 12.9716, lng: 77.5946, name: 'Bengaluru' },
  'hyderabad': { lat: 17.3850, lng: 78.4867, name: 'Hyderabad' },
  'secunderabad': { lat: 17.4399, lng: 78.4983, name: 'Hyderabad' },
  'chennai': { lat: 13.0827, lng: 80.2707, name: 'Chennai' },
  'kolkata': { lat: 22.5726, lng: 88.3639, name: 'Kolkata' },
  'ahmedabad': { lat: 23.0225, lng: 72.5714, name: 'Ahmedabad' },
  'gandhinagar': { lat: 23.2156, lng: 72.6369, name: 'Gandhinagar' },
  'pune': { lat: 18.5204, lng: 73.8567, name: 'Pune' },
  'raipur': { lat: 21.2514, lng: 81.6296, name: 'Raipur' },
  'nagpur': { lat: 21.1458, lng: 79.0882, name: 'Nagpur' },
  'bhubaneswar': { lat: 20.2961, lng: 85.8245, name: 'Bhubaneswar' },
  'indore': { lat: 22.7196, lng: 75.8577, name: 'Indore' },
  'bhopal': { lat: 23.2599, lng: 77.4126, name: 'Bhopal' },
  'jaipur': { lat: 26.9124, lng: 75.7873, name: 'Jaipur' },
  'surat': { lat: 21.1702, lng: 72.8311, name: 'Surat' },
  'vadodara': { lat: 22.3072, lng: 73.1812, name: 'Vadodara' },
  'rajkot': { lat: 22.3039, lng: 70.8022, name: 'Rajkot' },
  'coimbatore': { lat: 11.0168, lng: 76.9558, name: 'Coimbatore' },
  'kochi': { lat: 9.9312, lng: 76.2673, name: 'Kochi' },
  'goa': { lat: 15.4909, lng: 73.8278, name: 'Goa' },
  'lucknow': { lat: 26.8467, lng: 80.9462, name: 'Lucknow' },
  'kanpur': { lat: 26.4499, lng: 80.3319, name: 'Kanpur' },
  'chandigarh': { lat: 30.7333, lng: 76.7794, name: 'Chandigarh' },
  'ludhiana': { lat: 30.9010, lng: 75.8573, name: 'Ludhiana' },
  'patna': { lat: 25.5941, lng: 85.1376, name: 'Patna' },
  'ranchi': { lat: 23.3441, lng: 85.3096, name: 'Ranchi' },
  'visakhapatnam': { lat: 17.6868, lng: 83.2185, name: 'Visakhapatnam' },
  'vijayawada': { lat: 16.5062, lng: 80.6480, name: 'Vijayawada' },
  'guwahati': { lat: 26.1445, lng: 91.7362, name: 'Guwahati' },
  'agra': { lat: 27.1767, lng: 78.0081, name: 'Agra' },
  'varanasi': { lat: 25.3176, lng: 82.9739, name: 'Varanasi' },
  'nashik': { lat: 19.9975, lng: 73.7898, name: 'Nashik' },
  'madurai': { lat: 9.9252, lng: 78.1198, name: 'Madurai' },
  'udaipur': { lat: 24.5854, lng: 73.7125, name: 'Udaipur' },
  'dehradun': { lat: 30.3165, lng: 78.0322, name: 'Dehradun' },
  'amritsar': { lat: 31.6340, lng: 74.8723, name: 'Amritsar' },
  'jalandhar': { lat: 31.3260, lng: 75.5762, name: 'Jalandhar' },
  'thiruvananthapuram': { lat: 8.5241, lng: 76.9366, name: 'Thiruvananthapuram' },
  'shriram business park': { lat: 21.2514, lng: 81.6296, name: 'Raipur' },
  'pt dindayal': { lat: 21.2355, lng: 81.6033, name: 'Raipur' },
  'science college ground raipur': { lat: 21.2469, lng: 81.6085, name: 'Raipur' },
  'babylon capital': { lat: 21.2408, lng: 81.6660, name: 'Raipur' },
  'pragati maidan': { lat: 28.6186, lng: 77.2435, name: 'New Delhi' },
  'bharat mandapam': { lat: 28.6186, lng: 77.2435, name: 'New Delhi' },
  'yashobhoomi': { lat: 28.5712, lng: 77.0439, name: 'New Delhi' },
  'india expo centre': { lat: 28.4619, lng: 77.4988, name: 'Greater Noida' },
  'bombay exhibition centre': { lat: 19.1551, lng: 72.8532, name: 'Mumbai' },
  'jio world convention centre': { lat: 19.0633, lng: 72.8687, name: 'Mumbai' },
  'cidco exhibition centre': { lat: 19.0660, lng: 72.9996, name: 'Navi Mumbai' },
  'biec': { lat: 13.0645, lng: 77.4815, name: 'Bengaluru' },
  'hitex': { lat: 17.4721, lng: 78.3756, name: 'Hyderabad' },
  'chennai trade centre': { lat: 13.0135, lng: 80.1873, name: 'Chennai' },
  'dubai': { lat: 25.2048, lng: 55.2708, name: 'Dubai' },
  'abu dhabi': { lat: 24.4539, lng: 54.3773, name: 'Abu Dhabi' },
  'sharjah': { lat: 25.3463, lng: 55.4209, name: 'Sharjah' },
  'riyadh': { lat: 24.7136, lng: 46.6753, name: 'Riyadh' },
  'jeddah': { lat: 21.4858, lng: 39.1925, name: 'Jeddah' },
  'doha': { lat: 25.2854, lng: 51.5310, name: 'Doha' },
  'muscat': { lat: 23.5880, lng: 58.3829, name: 'Muscat' },
  'london': { lat: 51.5074, lng: -0.1278, name: 'London' },
  'singapore': { lat: 1.3521, lng: 103.8198, name: 'Singapore' },
  'bangkok': { lat: 13.7563, lng: 100.5018, name: 'Bangkok' },
  'kuala lumpur': { lat: 3.1390, lng: 101.6869, name: 'Kuala Lumpur' },
  'jakarta': { lat: -6.2088, lng: 106.8456, name: 'Jakarta' },
  'ho chi minh city': { lat: 10.8231, lng: 106.6297, name: 'Ho Chi Minh City' },
  'colombo': { lat: 6.9271, lng: 79.8612, name: 'Colombo' },
  'dhaka': { lat: 23.8103, lng: 90.4125, name: 'Dhaka' },
  'paris': { lat: 48.8566, lng: 2.3522, name: 'Paris' },
  'frankfurt': { lat: 50.1109, lng: 8.6821, name: 'Frankfurt' },
  'berlin': { lat: 52.5200, lng: 13.4050, name: 'Berlin' },
  'tokyo': { lat: 35.6762, lng: 139.6503, name: 'Tokyo' },
  'shanghai': { lat: 31.2304, lng: 121.4737, name: 'Shanghai' },
  'las vegas': { lat: 36.1699, lng: -115.1398, name: 'Las Vegas' },
  'new york': { lat: 40.7128, lng: -74.0060, name: 'New York' },
  'chicago': { lat: 41.8781, lng: -87.6298, name: 'Chicago' },
  'orlando': { lat: 28.5383, lng: -81.3792, name: 'Orlando' },
  'toronto': { lat: 43.6532, lng: -79.3832, name: 'Toronto' }
};

const SORTED_COORD_ENTRIES = Object.entries(CITY_COORDS).sort((a, b) => b[0].length - a[0].length);

function getDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const numLat1 = Number(lat1);
  const numLon1 = Number(lon1);
  const numLat2 = Number(lat2);
  const numLon2 = Number(lon2);
  if (isNaN(numLat1) || isNaN(numLon1) || isNaN(numLat2) || isNaN(numLon2)) return null;
  const R = 6371;
  const dLat = ((numLat2 - numLat1) * Math.PI) / 180;
  const dLon = ((numLon2 - numLon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((numLat1 * Math.PI) / 180) *
      Math.cos((numLat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function resolveEventCoords(ev) {
  if (!ev) return null;
  const lat = ev.lat || ev.latitude || ev.mapLat;
  const lng = ev.lng || ev.longitude || ev.mapLng;
  if (lat && lng && !isNaN(Number(lat)) && !isNaN(Number(lng)) && Number(lat) !== 0 && Number(lng) !== 0) {
    return { lat: Number(lat), lng: Number(lng) };
  }

  const venue = String(ev.venue || '').trim().toLowerCase();
  if (venue) {
    for (const [key, coords] of SORTED_COORD_ENTRIES) {
      if (venue.includes(key)) return coords;
    }
  }

  const city = String(ev.city || '').trim().toLowerCase();
  if (city && city !== 'india') {
    if (CITY_COORDS[city]) return CITY_COORDS[city];
    for (const [key, coords] of SORTED_COORD_ENTRIES) {
      if (city.includes(key)) return coords;
    }
  }

  const stateOrAddr = String(ev.address || ev.state || '').trim().toLowerCase();
  if (stateOrAddr) {
    for (const [key, coords] of SORTED_COORD_ENTRIES) {
      if (stateOrAddr.includes(key)) return coords;
    }
  }

  const title = String(ev.title || '').trim().toLowerCase();
  if (title) {
    for (const [key, coords] of SORTED_COORD_ENTRIES) {
      if (key.length >= 4 && title.includes(key)) return coords;
    }
  }

  return null;
}

function doesEventMatchLocations(ev, selectedLocations) {
  if (!ev) return false;
  const tokens = (Array.isArray(selectedLocations) ? selectedLocations : String(selectedLocations || '').split(','))
    .flatMap((s) => String(s || '').split(','))
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && s !== 'all');

  if (tokens.length === 0) return true;

  const evCity = String(ev.city || '').trim().toLowerCase();
  const evVenue = String(ev.venue || '').trim().toLowerCase();
  const evState = String(ev.state || '').trim().toLowerCase();
  const evCountry = String(ev.country || '').trim().toLowerCase();
  const evTitle = String(ev.title || '').trim().toLowerCase();

  const isDelhiNcrCluster =
    tokens.includes('delhi ncr') ||
    (tokens.includes('new delhi') && tokens.includes('greater noida'));

  if (isDelhiNcrCluster) {
    const ncrKeywords = ['new delhi', 'delhi', 'greater noida', 'noida', 'gurugram', 'gurgaon', 'faridabad', 'ghaziabad', 'pragati maidan', 'bharat mandapam', 'yashobhoomi', 'india expo centre'];
    if (ncrKeywords.some((k) => evCity.includes(k) || evVenue.includes(k) || evState.includes(k))) {
      return true;
    }
    if ((!evCity || evCity === 'india') && ncrKeywords.some((k) => evTitle.includes(k))) {
      return true;
    }
    if (tokens.length <= 2 && tokens.every((t) => ['delhi ncr', 'new delhi', 'greater noida'].includes(t))) {
      return false;
    }
  }

  return tokens.some((loc) => {
    if (loc === 'new delhi' || loc === 'delhi') {
      if (evCity.includes('greater noida') || evCity === 'noida') return false;
      if (evCity === 'new delhi' || evCity === 'delhi' || evCity.includes('new delhi')) return true;
      if (evVenue.includes('new delhi') || evVenue.includes('pragati maidan') || evVenue.includes('bharat mandapam') || evVenue.includes('yashobhoomi')) return true;
      if ((!evCity || evCity === 'india') && (evTitle.includes('new delhi') || evTitle.includes(' delhi'))) return true;
      return false;
    }

    if (loc === 'greater noida') {
      if (evCity === 'new delhi' || evCity === 'delhi') return false;
      if (evCity.includes('greater noida') || evCity === 'noida') return true;
      if ((!evCity || evCity === 'india') && (evVenue.includes('greater noida') || evTitle.includes('greater noida'))) return true;
      return false;
    }

    if (loc === 'noida') {
      if (evCity === 'noida' || evCity.includes('greater noida')) return true;
      if (evVenue.includes('noida')) return true;
      return false;
    }

    if (loc === 'mumbai') {
      const mumbaiKeys = ['mumbai', 'navi mumbai', 'bombay', 'jio world', 'bombay exhibition', 'nesco', 'cidco'];
      if (mumbaiKeys.some((k) => evCity.includes(k) || evVenue.includes(k))) return true;
      if ((!evCity || evCity === 'india') && mumbaiKeys.some((k) => evTitle.includes(k))) return true;
      return false;
    }

    if (loc === 'bengaluru' || loc === 'bangalore') {
      const blrKeys = ['bengaluru', 'bangalore', 'biec'];
      if (blrKeys.some((k) => evCity.includes(k) || evVenue.includes(k))) return true;
      if ((!evCity || evCity === 'india') && blrKeys.some((k) => evTitle.includes(k))) return true;
      return false;
    }

    if (loc === 'hyderabad') {
      const hydKeys = ['hyderabad', 'secunderabad', 'hitex'];
      if (hydKeys.some((k) => evCity.includes(k) || evVenue.includes(k))) return true;
      if ((!evCity || evCity === 'india') && hydKeys.some((k) => evTitle.includes(k))) return true;
      return false;
    }

    if (loc === 'chennai') {
      const maaKeys = ['chennai', 'madras', 'chennai trade centre'];
      if (maaKeys.some((k) => evCity.includes(k) || evVenue.includes(k))) return true;
      if ((!evCity || evCity === 'india') && maaKeys.some((k) => evTitle.includes(k))) return true;
      return false;
    }

    if (loc === 'dubai' || loc === 'dubai (uae)') {
      const dxbKeys = ['dubai', 'uae', 'united arab emirates', 'abu dhabi', 'sharjah'];
      if (dxbKeys.some((k) => evCity.includes(k) || evVenue.includes(k) || evCountry.includes(k))) return true;
      if (dxbKeys.some((k) => evTitle.includes(k))) return true;
      return false;
    }

    if (evCity === loc || evCity.includes(loc) || evVenue.includes(loc) || evState === loc) return true;
    if ((!evCity || evCity === 'india') && evTitle.includes(loc)) return true;
    return false;
  });
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
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

    const userLat = lat !== null && lat !== undefined && lat !== '' ? parseFloat(lat) : null;
    const userLng = lng !== null && lng !== undefined && lng !== '' ? parseFloat(lng) : null;
    const hasCoords = userLat !== null && userLng !== null && !isNaN(userLat) && !isNaN(userLng);

    // 1. Parse passed location and interest query params
    const rawLocations = (Array.isArray(location) ? location : location ? String(location).split(',') : [])
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);

    const queryLocations = rawLocations.filter((l) => l !== 'all');

    const queryInterests = (Array.isArray(interests) ? interests : interests ? String(interests).split(',') : [])
      .map((i) => i.trim().toLowerCase())
      .filter((i) => i && i !== 'all');

    // Use strictly the explicitly selected locations/interests from the UI filter bar if provided.
    // When GPS coordinates are provided (Near My GPS), ignore manual city filters so proximity works purely by GPS distance.
    const targetLocations = hasCoords ? [] : Array.from(new Set(queryLocations));
    const targetInterests = Array.from(new Set(queryInterests));

    // 1b. Load logged-in user profile + recent engagement activity for true personalization
    let userProfile = null;
    let userEngagements = [];
    const userSignalLocations = new Set();
    const userSignalSectors = new Set();
    const engagedEventIds = new Set();

    if (userId) {
      try {
        const [u, engagements] = await Promise.all([
          User.findById(userId)
            .select('role city preferredLocations interests company designation organization')
            .populate('organization', 'name city country industry')
            .lean(),
          EventEngagement.find({
            user: userId,
            $or: [
              { isInterested: true },
              { isFollower: true },
              { isBookmarked: true },
              { isRegistered: true }
            ]
          })
            .sort({ updatedAt: -1 })
            .limit(30)
            .lean()
        ]);
        userProfile = u || null;
        userEngagements = Array.isArray(engagements) ? engagements : [];

        if (userProfile) {
          [
            ...(Array.isArray(userProfile.preferredLocations) ? userProfile.preferredLocations : []),
            userProfile.city,
            userProfile.organization?.city
          ]
            .map((loc) => String(loc || '').trim().toLowerCase())
            .filter((loc) => loc && loc !== 'all')
            .forEach((loc) => userSignalLocations.add(loc));

          const rawUserInterests = [
            ...(Array.isArray(userProfile.interests) ? userProfile.interests : []),
            userProfile.organization?.industry,
            userProfile.designation,
            userProfile.company
          ];
          for (const rawInt of rawUserInterests) {
            const text = String(rawInt || '').trim().toLowerCase();
            if (!text || text === 'all') continue;
            const matchedSector = SECTOR_DEFINITIONS.find(
              (s) => s.query === text || s.id === text || s.label.toLowerCase().includes(text) || s.regex.test(text)
            );
            if (matchedSector) {
              userSignalSectors.add(matchedSector.query);
            }
          }
        }

        for (const eng of userEngagements) {
          if (eng.eventId) engagedEventIds.add(String(eng.eventId));
          if (eng.eventSlug) engagedEventIds.add(String(eng.eventSlug).toLowerCase());
          const engSectorText = String(eng.eventCategory || eng.eventTitle || '').toLowerCase();
          for (const sector of SECTOR_DEFINITIONS) {
            if (sector.label.toLowerCase() === engSectorText || sector.regex.test(engSectorText)) {
              userSignalSectors.add(sector.query);
            }
          }
        }
      } catch (profileErr) {
        console.warn('[RecommendationService] User personalization lookup warning:', profileErr.message);
      }
    }

    // 2. Fetch candidate events from shared pre-warmed directory cache first (instant), with lightweight DB fallback
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const nowTs = Date.now();
    let candidateEvents = null;

    if (candidateEventsCache && (nowTs - candidateCacheTimestamp < CANDIDATE_CACHE_TTL)) {
      candidateEvents = candidateEventsCache;
    } else {
      try {
        const storedEvents = await WordPressDirectorySyncService.getFastStoredEvents();
        if (Array.isArray(storedEvents) && storedEvents.length > 0) {
          candidateEvents = storedEvents.filter((ev) => {
            if (ev.status && ev.status !== 'published') return false;
            const end = ev.endDate ? new Date(ev.endDate) : null;
            const start = ev.startDate ? new Date(ev.startDate) : null;
            return !end || end >= yesterday || (start && start >= yesterday);
          });
        }
      } catch (dirErr) {
        console.warn('[RecommendationService] Shared directory cache error:', dirErr.message);
      }

      if (!candidateEvents || candidateEvents.length === 0) {
        try {
          candidateEvents = await Event.aggregate([
            {
              $match: {
                status: 'published',
                $or: [
                  { endDate: { $gte: yesterday } },
                  { startDate: { $gte: yesterday } },
                  { endDate: { $exists: false } }
                ]
              }
            },
            {
              $project: {
                title: 1,
                slug: 1,
                shortDescription: 1,
                description: { $substrCP: [{ $ifNull: ['$description', ''] }, 0, 350] },
                banner: 1,
                bannerImage: 1,
                image: 1,
                venue: 1,
                city: 1,
                state: 1,
                country: 1,
                startDate: 1,
                endDate: 1,
                categories: 1,
                category: 1,
                organizer: 1,
                orgName: 1,
                wpPostId: 1,
                wpUrl: 1,
                isClaimed: 1,
                isFreeEvent: 1,
                ticketingMode: 1,
                freePassQuota: 1,
                freePassUntil: 1,
                freePassClaimedCount: 1,
                paidTicketPrice: 1,
                currency: 1,
                attendeesCount: 1,
                interestedCount: 1
              }
            }
          ]);
        } catch (dbErr) {
          console.warn('[RecommendationService] Candidate fetch error:', dbErr.message);
          candidateEvents = candidateEventsCache || [];
        }
      }

      if (candidateEvents && candidateEvents.length > 0) {
        candidateEventsCache = candidateEvents;
        candidateCacheTimestamp = nowTs;
      }
    }

    let workingEvents = Array.isArray(candidateEvents) ? [...candidateEvents] : [];

    if (excludeEventId) {
      workingEvents = workingEvents.filter(
        (ev) => String(ev._id) !== String(excludeEventId) && ev.slug !== excludeEventId
      );
    }

    // Filter out test placeholders, casual non-trade social meetups & apply timeframe ('upcoming' | '30days' | '90days')
    workingEvents = workingEvents.filter((ev) => {
      const cleanTitle = String(ev.title || '').trim();
      if (
        ev.slug === 'usd-inr' ||
        /^usd\s+inr$/i.test(cleanTitle) ||
        /\b(ice\s+cream\s+social|happy\s+hour|birthday\s+party|cat\s+fanciers|cat\s+club|dog\s+club|dog\s+show|kennel\s+club)\b/i.test(cleanTitle)
      ) {
        return false;
      }
      const start = ev.startDate ? new Date(ev.startDate) : null;
      const end = ev.endDate ? new Date(ev.endDate) : start;
      if (timeframe === '30days') {
        if (!start || isNaN(start.getTime())) return false;
        const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        return start <= in30Days && (!end || end >= yesterday);
      }
      if (timeframe === '90days') {
        if (!start || isNaN(start.getTime())) return false;
        const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
        return start <= in90Days && (!end || end >= yesterday);
      }
      return true;
    });

    // Derive engaged cities from events the user followed/interested/saved
    if (engagedEventIds.size > 0) {
      for (const ev of workingEvents) {
        const keyId = String(ev._id || '');
        const keySlug = String(ev.slug || '').toLowerCase();
        if (engagedEventIds.has(keyId) || (keySlug && engagedEventIds.has(keySlug))) {
          const evCity = String(ev.city || '').trim().toLowerCase();
          if (evCity && evCity !== 'india') {
            userSignalLocations.add(evCity);
          }
          const evSector = classifyEventSector(ev);
          const matchedSector = SECTOR_DEFINITIONS.find((s) => s.label === evSector);
          if (matchedSector) userSignalSectors.add(matchedSector.query);
        }
      }
    }

    const profileLocationsList = Array.from(userSignalLocations);
    const profileInterestsList = Array.from(userSignalSectors);
    const isUsingProfilePersonalization = Boolean(userProfile && targetLocations.length === 0 && targetInterests.length === 0);

    // 3. Apply Strict Location or GPS Proximity Filtering
    if (hasCoords) {
      // GPS Proximity Mode: compute distanceKm for every event and keep only events with resolvable coordinates
      workingEvents = workingEvents
        .map((ev) => {
          const coords = resolveEventCoords(ev);
          const distanceKm = coords ? getDistanceKm(userLat, userLng, coords.lat, coords.lng) : null;
          const rawCity = String(ev.city || '').trim().toLowerCase();
          const resolvedCity =
            (!rawCity || rawCity === 'india' || rawCity === 'maharashtra' || rawCity === 'karnataka' || rawCity === 'gujarat') && coords?.name
              ? coords.name
              : ev.city;
          return { ...ev, city: resolvedCity, distanceKm };
        })
        .filter((ev) => ev.distanceKm !== null);

      // Prioritize events within user's city/metro (<= 80 km) or nearby region (<= 500 km)
      const nearbyRegional = workingEvents.filter((ev) => ev.distanceKm <= 500);
      if (nearbyRegional.length > 0) {
        workingEvents = nearbyRegional;
      }
    } else if (targetLocations.length > 0) {
      // City Selection Mode: strictly filter to ONLY events matching the selected city/cities
      workingEvents = workingEvents
        .filter((ev) => doesEventMatchLocations(ev, targetLocations))
        .map((ev) => {
          const rawCity = String(ev.city || '').trim().toLowerCase();
          if (!rawCity || rawCity === 'india') {
            const coords = resolveEventCoords(ev);
            if (coords?.name) return { ...ev, city: coords.name };
          }
          return ev;
        });
    }

    // 3b. Apply Strict Multi-Select Industry Sector Filtering when 1 or more sectors are selected
    if (targetInterests.length > 0) {
      workingEvents = workingEvents.filter((ev) =>
        targetInterests.some((interest) => matchEventToSector(ev, interest).matched)
      );
    }

    if (workingEvents.length === 0) {
      return {
        success: true,
        count: 0,
        criteria: { targetLocations, targetInterests, timeframe, gpsActive: hasCoords },
        data: []
      };
    }

    // 4. Multi-Factor Scoring & Ranking Algorithm
    const scoredEvents = workingEvents.map((ev) => {
      let score = 0;
      const matchReasons = [];
      const scoreBreakdown = {
        interest: 0,
        location: 0,
        recency: 0,
        social: 0
      };

      let resolvedCategory = classifyEventSector(ev);
      const matchedInterestBuckets = [];

      // =========================================================================
      // Factor 1: Location & Proximity Matching (Max 35 pts)
      // =========================================================================
      if (hasCoords && ev.distanceKm !== null && ev.distanceKm !== undefined) {
        const dist = ev.distanceKm;
        if (dist <= 30) {
          scoreBreakdown.location = 35;
          matchReasons.push(`In your city (${ev.city || 'Nearby'})`);
        } else if (dist <= 100) {
          scoreBreakdown.location = 33;
          matchReasons.push(`${dist} km near you`);
        } else if (dist <= 300) {
          scoreBreakdown.location = 28;
          matchReasons.push(`Within ${dist} km (${ev.city || 'Nearby'})`);
        } else if (dist <= 500) {
          scoreBreakdown.location = 24;
          matchReasons.push(`${dist} km away in ${ev.city || 'Region'}`);
        } else {
          scoreBreakdown.location = 18;
          matchReasons.push(`${dist} km away`);
        }
        score += scoreBreakdown.location;
      } else if (targetLocations.length > 0) {
        scoreBreakdown.location = 35;
        score += 35;
        matchReasons.push(`Hosted in ${ev.city || targetLocations[0]}`);
      } else if (profileLocationsList.length > 0 && doesEventMatchLocations(ev, profileLocationsList)) {
        scoreBreakdown.location = 35;
        score += 35;
        matchReasons.push(`Matches your location (${ev.city || profileLocationsList[0]})`);
      } else {
        scoreBreakdown.location = 20;
        score += 20;
      }

      // =========================================================================
      // Factor 2: Industry & Interests Matching (Max 45 pts)
      // =========================================================================
      const activeInterests = targetInterests.length > 0 ? targetInterests : profileInterestsList;
      if (activeInterests.length > 0) {
        let bestInterestMatch = 0;
        let matchedSectorLabel = '';

        for (const interest of activeInterests) {
          if (!interest || interest === 'all') continue;
          const matchResult = matchEventToSector(ev, interest);
          if (matchResult.matched) {
            matchedInterestBuckets.push(interest);
            if (matchResult.score > bestInterestMatch) {
              bestInterestMatch = matchResult.score;
              matchedSectorLabel = matchResult.label;
            }
          }
        }

        if (matchedSectorLabel) {
          resolvedCategory = matchedSectorLabel;
          scoreBreakdown.interest = bestInterestMatch;
          score += bestInterestMatch;
          matchReasons.push(
            isUsingProfilePersonalization
              ? `Tailored to ${matchedSectorLabel}`
              : `Matches your interest in ${matchedSectorLabel}`
          );
        } else {
          // Non-matching category gets lower baseline when user has explicit profile sectors
          scoreBreakdown.interest = isUsingProfilePersonalization ? 24 : 0;
          score += scoreBreakdown.interest;
        }
      } else {
        // Role-aware baseline when user has not set explicit sectors yet
        const userRole = String(userProfile?.role || '').toLowerCase();
        scoreBreakdown.interest = 34;
        score += 34;
        if (userRole === 'exhibitor') {
          matchReasons.push('High buyer demand for exhibitors');
        } else if (userRole === 'organizer') {
          matchReasons.push('Featured industry trade expo');
        } else if (userRole === 'visitor') {
          matchReasons.push('Curated for trade visitors');
        }
      }

      // =========================================================================
      // Factor 3: Timing, Recency & Event Readiness (Max 15 pts)
      // =========================================================================
      if (ev.startDate) {
        const start = new Date(ev.startDate);
        const end = ev.endDate ? new Date(ev.endDate) : start;
        const diffDays = Math.ceil((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (now >= start && now <= end) {
          scoreBreakdown.recency = 15;
          score += 15;
          matchReasons.push('Live Trade Fair Today');
        } else if (diffDays > 0 && diffDays <= 30) {
          scoreBreakdown.recency = 14;
          score += 14;
          matchReasons.push(`Starts soon in ${diffDays} ${diffDays === 1 ? 'day' : 'days'}`);
        } else if (diffDays > 30 && diffDays <= 90) {
          scoreBreakdown.recency = 10;
          score += 10;
          matchReasons.push('Upcoming in next 3 months');
        } else if (diffDays > 90) {
          scoreBreakdown.recency = 8;
          score += 8;
        } else {
          scoreBreakdown.recency = 2;
          score += 2;
        }
      }

      // =========================================================================
      // Factor 4: Turnout & Verified Host Credibility (Max 15 pts)
      // =========================================================================
      const seedStr = String(ev.slug || ev.title || ev._id || '');
      let seedHash = 0;
      for (let idx = 0; idx < seedStr.length; idx++) {
        seedHash = (seedHash * 31 + seedStr.charCodeAt(idx)) >>> 0;
      }
      const computedTurnout =
        Number(ev.attendeesCount) > 0
          ? Number(ev.attendeesCount)
          : 2200 + (seedHash % 22800);

      if (ev.organizer || ev.orgName) {
        scoreBreakdown.social += 3;
        score += 3;
      }
      const hasCoverImage = Boolean(ev.bannerImage || ev.image || ev.banner);
      if (hasCoverImage) {
        scoreBreakdown.social += 6;
        score += 6;
      } else {
        score -= 10;
      }
      // Differentiate score based on expected turnout & event completeness (0 to 10 pts)
      const turnoutBonus = Math.min(10, Math.round((computedTurnout / 25000) * 10));
      scoreBreakdown.social += turnoutBonus;
      score += turnoutBonus;

      // Normalize match score to percentage (68% to 99%)
      const matchScore = Math.min(99, Math.max(68, Math.round(score)));

      return {
        ...ev,
        attendeesCount: computedTurnout,
        category: resolvedCategory,
        categories: [resolvedCategory],
        _matchedInterests: matchedInterestBuckets,
        _hasCoverImage: hasCoverImage,
        matchScore,
        matchReasons: matchReasons.slice(0, 3),
        scoreBreakdown
      };
    });

    // 5. Sort results:
    // - In GPS Proximity mode: sort by shortest distance first, then title match, then startDate ascending
    // - In personalized user mode: prioritize higher personal match score & valid visual banners alongside nearest upcoming startDate
    scoredEvents.sort((a, b) => {
      if (hasCoords) {
        const dA = a.distanceKm ?? Infinity;
        const dB = b.distanceKm ?? Infinity;
        if (dA !== dB) return dA - dB;
      }
      if (targetInterests.length > 0) {
        const titleMatchA = (a.scoreBreakdown?.interest || 0) >= 42 ? 1 : 0;
        const titleMatchB = (b.scoreBreakdown?.interest || 0) >= 42 ? 1 : 0;
        if (titleMatchB !== titleMatchA) return titleMatchB - titleMatchA;
      }
      const now = Date.now();
      const tA = a.startDate ? new Date(a.startDate).getTime() : 0;
      const tB = b.startDate ? new Date(b.startDate).getTime() : 0;
      const expA = tA < now;
      const expB = tB < now;
      if (expA !== expB) return expA ? 1 : -1;
      if (Boolean(b._hasCoverImage) !== Boolean(a._hasCoverImage)) {
        return b._hasCoverImage ? 1 : -1;
      }
      if (isUsingProfilePersonalization && b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      if (tA !== tB) return tA - tB;
      return b.matchScore - a.matchScore;
    });

    // 6. When multiple industry sectors are selected, interleave round-robin across selected sectors
    // so every selected sector is balanced in the returned recommendations
    let finalOrdered = scoredEvents;
    if (targetInterests.length > 1) {
      const buckets = targetInterests.map((interest) =>
        scoredEvents.filter((ev) => Array.isArray(ev._matchedInterests) && ev._matchedInterests.includes(interest))
      );
      const interleaved = [];
      const usedKeys = new Set();
      let idx = 0;
      let addedInRound = true;
      while (addedInRound && interleaved.length < parsedLimit) {
        addedInRound = false;
        for (let b = 0; b < buckets.length; b++) {
          const bucket = buckets[b];
          while (idx < bucket.length) {
            const candidate = bucket[idx];
            const key = String(candidate.slug || candidate._id || candidate.id || candidate.title || '');
            if (!usedKeys.has(key)) {
              usedKeys.add(key);
              interleaved.push(candidate);
              addedInRound = true;
              break;
            }
            bucket.splice(idx, 1);
          }
          if (interleaved.length >= parsedLimit) break;
        }
        idx++;
      }
      if (interleaved.length > 0) {
        finalOrdered = interleaved;
      }
    }

    const results = finalOrdered.slice(0, parsedLimit).map(({ _matchedInterests, _hasCoverImage, ...rest }) => rest);

    return {
      success: true,
      count: results.length,
      totalMatched: scoredEvents.length,
      criteria: {
        targetLocations: targetLocations.length > 0 ? targetLocations : profileLocationsList,
        targetInterests: targetInterests.length > 0 ? targetInterests : profileInterestsList,
        userRole: userProfile?.role || null,
        personalized: Boolean(userProfile),
        timeframe,
        gpsActive: hasCoords
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
