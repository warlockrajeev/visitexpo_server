/**
 * @file ingest_all_events.js
 * @description Ingest all 90+ live WordPress directory events provided by user into MongoDB Atlas.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Event from './models/Event.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

const rawEventsData = [
  { title: "India's First Sales Talent Hunt", venue: "Bharat Mandapam, New Delhi, New Delhi", startDate: "2026-08-08", categories: ["Sales", "Corporate"] },
  { title: "SFI EXPO", venue: "Bharat Mandapam (Pragati Maidan), New Delhi, New Delhi", startDate: "2026-07-30", categories: ["Industrial", "Trade"] },
  { title: "14th FACD-CAB International Education Expo Bangladesh 2026", venue: "Exhibition Center, India, India", startDate: "2026-07-14", categories: ["Education"] },
  { title: "25th Real Estate Expo Bangladesh 2026", venue: "Exhibition Center, India, India", startDate: "2026-07-20", categories: ["Real Estate"] },
  { title: "31st Build Bangladesh International Expo 2026", venue: "Main Exhibition Hall, New Delhi, New Delhi", startDate: "2026-07-20", categories: ["Construction", "Building"] },
  { title: "Food Expo In Mumbai", venue: "Main Exhibition Hall, New Delhi, New Delhi", startDate: "2026-07-21", categories: ["Food Tech"] },
  { title: "Restaurant India", venue: "Jio World Convention Centre, Mumbai, Mumbai", startDate: "2026-07-20", categories: ["Hospitality", "Food"] },
  { title: "India Tech", venue: "Main Exhibition Hall, New Delhi, New Delhi", startDate: "2026-07-21", categories: ["Technology"] },
  { title: "Gaming show", venue: "Exhibition Center, India, India", startDate: "2026-07-20", categories: ["Gaming", "Entertainment"] },
  { title: "Textech International Expo - Bangladesh 2026", venue: "Bangabandhu Bangladesh–China Friendship Exhibition Center (BBCFEC), Purbachal, Dhaka, Bangladesh", startDate: "2026-09-02", categories: ["Textile"] },
  { title: "Global Education Fair Bangladesh 2026", venue: "Renaissance Dhaka Gulshan Hotel, 78 Gulshan Avenue, Dhaka, Dhaka", startDate: "2026-08-01", categories: ["Education"] },
  { title: "Eduko International Education Expo Bangladesh 2026", venue: "MIDAS Convention Center (12th Floor), Road 27, Dhanmondi, Dhaka, Dhaka", startDate: "2026-07-29", categories: ["Education"] },
  { title: "Hardware, Cutting Tools & Fastener Expo Bangladesh 2026", venue: "International Convention City Bashundhara (ICCB), Kuril, Dhaka, Bangladesh", startDate: "2026-11-05", categories: ["Hardware", "Industrial"] },
  { title: "Infrastructure Equipment & Machineries Expo (IEMX) Bangladesh 2026", venue: "International Convention City Bashundhara (ICCB), Kuril, Dhaka, Bangladesh", startDate: "2026-11-05", categories: ["Infrastructure"] },
  { title: "8th Water Bangladesh Int'l Expo 2026", venue: "International Convention City Bashundhara (ICCB), Kuril, Dhaka, Bangladesh", startDate: "2026-11-12", categories: ["Water Tech", "Environment"] },
  { title: "International Conference on Photovoltaics and Renewable Energy Physics (ICPREP) Bangladesh 2026", venue: "Javan Hotel, Tongi-Kaliganj Hwy, Tongi, Bangladesh", startDate: "2026-12-04", categories: ["Energy", "Solar"] },
  { title: "Biofuel Expo Bangladesh 2026", venue: "International Convention City Bashundhara (ICCB), Dhaka, Bangladesh", startDate: "2026-11-05", categories: ["Clean Energy"] },
  { title: "Dhaka International Yarn & Fabric Show – Summer Edition Bangladesh 2026", venue: "Bangabandhu Bangladesh–China Friendship Exhibition Center (BBCFEC), Purbachal, Dhaka, Bangladesh", startDate: "2026-09-02", categories: ["Textile", "Fashion"] },
  { title: "International Conference on Oncology, Cancer Research and Patient Care (ICOCRPC) Bangladesh 2026", venue: "Savar Upazila, Dhaka, Bangladesh", startDate: "2026-09-16", categories: ["Medical", "Healthcare"] },
  { title: "6th MOSB Congress Bangladesh 2026", venue: "Pan Pacific Sonargaon Hotel, Dhaka, Bangladesh", startDate: "2026-09-19", categories: ["Medical"] },
  { title: "Bangladesh International Medical Expo (BIMEX) 2026", venue: "International Convention City Bashundhara (ICCB), Dhaka, Bangladesh", startDate: "2026-11-26", categories: ["Medical"] },
  { title: "Bangla Med Expo (International B2B Medical Exhibition) 2026", venue: "International Convention City Bashundhara (ICCB), Dhaka, Bangladesh", startDate: "2026-08-21", categories: ["Medical", "Healthcare"] },
  { title: "2nd International Pump & Valve Fair & Sorter Expo (featuring Automation and Production Technologies)", venue: "International Convention City Bashundhara (ICCB), Dhaka, Bangladesh", startDate: "2026-11-05", categories: ["Automation", "Industrial"] },
  { title: "7th Industrial Machinery & Manufacturing Equipment Expo & Industrial Automation Expo (IAE) 2026", venue: "International Convention City Bashundhara (ICCB), Dhaka, Bangladesh", startDate: "2026-08-20", categories: ["Industrial", "Manufacturing"] },
  { title: "3rd BEVMX Bangladesh 2026", venue: "International Convention City Bashundhara (ICCB), Kuril, Dhaka, Bangladesh", startDate: "2026-11-26", categories: ["EV Technology"] },
  { title: "Solar Bangladesh International Expo 2026", venue: "International Convention City Bashundhara (ICCB), Dhaka, Bangladesh", startDate: "2026-11-05", categories: ["Solar", "Clean Energy"] },
  { title: "International Occupational Safety, Health and Fire Expo (IOSHFE) Bangladesh 2026", venue: "Hall-4, International Convention City Bashundhara (ICCB), Dhaka, Bangladesh", startDate: "2026-09-17", categories: ["Safety"] },
  { title: "10th Print Tech Bangladesh 2026", venue: "International Convention City Bashundhara (ICCB), Kuril, Dhaka, Bangladesh", startDate: "2026-09-24", categories: ["Printing", "Media"] },
  { title: "Summer Fair Bangladesh 2026", venue: "Centrum Hall, Bashundhara R/A, Dhaka, Dhaka", startDate: "2026-07-16", categories: ["Consumer"] },
  { title: "13th International Yarn & Fabrics Sourcing Fair Bangladesh 2026", venue: "International Convention City Bashundhara (ICCB), Kuril Bishwa Road, Dhaka, Bangladesh", startDate: "2026-08-13", categories: ["Textile"] },
  { title: "Bangladesh Electric Vehicle & Mobility Exhibition 2026", venue: "International Convention City Bashundhara (ICCB), Kuril Bishwa Road, Dhaka, Bangladesh", startDate: "2026-09-26", categories: ["EV Technology", "Automotive"] },
  { title: "BASIS SoftExpo Bangladesh 2026", venue: "Bangabandhu Bangladesh-China Friendship Exhibition Center (BBCFEC), Purbachal, Dhaka, Dhaka", startDate: "2026-12-31", categories: ["Software", "SaaS"] },
  { title: "Feed Tech Bangladesh Exhibition & Conference 2026", venue: "International Convention City Bashundhara (ICCB), Purbachal Express Highway, Dhaka, Bangladesh", startDate: "2026-11-05", categories: ["Agriculture", "Food Tech"] },
  { title: "International Conference on Digital Forensics and Security Solutions (ICDF2S)", venue: "Khulna, Bangladesh, Bangladesh", startDate: "2026-11-25", categories: ["Cyber Security"] },
  { title: "International Security Expo Bangladesh – 2026", venue: "Hall-4, International Convention City Bashundhara (ICCB), Dhaka, Bangladesh", startDate: "2026-09-17", categories: ["Security"] },
  { title: "Summer Fashion & Lifestyle Expo (Women’s & Consumer Focus) Bangladesh 2026", venue: "Aloki Convention Center, Gulshan–Tejgaon Link Road, Dhaka, Dhaka", startDate: "2026-08-27", categories: ["Fashion", "Lifestyle"] },
  { title: "Metal Expo Bangladesh 2026", venue: "International Convention City Bashundhara (ICCB), Dhaka, Bangladesh", startDate: "2026-11-05", categories: ["Industrial", "Metallurgy"] },
  { title: "Industrial Machinery & Manufacturing Equipment Expo & Industrial Automation Expo", venue: "International Convention City Bashundhara (ICCB), Dhaka, Bangladesh", startDate: "2026-08-20", categories: ["Manufacturing"] },
  { title: "International Convention City Bashundhara (ICCB) Bangladesh 2026", venue: "International Convention City Bashundhara (ICCB), Purbachal Express Highway, Dhaka, Bangladesh", startDate: "2026-11-05", categories: ["Trade"] },
  { title: "CCCSL \"Wisdom of Hands\" International Handicrafts Exhibition & Trade Fair 2026", venue: "BMICH, Colombo, Sri Lanka", startDate: "2026-07-31", categories: ["Handicrafts"] },
  { title: "Cancer Awareness", venue: "Exhibition Center, India, India", startDate: "2026-07-13", categories: ["Healthcare"] },
  { title: "Colombo Lifestyle Fair 2026", venue: "Sirimavo Bandaranaike Memorial Exhibition Centre (SBMEC) at the BMICH, Colombo", startDate: "2026-11-13", categories: ["Lifestyle"] },
  { title: "ICPAC Colombo 2026 Sri Lanka", venue: "Colombo, Sri Lanka, Sri Lanka", startDate: "2026-10-13", categories: ["Conference"] },
  { title: "International Conference on Orthopedic Geriatric Care and Management (ICOGCM)", venue: "Colombo, Sri Lanka, Sri Lanka", startDate: "2026-11-22", categories: ["Medical"] },
  { title: "International Conference on Orthopedic Oncology and Bone Tumor Management (ICOOBTM)", venue: "Colombo, Sri Lanka, Sri Lanka", startDate: "2026-10-04", categories: ["Medical"] },
  { title: "Sri Lanka Surgical Congress 2026", venue: "Cinnamon Grand, Colombo, Sri Lanka", startDate: "2026-09-02", categories: ["Medical"] },
  { title: "Colombo Air Symposium (Aviation Industry & Research) Sri Lanka", venue: "Eagles' Lakeside Banquet & Convention Hall, Attidiya, Sri Lanka", startDate: "2026-10-14", categories: ["Aviation"] },
  { title: "Auto Vision Motor Show Sri Lanka 2026", venue: "BMICH, Colombo, Sri Lanka", startDate: "2026-07-31", categories: ["Automotive"] },
  { title: "Techno Exhibition (Techno Sri Lanka)", venue: "BMICH (Bandaranaike Memorial International Conference Hall), Colombo, Sri Lanka", startDate: "2026-10-16", categories: ["Technology"] },
  { title: "World Study Fair Sri Lanka 2026", venue: "The Balmoral Ballroom, The Kingsbury, Colombo, Sri Lanka", startDate: "2026-07-25", categories: ["Education"] },
  { title: "Lanka Premier League (LPL) Grand Opening 2026", venue: "SSC Grounds, Colombo, Sri Lanka", startDate: "2026-07-17", categories: ["Sports"] },
  { title: "Sri Lanka MICE Expo 2026", venue: "Colombo & The Cultural Triangle, Sri Lanka", startDate: "2026-10-05", categories: ["MICE", "Tourism"] },
  { title: "Mobile Photography Exhibition & Competition Sri Lanka", venue: "Daybreak Gallery, PSSL Premises, Colombo", startDate: "2026-08-20", categories: ["Photography"] },
  { title: "Lanka Paper Expo 2026", venue: "BMICH, Colombo, Sri Lanka", startDate: "2026-10-23", categories: ["Paper", "Industrial"] },
  { title: "GlobalHealth Asia-Pacific Sri Lanka Conference", venue: "ITC Ratnadipa, Colombo, Sri Lanka", startDate: "2026-07-22", categories: ["Healthcare"] },
  { title: "International Conference on Waste Collection Logistics and Smart Sorting Systems", venue: "Exhibition Venue, India", startDate: "2026-12-03", categories: ["Waste Management"] },
  { title: "StartupX India Expo 2026", venue: "Veer gend singh hall, New Delhi, New Delhi", startDate: "2026-07-12", categories: ["Startups", "SaaS"] },
  { title: "TechNova Summit 2026", venue: "Pt Dindayal upadhaya, New Delhi, New Delhi", startDate: "2026-07-12", categories: ["Technology"] },
  { title: "India International Tech", venue: "Main Exhibition Hall, New Delhi, New Delhi", startDate: "2026-07-10", categories: ["Technology"] },
  { title: "International ai summit", venue: "Pt Dindayal upadhaya, New Delhi, New Delhi", startDate: "2026-07-11", categories: ["AI & ML"] },
  { title: "International Conference on Solid Waste Technology and Management (ICSWTM)", venue: "Colombo, Sri Lanka", startDate: "2026-10-06", categories: ["Waste Management"] },
  { title: "International Conference on Banking Regulation and Compliance Frameworks", venue: "Colombo, Sri Lanka", startDate: "2026-11-22", categories: ["Finance"] },
  { title: "78th Annual Scientific Sessions of the SLVA", venue: "The Grand Kandyan Hotel, Kandy, Sri Lanka", startDate: "2026-08-07", categories: ["Medical"] },
  { title: "International Conference on Veterinary Medicine and Diagnostic Technologies (ICVMDT)", venue: "Colombo, Sri Lanka", startDate: "2026-10-22", categories: ["Veterinary"] },
  { title: "International Forum on Veterinary Medicine and Disease Management (IFVM-DM)", venue: "Colombo, Sri Lanka", startDate: "2026-09-24", categories: ["Veterinary"] },
  { title: "CONSTRUCT Sri Lanka 2026", venue: "Sirimavo Bandaranaike Memorial Exhibition Center, BMICH, Colombo, Sri Lanka", startDate: "2026-08-14", categories: ["Construction"] },
  { title: "Kedella Colombo Trade Fair Sri Lanka 2026", venue: "BMICH, Colombo, Sri Lanka", startDate: "2026-09-11", categories: ["Trade"] },
  { title: "Colombo Comic Expo | Play Expo Sri Lanka 2026", venue: "SLECC, 12 McCallum Rd, Colombo, Sri Lanka", startDate: "2026-12-05", categories: ["Gaming", "Entertainment"] },
  { title: "The Motor Show 2026 Sri Lanka", venue: "BMICH, Colombo, Sri Lanka", startDate: "2026-09-11", categories: ["Automotive"] },
  { title: "Lanka Comic Con Sri Lanka 2026", venue: "Bauddhaloka Mawatha, Colombo, Sri Lanka", startDate: "2026-10-31", categories: ["Entertainment"] },
  { title: "Sri Lanka Economic and Investment Summit 2026", venue: "Colombo, Sri Lanka", startDate: "2026-10-12", categories: ["Finance"] },
  { title: "Sri Lanka FinTech Summit 2026", venue: "BMICH, Colombo, Sri Lanka", startDate: "2026-09-16", categories: ["Fintech"] },
  { title: "International Conference on Cybercrime, Digital Evidence, and Legal Challenges (ICCDELC)", venue: "Colombo, Sri Lanka", startDate: "2026-08-22", categories: ["Cyber Security"] },
  { title: "Ramp Up 2026", venue: "Cinnamon Grand, Colombo, Sri Lanka", startDate: "2026-08-05", categories: ["Corporate"] },
  { title: "Complast Sri Lanka 2026", venue: "BMICH, Colombo, Sri Lanka", startDate: "2026-08-28", categories: ["Plastics", "Industrial"] },
  { title: "International Conference on Fire Safety and Resilience of the Built Environment (ICFIRE 2026)", venue: "BMICH, Colombo, Sri Lanka", startDate: "2026-07-22", categories: ["Fire Safety"] },
  { title: "The Media Fest 2026", venue: "The Grand Marquee, Taj Samudra, Colombo, Sri Lanka", startDate: "2026-07-11", categories: ["Media"] },
  { title: "LANKAPAK 2026", venue: "BMICH, Colombo, Sri Lanka", startDate: "2026-10-23", categories: ["Packaging"] },
  { title: "International Conference on Smart Grid Engineering (ICSGE)", venue: "Colombo, Sri Lanka", startDate: "2026-11-06", categories: ["Energy"] },
  { title: "Shoreline Dog Fanciers Association Show", venue: "OC Fair & Event Center, Costa Mesa, California", startDate: "2026-08-28", categories: ["Pets"] },
  { title: "Dog Days of Summer", venue: "New Jersey", startDate: "2026-08-08", categories: ["Pets"] },
  { title: "India Gem & Jewellery Show (GJS)", venue: "Exhibition Venue, India", startDate: "2026-10-02", categories: ["Jewelry"] },
  { title: "Bridal Asia Mumbai", venue: "Jio World Convention Centre (JWCC), BKC, Bandra East, Mumbai", startDate: "2026-08-15", categories: ["Fashion", "Luxury"] },
  { title: "Bridal Asia Hyderabad", venue: "HICC - Novotel, Near HITEC City, Hyderabad", startDate: "2026-09-05", categories: ["Fashion", "Luxury"] },
  { title: "LED & Lighting Expo", venue: "Exhibition Venue, India", startDate: "2026-06-27", categories: ["Lighting"] },
  { title: "EASTERN SIGNAGE KOLKATA 2026", venue: "Exhibition Venue, India", startDate: "2026-11-27", categories: ["Media", "Signage"] },
  { title: "Battery India Expo", venue: "Auto Cluster Exhibition Centre, Chinchwad, Pune", startDate: "2026-10-02", categories: ["EV Technology", "Batteries"] },
  { title: "Screen Print India", venue: "Bharat Mandapam (Pragati Maidan), New Delhi", startDate: "2026-08-06", categories: ["Printing"] },
  { title: "Cable & Wire Fair (CWF)", venue: "Yashobhoomi (IICC), Sector 25 Dwarka, New Delhi", startDate: "2027-12-09", categories: ["Industrial"] },
  { title: "World Mithai-Namkeen Convention & Expo 2026 (WMNC)", venue: "Yashobhoomi (IICC), Sector 25 Dwarka, New Delhi", startDate: "2026-12-20", categories: ["Food Tech"] },
  { title: "India Med Expo - Bengaluru 2026", venue: "Bangalore International Exhibition Centre (BIEC), Bengaluru", startDate: "2026-09-05", categories: ["Medical"] },
  { title: "Wastetech India Expo 2026", venue: "Bangalore International Exhibition Centre (BIEC), Tumkur Road, Bengaluru", startDate: "2026-08-20", categories: ["Waste Management"] },
  { title: "Plastech India Expo 2026", venue: "Tamil Nadu, India", startDate: "2026-11-27", categories: ["Plastics"] },
  { title: "Sri Lanka Buildcon International Expo 2026", venue: "BMICH, Colombo, Sri Lanka", startDate: "2026-11-27", categories: ["Construction"] },
  { title: "Intex South Asia Sri Lanka", venue: "BMICH, Colombo, Sri Lanka", startDate: "2026-08-05", categories: ["Textile"] }
];

async function ingest() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB Atlas.');

    let count = 0;
    for (const item of rawEventsData) {
      if (!item.title) continue;

      const slug = item.title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');

      // Upsert event
      const existing = await Event.findOne({ slug });
      if (!existing) {
        await Event.create({
          title: item.title,
          slug,
          description: `Official directory listing for ${item.title}.`,
          venue: item.venue || 'Exhibition Center, India',
          city: item.venue?.split(',').pop()?.trim() || 'India',
          country: 'India',
          startDate: item.startDate ? new Date(item.startDate) : new Date(),
          endDate: item.startDate ? new Date(new Date(item.startDate).getTime() + 86400000 * 2) : new Date(),
          categories: item.categories || ['Trade'],
          isClaimed: false,
          status: 'published',
          wpPostId: `wp-${Math.floor(10000 + Math.random() * 90000)}`
        });
        count++;
      }
    }

    console.log(`Ingested ${count} new directory events. Total events now in DB: ${await Event.countDocuments({})}`);
    process.exit(0);
  } catch (err) {
    console.error('Ingest error:', err);
    process.exit(1);
  }
}

ingest();
