/**
 * @file defaultHotels.js
 * @description Venue hotel dataset and dynamic generator for the VisitExpo backend.
 */

export const CURATED_VENUE_HOTELS = {
  'bharat-mandapam': [
    {
      id: 'the-lalit-new-delhi',
      name: 'The Lalit New Delhi',
      stars: 5,
      rating: 4.8,
      reviewsCount: 1420,
      pricePerNight: 11500,
      currency: '₹',
      priceDisplay: 'From ₹11,500 / night',
      distance: '1.8 km from Bharat Mandapam',
      distanceKm: 1.8,
      drivingTime: '6 mins drive',
      walkingTime: '22 mins walk',
      transitTime: '12 mins metro',
      address: 'Barakhamba Avenue, Connaught Place, New Delhi, Delhi 110001',
      location: 'Connaught Place, New Delhi',
      heroImage: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=800&auto=format&fit=crop',
      images: [
        'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=800&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1618773928121-c32242e63f39?q=80&w=800&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1582719508461-905c673771fd?q=80&w=800&auto=format&fit=crop'
      ],
      description: 'Luxury 5-star hotel in central Delhi, offering world-class amenities and immediate access to Bharat Mandapam.',
      facilities: ['Free High-Speed WiFi', 'Swimming Pool', 'Luxury Spa', '24/7 Business Center', 'Valet Parking', 'Airport Shuttle']
    },
    {
      id: 'taj-mahal-hotel-man-singh-road',
      name: 'Taj Mahal Hotel (Man Singh Road)',
      stars: 5,
      rating: 4.9,
      reviewsCount: 1890,
      pricePerNight: 16800,
      currency: '₹',
      priceDisplay: 'From ₹16,800 / night',
      distance: '2.9 km from Bharat Mandapam',
      distanceKm: 2.9,
      drivingTime: '8 mins drive',
      walkingTime: '35 mins walk',
      transitTime: '15 mins taxi',
      address: '1 Mansingh Road, Khan Market, New Delhi, Delhi 110011',
      location: 'Lutyens Delhi, New Delhi',
      heroImage: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?q=80&w=800&auto=format&fit=crop',
      images: [
        'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?q=80&w=800&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1590490360182-c33d57733427?q=80&w=800&auto=format&fit=crop'
      ],
      description: 'The pinnacle of Lutyens luxury, Taj Mahal Hotel New Delhi combines stately Indian architectural elegance with legendary hospitality.',
      facilities: ['Free WiFi', 'Outdoor Pool', 'Jiva Spa', 'The Chambers Business Club', 'Valet Parking']
    },
    {
      id: 'le-meridien-new-delhi',
      name: 'Le Méridien New Delhi',
      stars: 5,
      rating: 4.8,
      reviewsCount: 1640,
      pricePerNight: 13200,
      currency: '₹',
      priceDisplay: 'From ₹13,200 / night',
      distance: '2.5 km from Bharat Mandapam',
      distanceKm: 2.5,
      drivingTime: '7 mins drive',
      walkingTime: '30 mins walk',
      transitTime: '10 mins drive',
      address: 'Windsor Place, Janpath, New Delhi, Delhi 110001',
      location: 'Janpath, New Delhi',
      heroImage: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?q=80&w=800&auto=format&fit=crop',
      images: [
        'https://images.unsplash.com/photo-1571896349842-33c89424de2d?q=80&w=800&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1591088398332-8a7791972843?q=80&w=800&auto=format&fit=crop'
      ],
      description: 'Chic design-forward 5-star hotel near Rashtrapati Bhavan and India Gate minutes from Pragati Maidan.',
      facilities: ['Free WiFi', 'Rooftop Pool', 'Luxury Spa', 'Business Center', 'Free Valet Parking']
    },
    {
      id: 'the-hans-new-delhi',
      name: 'The Hans New Delhi',
      stars: 4,
      rating: 4.4,
      reviewsCount: 890,
      pricePerNight: 6400,
      currency: '₹',
      priceDisplay: 'From ₹6,400 / night',
      distance: '2.1 km from Bharat Mandapam',
      distanceKm: 2.1,
      drivingTime: '6 mins drive',
      walkingTime: '26 mins walk',
      transitTime: '10 mins metro',
      address: '15 Barakhamba Road, Connaught Place, New Delhi, Delhi 110001',
      location: 'Connaught Place, New Delhi',
      heroImage: 'https://images.unsplash.com/photo-1582719508461-905c673771fd?q=80&w=800&auto=format&fit=crop',
      images: [
        'https://images.unsplash.com/photo-1582719508461-905c673771fd?q=80&w=800&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1618773928121-c32242e63f39?q=80&w=800&auto=format&fit=crop'
      ],
      description: 'A stylish 4-star boutique hotel offering exceptional value and prime connectivity on Barakhamba Road.',
      facilities: ['Free WiFi', 'Skyline Restaurant', 'Business Desk', 'Airport Shuttle', 'Free Parking']
    }
  ]
};

export function getNearbyHotelsForVenue(venue) {
  if (!venue) return [];
  const slug = (venue.slug || venue.id || '').toLowerCase().trim();

  if (CURATED_VENUE_HOTELS[slug] && CURATED_VENUE_HOTELS[slug].length > 0) {
    return CURATED_VENUE_HOTELS[slug];
  }
  if (slug.includes('bharat') || slug.includes('pragati')) {
    return CURATED_VENUE_HOTELS['bharat-mandapam'];
  }

  const city = venue.city || 'India';
  const vName = venue.shortName || venue.name || 'Exhibition Venue';
  const isRajkot = city.toLowerCase().includes('rajkot');

  const names = isRajkot
    ? [
        { name: 'The Imperial Palace Rajkot', stars: 5, price: 6800, dist: '2.4 km', rating: 4.8, rev: 840, addr: 'Yagnik Road, Rajkot, Gujarat' },
        { name: 'Sayaji Hotel Rajkot', stars: 5, price: 5900, dist: '3.1 km', rating: 4.7, rev: 920, addr: 'Kalawad Road, Rajkot, Gujarat' },
        { name: 'Fortune Park JPS Grand', stars: 4, price: 4800, dist: '1.8 km', rating: 4.5, rev: 610, addr: '150 Feet Ring Road, Rajkot, Gujarat' },
        { name: 'Regenta Central Rajkot', stars: 4, price: 4200, dist: '2.9 km', rating: 4.4, rev: 530, addr: 'Kasturba Road, Rajkot, Gujarat' }
      ]
    : [
        { name: `Grand Hyatt & Suites ${city}`, stars: 5, price: 11200, dist: '1.8 km', rating: 4.8, rev: 1140, addr: `100 Commercial Blvd, ${city}` },
        { name: `The Fern Residency ${city}`, stars: 4, price: 5400, dist: '2.4 km', rating: 4.5, rev: 720, addr: `Exhibition Corridor, ${city}` },
        { name: `Radisson Blu Hotel ${city}`, stars: 5, price: 9200, dist: '3.2 km', rating: 4.7, rev: 890, addr: `Civic Center District, ${city}` },
        { name: `Premier Business Suites`, stars: 4, price: 4600, dist: '1.5 km', rating: 4.4, rev: 490, addr: `Ring Road, ${city}` }
      ];

  const photos = [
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1582719508461-905c673771fd?q=80&w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?q=80&w=800&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1571896349842-33c89424de2d?q=80&w=800&auto=format&fit=crop'
  ];

  return names.map((n, idx) => ({
    id: `dyn-hotel-${slug}-${idx + 1}`,
    name: n.name,
    stars: n.stars,
    rating: n.rating,
    reviewsCount: n.rev,
    pricePerNight: n.price,
    currency: '₹',
    priceDisplay: `From ₹${n.price.toLocaleString('en-IN')} / night`,
    distance: `${n.dist} from ${vName}`,
    distanceKm: parseFloat(n.dist) || 2.0,
    drivingTime: `${Math.round((parseFloat(n.dist) || 2.0) * 3)} mins drive`,
    walkingTime: `${Math.round((parseFloat(n.dist) || 2.0) * 12)} mins walk`,
    transitTime: `${Math.round((parseFloat(n.dist) || 2.0) * 4)} mins transit`,
    address: n.addr,
    location: `${city}, India`,
    heroImage: photos[idx % photos.length],
    images: [
      photos[idx % photos.length],
      'https://images.unsplash.com/photo-1618773928121-c32242e63f39?q=80&w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1590490360182-c33d57733427?q=80&w=800&auto=format&fit=crop'
    ],
    description: `Leading ${n.stars}-star business accommodation located near ${vName}.`,
    facilities: ['Free High-Speed WiFi', '24/7 Business Center', 'Multi-Cuisine Dining', 'Airport & Venue Shuttle', 'Free Parking']
  }));
}

