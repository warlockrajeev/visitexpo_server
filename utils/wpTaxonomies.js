/**
 * @file wpTaxonomies.js
 * @description Canonical WordPress taxonomy hierarchy (categories, location, event_tags)
 * and slug normalization helpers shared across backend controllers and WP sync services.
 */

export const WP_CATEGORY_TREE = {
  'IT & Technology': [
    'Technology',
    'Smart Technology',
    'Smart Cities',
    'Travel Technology',
    'Media',
    'Photography',
    'Science & Research'
  ],
  'Industrial Engineering': [
    'Machinery',
    'Metals',
    'Packing & Packaging',
    'Printing',
    'Plastic',
    'Paint',
    'Paper',
    'Security & Defense'
  ],
  'Healthcare': [
    'Medical & Pharma',
    'Medical',
    'Health & Beauty',
    'Wellness, Health & Fitness',
    'Healthcare Facility',
    'Lab',
    'Optics',
    'Orthopaedic'
  ],
  'Renewable Energy': [
    'Solar',
    'Power & Energy',
    'Sustainable Development',
    'Water Management',
    'Water'
  ],
  'Real Estate': [
    'Interior Design',
    'Home Office',
    'Home Care',
    'Mattress',
    'Upholstery Technology'
  ],
  'Textile': [
    'Textile Machinery',
    'Laundry',
    'Wedding'
  ],
  'Hospitality': [
    'Hotels',
    'Tourism',
    'Travel',
    'Horticulture',
    'Natural Products'
  ],
  'Logistics & Transportation': [
    'Trade Shows',
    'Retail',
    'Product Launches'
  ],
  'Networking Events': [
    'Seminars',
    'Leadership',
    'Insurance',
    'Sports',
    'Stationery',
    'Miscellaneous'
  ],
  'Pet & Animal': [
    'Cat Expo',
    'Dog Expo'
  ]
};

export const WP_CATEGORY_SLUG_MAP = {
  'IT & Technology': 'it-technology',
  'Technology': 'technology',
  'Smart Technology': 'smart-technology',
  'Smart Cities': 'smart-cities',
  'Travel Technology': 'travel-technology',
  'Media': 'media',
  'Photography': 'photography',
  'Science & Research': 'science-research',
  'Industrial Engineering': 'industrial-engineering',
  'Machinery': 'machinery',
  'Metals': 'metals',
  'Metal': 'metal',
  'Packing & Packaging': 'packing-packaging',
  'Printing': 'printing',
  'Plastic': 'plastic',
  'Paint': 'paint',
  'Paper': 'paper',
  'Security & Defense': 'security-defense',
  'Healthcare': 'healthcare',
  'Medical & Pharma': 'medical-pharma',
  'Medical': 'medical',
  'Health & Beauty': 'health-beauty',
  'Health & Fitness': 'health-and-fitness',
  'Wellness, Health & Fitness': 'wellness-health-fitness',
  'Healthcare Facility': 'healthcare-facility',
  'Lab': 'lab',
  'Optics': 'optics',
  'Orthopaedic': 'orthopaedic',
  'Renewable Energy': 'renewable-energy',
  'Solar': 'solar',
  'Power & Energy': 'power-energy',
  'Sustainable Development': 'sustainable-development',
  'Water Management': 'water-management',
  'Water': 'water',
  'Real Estate': 'real-estate',
  'Interior Design': 'interior-design',
  'Home Office': 'home-office',
  'Home Care': 'home-care',
  'Mattress': 'mattress',
  'Upholstery Technology': 'upholstery-technology',
  'Textile': 'textile',
  'Textile Machinery': 'textile-machinery',
  'Laundry': 'laundry',
  'Wedding': 'wedding',
  'Hospitality': 'hospitality',
  'Hotels': 'hotels',
  'Tourism': 'tourism',
  'Travel': 'travel',
  'Horticulture': 'horticulture',
  'Natural Products': 'natural-products',
  'Logistics & Transportation': 'logistics-transportation',
  'Trade Shows': 'trade-shows',
  'Retail': 'retail',
  'Product Launches': 'product-launches',
  'Networking Events': 'networking-events',
  'Seminars': 'seminars',
  'Leadership': 'leadership',
  'Insurance': 'insurance',
  'Sports': 'sports',
  'Stationery': 'stationery',
  'Miscellaneous': 'miscellaneous',
  'Pet & Animal': 'pet-animal',
  'Cat Expo': 'cat-expo',
  'Dog Expo': 'dog-expo'
};

export const LEGACY_CATEGORY_ALIASES = {
  'Technology & AI': 'IT & Technology',
  'Tech & AI': 'IT & Technology',
  'Information Technology': 'IT & Technology',
  'Industrial Manufacturing': 'Industrial Engineering',
  'Healthcare & Pharma': 'Healthcare',
  'Renewable Energy & ESG': 'Renewable Energy',
  'Real Estate, Building & Construction': 'Real Estate',
  'Construction & Infra': 'Real Estate',
  'Agriculture & Food Tech': 'Horticulture',
  'Consumer Goods & Retail': 'Retail',
  'Services, Finance & Education': 'Networking Events',
  'Automotive & Transport': 'Logistics & Transportation'
};

export const WP_COUNTRY_CITIES = {
  INDIA: [
    'New Delhi',
    'Mumbai',
    'Bengaluru',
    'Greater Noida',
    'Noida',
    'Gurugram',
    'Hyderabad',
    'Chennai',
    'Pune',
    'Ahmedabad',
    'Kolkata',
    'Jaipur',
    'Surat',
    'Kochi',
    'Chandigarh',
    'Indore',
    'Bhubaneswar',
    'Coimbatore',
    'Vadodara',
    'Nagpur',
    'Lucknow',
    'Gandhinagar',
    'Rajkot',
    'Ludhiana'
  ],
  USA: [
    'Las Vegas',
    'New York',
    'Chicago',
    'Atlanta',
    'Orlando',
    'Anaheim',
    'Austin',
    'San Francisco',
    'Los Angeles',
    'Boston',
    'Miami',
    'Dallas',
    'Houston',
    'Seguin',
    'Charlotte'
  ],
  UAE: ['Dubai', 'Abu Dhabi', 'Sharjah'],
  UK: ['London', 'Birmingham', 'Manchester'],
  Germany: ['Berlin', 'Frankfurt', 'Munich', 'Cologne', 'Dusseldorf', 'Hanover'],
  Singapore: ['Singapore'],
  China: ['Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen'],
  Japan: ['Tokyo', 'Osaka', 'Chiba'],
  France: ['Paris', 'Lyon'],
  Italy: ['Milan', 'Bologna', 'Rome'],
  Bangladesh: ['Dhaka', 'Chattogram'],
  Thailand: ['Bangkok', 'Nonthaburi'],
  Vietnam: ['Ho Chi Minh City', 'Hanoi'],
  Indonesia: ['Jakarta', 'Banten', 'Tangerang'],
  Malaysia: ['Kuala Lumpur', 'Penang'],
  'Saudi Arabia': ['Riyadh', 'Jeddah'],
  Canada: ['Toronto', 'Vancouver', 'Montreal'],
  Australia: ['Sydney', 'Melbourne', 'Brisbane'],
  'Sri Lanka': ['Colombo'],
  Nepal: ['Kathmandu']
};

export const WP_COUNTRY_CANONICAL_NAMES = {
  india: 'INDIA',
  in: 'INDIA',
  'united states': 'USA',
  'united states of america': 'USA',
  usa: 'USA',
  us: 'USA',
  'united arab emirates': 'UAE',
  uae: 'UAE',
  'united kingdom': 'UK',
  uk: 'UK',
  britain: 'UK',
  'great britain': 'UK'
};

export const WP_LOCATION_SLUG_QUIRKS = {
  india: 'india',
  usa: 'usa',
  uae: 'united-arab-emirates',
  uk: 'uk',
  mumbai: 'bombay',
  bombay: 'bombay',
  'new delhi': 'delhi',
  delhi: 'delhi',
  bengaluru: 'bangalore',
  bangalore: 'bangalore',
  chennai: 'madras',
  madras: 'madras',
  kolkata: 'calcutta',
  calcutta: 'calcutta',
  'greater noida': 'greater-noida',
  noida: 'noida',
  ahmedabad: 'ahmedabad',
  hyderabad: 'hyderabad',
  pune: 'pune',
  dubai: 'dubai',
  singapore: 'singapore',
  london: 'london',
  berlin: 'berlin',
  chicago: 'chicago',
  'las vegas': 'las-vegas',
  'new york': 'new-york'
};

export const WP_SEEDED_TAGS = [
  'Automation',
  'Business Networking',
  'Building & Construction',
  'Interior Design',
  'Design & Innovation',
  'Food & Beverage Industry',
  'Health & Beauty',
  'Clean Energy',
  'Smart Cities',
  'B2B Expo',
  'Cargo',
  'Fashion',
  'Architects',
  'Industrial Expo',
  'Manufacturing',
  'Trade Fair'
];

export function slugifyTerm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function canonicalizeCategoryName(name) {
  const cleaned = String(name || '').replace(/&amp;/g, '&').trim();
  if (!cleaned) return '';
  if (LEGACY_CATEGORY_ALIASES[cleaned]) return LEGACY_CATEGORY_ALIASES[cleaned];
  const exactKey = Object.keys(WP_CATEGORY_SLUG_MAP).find(
    k => k.toLowerCase() === cleaned.toLowerCase()
  );
  return exactKey || cleaned;
}

export function canonicalizeCountryName(country) {
  const cleaned = String(country || '').trim();
  if (!cleaned) return '';
  const mapped = WP_COUNTRY_CANONICAL_NAMES[cleaned.toLowerCase()];
  if (mapped) return mapped;
  const matchedKey = Object.keys(WP_COUNTRY_CITIES).find(
    k => k.toLowerCase() === cleaned.toLowerCase()
  );
  return matchedKey || cleaned;
}

export function getSeededTaxonomiesPayload() {
  const categories = Object.entries(WP_CATEGORY_TREE).map(([parentName, children]) => ({
    name: parentName,
    slug: WP_CATEGORY_SLUG_MAP[parentName] || slugifyTerm(parentName),
    parent: 0,
    children: children.map(childName => ({
      name: childName,
      slug: WP_CATEGORY_SLUG_MAP[childName] || slugifyTerm(childName)
    }))
  }));

  const locations = Object.entries(WP_COUNTRY_CITIES).map(([countryName, cities]) => ({
    name: countryName,
    slug: WP_LOCATION_SLUG_QUIRKS[countryName.toLowerCase()] || slugifyTerm(countryName),
    parent: 0,
    children: cities.map(cityName => ({
      name: cityName,
      slug: WP_LOCATION_SLUG_QUIRKS[cityName.toLowerCase()] || slugifyTerm(cityName)
    }))
  }));

  const tags = WP_SEEDED_TAGS.map(name => ({
    name,
    slug: slugifyTerm(name)
  }));

  return {
    source: 'seeded-wp-taxonomies',
    categories,
    location: locations,
    event_tags: tags
  };
}
