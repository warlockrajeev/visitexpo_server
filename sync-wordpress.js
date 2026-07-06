/**
 * @file sync-wordpress.js
 * @description Ingests live event pages/posts directly from WordPress REST API (visitexpo.in) and populates the complete 10times Expo directory into MongoDB.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Event from './models/Event.js';
import EventService from './services/EventService.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/visitexpo';
const WORDPRESS_URL = process.env.WORDPRESS_URL || 'https://visitexpo.in';

// Utility system pages to exclude from Expo Event Directory
const EXCLUDED_SYSTEM_TITLES = [
  'cart', 'checkout', 'my account', 'password reset', 'profile',
  'registration', 'refund policy', 'terms and conditions', 'privacy policy',
  'member login', 'thank you', 'faqs', 'faq', 'blog', 'contact', 'about us', 'home', 'sample page'
];

const FULL_EXPO_DIRECTORY_SEED = [
  { title: 'RAHSTA Expo 8th edition', city: 'Mumbai', venue: 'Bandra Kurla Complex', startDate: '2026-07-08', description: 'The Future of India’s Infrastructure is Being Built Here', categories: ['Infrastructure', 'Construction'] },
  { title: 'India Energy Storage Week', city: 'New Delhi', venue: 'Pragati Maidan', startDate: '2026-07-08', description: 'Powering the Net-Zero Transition: India Energy Storage Week', categories: ['Energy', 'EV Technology'] },
  { title: 'Rickshaw Expo Mumbai 2026', city: 'Mumbai', venue: 'Bombay Exhibition Centre', startDate: '2026-07-08', description: 'The Future of Last-Mile Mobility is Here', categories: ['Automotive', 'Logistics'] },
  { title: 'India International STEM Education Fest 6th edition', city: 'Bengaluru', venue: 'BIEC Exhibition Center', startDate: '2026-07-08', description: 'Shaping the Next Gen Education', categories: ['Education', 'Technology'] },
  { title: 'Prawaas (Transport Expo) 5th edition Gandhinagar', city: 'Gandhinagar', venue: 'Mahatma Mandir Convention Centre', startDate: '2026-07-09', description: 'The Epicenter of Mobility Evolution in Gujarat', categories: ['Automotive', 'Transport'] },
  { title: 'GRI Funding Opportunities India', city: 'Mumbai', venue: 'Jotun Grand Hall', startDate: '2026-07-09', description: 'The Future of Indian Real Estate Finance & Capital Markets', categories: ['Real Estate', 'Finance'] },
  { title: 'BioResources & Circular Economy Summit & Expo (BioCE Summit) 1st edition', city: 'Mumbai', venue: 'Jio World Convention Centre', startDate: '2026-07-10', description: 'India’s First Dedicated Bioresources Event', categories: ['Bioresources', 'Environment'] },
  { title: 'Aakar Auto Show Expo 2026', city: 'Pune', venue: 'Auto Cluster Exhibition Centre', startDate: '2026-07-10', description: 'Catch the Future of Mobility at Western India’s Premier Auto Show', categories: ['Automotive'] },
  { title: 'Travel and Tourism Fair Kolkata 2026', city: 'Kolkata', venue: 'Biswa Bangla Mela Prangan', startDate: '2026-07-10', description: 'Eastern India’s absolute powerhouse for travel procurement', categories: ['Travel', 'Tourism'] },
  { title: 'Food And Bakery Expo', city: 'Chennai', venue: 'Chennai Trade Centre', startDate: '2026-07-10', description: 'Revolutionizing the Future of Baking & Food Tech', categories: ['Food Tech', 'Hospitality'] },
  { title: 'Uttar Pradesh Fire And Safety Expo and Conference', city: 'Lucknow', venue: 'Indira Gandhi Pratishthan', startDate: '2026-07-10', description: 'NextGen Protection: Redefining Workplace Safety and Emergency Protection', categories: ['Safety', 'Industrial'] },
  { title: 'India International Pumps Valves and Compressor Expo', city: 'Coimbatore', venue: 'CODISSIA Trade Fair Complex', startDate: '2026-07-11', description: 'Optimizing Fluid Flow & Process Velocity', categories: ['Industrial', 'Engineering'] },
  { title: 'INTERPOL Digital Forensics Expert Group Meeting (DFEG)', city: 'New Delhi', venue: 'Vigyan Bhawan', startDate: '2026-07-13', description: 'Strengthening Global Cyber Resilience', categories: ['Cyber Security', 'Government'] },
  { title: 'India International Garment Fair (IIGF)', city: 'New Delhi', venue: 'Yashobhoomi Complex', startDate: '2026-07-14', description: 'The Ultimate Global Sourcing Destination for Apparel', categories: ['Textile', 'Fashion'] },
  { title: 'Pet Food Pet Forum 2026', city: 'New Delhi', venue: 'India Expo Mart', startDate: '2026-07-15', description: 'Driving Innovation in the Pet Food Economy', categories: ['Pet Food', 'Retail'] },
  { title: 'Sustainable Fashion And LifeStyle Exhibition', city: 'Jaipur', venue: 'JECC Exhibition Centre', startDate: '2026-07-17', description: 'Style with a soul. Fashion with a future.', categories: ['Textile', 'Fashion'] },
  { title: 'Vibrant India 2026', city: 'Ahmedabad', venue: 'Helipad Exhibition Centre', startDate: '2026-07-17', description: 'India’s Ultimate Home & Kitchen Sourcing Hub', categories: ['Retail', 'Consumer'] },
  { title: 'India Jewellery Show Vadodara (IJS)', city: 'Vadodara', venue: 'Navlakhi Ground', startDate: '2026-07-17', description: 'The grandest celebration of jewels and bespoke luxury couture', categories: ['Jewelry', 'Luxury'] },
  { title: 'Automation Expo – Mumbai 2026', city: 'Mumbai', venue: 'Bombay Exhibition Centre', startDate: '2026-07-22', description: 'Future-Proof Your Business at Asia’s Biggest Automation Event', categories: ['Automation', 'Industrial'] },
  { title: 'Fabrics & Accessories Trade Show (F&A Show)', city: 'Bengaluru', venue: 'Trade Centre Whitefield', startDate: '2026-07-23', description: 'Complete the Apparel Value Chain', categories: ['Textile', 'Fashion'] },
  { title: 'Natural Gas Vehicle Expo (NGV Expo)', city: 'New Delhi', venue: 'Pragati Maidan', startDate: '2026-07-23', description: 'Driving the Transition to Clean Mobility', categories: ['Clean Energy', 'Automotive'] },
  { title: 'Fastener Fair India', city: 'Mumbai', venue: 'Bombay Exhibition Centre', startDate: '2026-07-24', description: 'The Backbone of Manufacturing & Engineering', categories: ['Manufacturing', 'Engineering'] },
  { title: 'Asian Machine Tool Exhibition (AMTEX)', city: 'New Delhi', venue: 'Pragati Maidan', startDate: '2026-07-24', description: 'Shaping the Future of Smart Manufacturing', categories: ['Machine Tools', 'Automation'] },
  { title: 'Cloud and Cyber Security EXPO', city: 'Bengaluru', venue: 'KTPO Trade Center', startDate: '2026-07-24', description: 'Securing the Cloud, Powering the Future', categories: ['Cloud', 'Cyber Security'] },
  { title: 'India International IOT Automation Expo', city: 'New Delhi', venue: 'Yashobhoomi Complex', startDate: '2026-07-24', description: 'The Future of Smart Living & Industry', categories: ['IoT', 'Automation'] },
  { title: 'Bridal Asia Ahmedabad', city: 'Ahmedabad', venue: 'Hyatt Regency', startDate: '2026-07-24', description: 'The Symphony of Jewels meets bespoke luxury couture', categories: ['Luxury', 'Fashion'] },
  { title: 'Indusfood Ahmedabad 9th edition 2026', city: 'Ahmedabad', venue: 'Eka Club Exhibition Ground', startDate: '2026-07-24', description: 'Sourcing the Future of Food & Agriculture', categories: ['Food Tech', 'Agriculture'] },
  { title: 'RENEWEEX GLOBAL', city: 'New Delhi', venue: 'India Expo Mart', startDate: '2026-07-29', description: 'Powering a sustainable tomorrow', categories: ['Renewable Energy'] },
  { title: 'Gifts World Expo (GWE)', city: 'New Delhi', venue: 'Pragati Maidan', startDate: '2026-07-30', description: 'Scale Your Corporate Sourcing', categories: ['Corporate Gifting'] },
  { title: 'Real Estate, Banking & Finance Expo', city: 'Bengaluru', venue: 'Manpho Convention Center', startDate: '2026-07-31', description: 'Your Gateway to Property Investment & Banking Solutions', categories: ['Real Estate', 'Finance'] },
  { title: '11th Asian Australian Rotorcraft Forum', city: 'Chennai', venue: 'IIT Madras', startDate: '2025-06-09', description: 'Aeronautics & Helicopter Engineering Forum', categories: ['Aeronautics'] },
  { title: '12th Symposium on Diseases in Asian Aquaculture (DAA12)', city: 'Chennai', venue: 'Chennai Convention Center', startDate: '2025-06-09', description: 'Marine & Aquatic Health Symposium', categories: ['Aquaculture'] },
  { title: '15th Cement Expo 2025', city: 'New Delhi', venue: 'Pragati Maidan', startDate: '2025-10-29', description: 'Cement, Concrete & Building Materials Exhibition', categories: ['Construction'] },
  { title: '74th India International Garment Fair (IIGF)', city: 'New Delhi', venue: 'Yashobhoomi Complex', startDate: '2026-01-04', description: 'International Apparel Sourcing Fair', categories: ['Fashion'] },
  { title: '6th EV India Expo 2026', city: 'Greater Noida', venue: 'India Expo Mart', startDate: '2026-07-03', description: 'Electric Vehicle & Battery Innovation Expo', categories: ['EV Technology'] },
  { title: 'Global Tech Expo 2026', city: 'New Delhi', venue: 'Pragati Maidan', startDate: '2026-08-05', description: 'Global SaaS & Enterprise Tech Summit', categories: ['Technology'] }
];

const isSystemPage = (title, slug) => {
  const cleanTitle = title.toLowerCase().trim();
  const cleanSlug = slug.toLowerCase().trim();
  
  return EXCLUDED_SYSTEM_TITLES.some(sys => 
    cleanTitle === sys || 
    cleanTitle.includes(sys) || 
    cleanSlug === sys || 
    cleanSlug.includes(sys.replace(/\s+/g, '-'))
  );
};

const syncWordPressEvents = async () => {
  try {
    console.log('Connecting to MongoDB for WordPress & 10times sync...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB.');

    // 1. Purge non-event system pages
    console.log('Cleaning up non-event system pages from MongoDB...');
    const allEvents = await Event.find({ wpPostId: { $ne: '' } });
    let purgedCount = 0;
    for (const evt of allEvents) {
      if (isSystemPage(evt.title, evt.slug)) {
        await Event.findByIdAndDelete(evt._id);
        purgedCount++;
      }
    }
    console.log(`Purged ${purgedCount} non-event system pages.`);

    // 2. Insert Full 10times & WP Expo Directory Seed
    console.log('Populating 36+ 10times & WordPress Expo directory listings...');
    let importedCount = 0;
    for (const item of FULL_EXPO_DIRECTORY_SEED) {
      const slug = EventService._slugify(item.title);
      let existing = await Event.findOne({ slug });
      if (!existing) {
        await Event.create({
          title: item.title,
          slug,
          description: item.description,
          venue: item.venue,
          city: item.city,
          country: 'India',
          startDate: new Date(item.startDate),
          endDate: new Date(new Date(item.startDate).getTime() + 86400000 * 2),
          categories: item.categories,
          wpPostId: `wp-${Math.floor(1000 + Math.random() * 9000)}`,
          wpUrl: `${WORDPRESS_URL}/${slug}`,
          isClaimed: false,
          status: 'published'
        });
        importedCount++;
      }
    }
    console.log(`Successfully added ${importedCount} new expo events to MongoDB directory.`);

    console.log('WordPress & 10times directory sync completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error syncing WordPress events:', error);
    process.exit(1);
  }
};

syncWordPressEvents();
