/**
 * @file seed.js
 * @description Seeding script to populate the MongoDB database with mock Events, Users, Exhibitors, and Visitors.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Load Env variables
dotenv.config();
import bcrypt from 'bcryptjs';
import User from './models/User.js';
import Organization from './models/Organization.js';
import Event from './models/Event.js';
import Visitor from './models/Visitor.js';
import Exhibitor from './models/Exhibitor.js';
import Lead from './models/Lead.js';
import Ticket from './models/Ticket.js';
import Order from './models/Order.js';
import Payment from './models/Payment.js';
import SupportTicket from './models/SupportTicket.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/visitexpo';

const seed = async () => {
  try {
    console.log('Connecting to MongoDB database for seeding...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected.');

    // 1. Clean Database
    console.log('Clearing existing database collections...');
    await Promise.all([
      User.deleteMany({}),
      Organization.deleteMany({}),
      Event.deleteMany({}),
      Visitor.deleteMany({}),
      Exhibitor.deleteMany({}),
      Lead.deleteMany({}),
      Ticket.deleteMany({}),
      Order.deleteMany({}),
      Payment.deleteMany({}),
      SupportTicket.deleteMany({})
    ]);
    console.log('Collections cleared.');

    // 2. Create Organization
    console.log('Creating seed organization...');
    const organization = await Organization.create({
      name: 'Global Tech Events Ltd.',
      contact: {
        email: 'info@globaltech.com',
        phone: '+919999988888',
        address: '12, Barakhamba Road, Connaught Place, New Delhi, India'
      }
    });
    console.log(`Organization "${organization.name}" created.`);

    // 3. Create Super Admin User
    console.log('Creating seed super admin user...');
    const superAdmin = await User.create({
      name: 'Global Admin',
      email: 'admin@visitexpo.in',
      password: 'password123',
      role: 'super_admin',
      isVerified: true
    });
    console.log(`Super Admin "${superAdmin.name}" (${superAdmin.email}) created.`);

    // 3.1 Create Organizer User
    console.log('Creating seed organizer user...');
    // Password will be hashed automatically by the User schema pre-save hook
    const user = await User.create({
      name: 'Demo Organizer',
      email: 'organizer@visitexpo.in',
      password: 'password123',
      role: 'organizer',
      organization: organization._id,
      isVerified: true
    });
    console.log(`User "${user.name}" (${user.email}) created.`);

    // 3.2 Create Rajeev Haldar Organizer User
    const rajeevUser = await User.create({
      name: 'Rajeev Haldar',
      email: 'rajeevhaldar8265@gmail.com',
      password: '007007',
      role: 'organizer',
      organization: organization._id,
      isVerified: true
    });
    console.log(`User "${rajeevUser.name}" (${rajeevUser.email}) created.`);

    // Add users back to organization team members
    organization.teamMembers.push({ user: user._id, role: 'organizer' });
    organization.teamMembers.push({ user: rajeevUser._id, role: 'organizer' });
    await organization.save();

    // 4. Create Event
    console.log('Creating seed event...');
    const start = new Date();
    start.setDate(start.getDate() + 30); // 30 days from now
    const end = new Date();
    end.setDate(end.getDate() + 32);

    const event = await Event.create({
      title: 'Global Tech Expo 2026',
      slug: 'global-tech-expo-2026',
      description: 'The ultimate summit for AI developers, SaaS innovators, tech startups, and enterprise giants. Features 150+ exhibitors, 4 parallel speaker tracks, and virtual networking lounges.',
      banner: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=1000',
      venue: 'Hall 5, Pragati Maidan, New Delhi',
      city: 'New Delhi',
      country: 'India',
      startDate: start,
      endDate: end,
      timings: '09:00 AM - 06:00 PM',
      categories: ['AI & ML', 'SaaS', 'Web3', 'Cloud Infrastructure'],
      organizer: organization._id,
      website: 'https://globaltechexpo.in',
      registrationSettings: {
        maxLimit: 2500,
        isOpen: true,
        formFields: ['name', 'email', 'phone', 'company', 'designation', 'country']
      },
      status: 'published',
      speakers: [
        {
          name: 'Dr. Aarav Mehta',
          designation: 'Chief AI Scientist',
          company: 'NeuroCore Systems',
          bio: 'Pioneer in Large Language Models and neuromorphic computing paradigms.'
        },
        {
          name: 'Sarah Jenkins',
          designation: 'Head of Developer Relations',
          company: 'CloudFlow DB',
          bio: 'Developer advocate and expert on distributed database systems.'
        }
      ]
    });
    console.log(`Event "${event.title}" created.`);

    // 4.1 Seed WordPress 7.0 Directory Events (Unclaimed)
    console.log('Seeding WordPress & 10times directory events...');
    const fullDirectoryList = [
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
      { title: '6th EV India Expo 2026', city: 'Greater Noida', venue: 'India Expo Mart', startDate: '2026-07-03', description: 'Electric Vehicle & Battery Innovation Expo', categories: ['EV Technology'] }
    ];

    const wpEvents = fullDirectoryList.map((item, index) => ({
      title: item.title,
      slug: Event.schema.methods.slugify ? Event.schema.methods.slugify(item.title) : item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      description: item.description,
      venue: item.venue,
      city: item.city,
      country: 'India',
      startDate: new Date(item.startDate),
      endDate: new Date(new Date(item.startDate).getTime() + 86400000 * 2),
      categories: item.categories,
      wpPostId: `wp-${1000 + index}`,
      isClaimed: false,
      status: 'published'
    }));

    for (const wpEvt of wpEvents) {
      await Event.create(wpEvt);
    }
    console.log(`Seeded ${wpEvents.length} WordPress directory events.`);

    // 5. Create Exhibitors
    console.log('Creating seed exhibitors (in-person and virtual)...');
    const exhibitors = [
      {
        name: 'NeuroCore Systems',
        description: 'Next-gen LLMs and cognitive agents for enterprise automation.',
        logo: 'https://logo.clearbit.com/neurocore.com',
        website: 'https://neurocore.com',
        contactEmail: 'partner@neurocore.com',
        contactPhone: '+91 88877 66554',
        boothNumber: 'A-12',
        event: event._id,
        attendanceType: 'hybrid',
        status: 'approved',
        staff: [{ name: 'Nikhil Kumar', email: 'nikhil@neurocore.com', phone: '+91 88877 66551' }]
      },
      {
        name: 'CloudFlow DB',
        description: 'Serverless vector databases featuring sub-millisecond latencies.',
        logo: 'https://logo.clearbit.com/cloudflow.db',
        website: 'https://cloudflow.db',
        contactEmail: 'hello@cloudflow.db',
        contactPhone: '+1 415 555 2673',
        boothNumber: 'B-04',
        event: event._id,
        attendanceType: 'in_person',
        status: 'approved',
        staff: [{ name: 'Sarah Jenkins', email: 'sarah@cloudflow.db', phone: '+1 415 555 2671' }]
      },
      {
        name: 'DevSync AI',
        description: 'Generative AI developer tools for real-time pair programming.',
        logo: 'https://logo.clearbit.com/devsync.ai',
        website: 'https://devsync.ai',
        contactEmail: 'onboard@devsync.ai',
        contactPhone: '+91 99118 87766',
        boothNumber: 'V-01',
        event: event._id,
        attendanceType: 'virtual',
        status: 'approved',
        staff: [{ name: 'Amit Verma', email: 'amit@devsync.ai', phone: '+91 99118 87761' }]
      },
      {
        name: 'CyberSec Blocks',
        description: 'Blockchain-powered decentralized identity and security protocols.',
        logo: '',
        website: 'https://cybersecblocks.io',
        contactEmail: 'contact@cybersecblocks.io',
        contactPhone: '+91 77665 54433',
        boothNumber: '',
        event: event._id,
        attendanceType: 'in_person',
        status: 'pending',
        staff: [{ name: 'John Doe', email: 'john@cybersecblocks.io', phone: '+91 77665 54431' }]
      },
      {
        name: 'Quantum Logic Corp',
        description: 'Quantum simulator software libraries for classic computers.',
        logo: '',
        website: 'https://quantumlogic.corp',
        contactEmail: 'hr@quantumlogic.corp',
        contactPhone: '+1 202 555 0144',
        boothNumber: '',
        event: event._id,
        attendanceType: 'virtual',
        status: 'rejected',
        staff: []
      }
    ];

    const createdExhibitors = await Exhibitor.create(exhibitors);
    console.log(`${createdExhibitors.length} Exhibitors created.`);

    // Sync approved exhibitors to the Event Schema as well
    const approvedExhibitors = createdExhibitors.filter(ex => ex.status === 'approved');
    event.exhibitors = approvedExhibitors.map(ex => ({
      name: ex.name,
      logo: ex.logo,
      boothNumber: ex.boothNumber,
      website: ex.website,
      description: ex.description
    }));
    await event.save();
    console.log('Approved exhibitors synced to Event document.');

    // 5.1 Create Ticket Tiers
    console.log('Creating seed ticket tiers...');
    const tickets = [
      {
        title: 'Free Registration Pass',
        description: 'Standard access to the main expo hall, virtual streams, and online networking lobby.',
        type: 'free',
        price: 0,
        capacity: 1500,
        soldCount: 3, // Priya, Novak, and Meera
        event: event._id,
        status: 'active'
      },
      {
        title: 'Main Hall Delegate Pass',
        description: 'Access to physical presentation tracks, Q&A panels, workshop slides, and standard delegate lunch.',
        type: 'paid',
        price: 2999,
        capacity: 500,
        soldCount: 2, // Ananya and Vikram
        event: event._id,
        status: 'active'
      },
      {
        title: 'VIP Masterclass Pass',
        description: 'Access to exclusive speaker roundtables, private VIP lounge, custom networking buffet, and certificate of completion.',
        type: 'vip',
        price: 9999,
        capacity: 100,
        soldCount: 1, // Rajesh
        event: event._id,
        status: 'active'
      }
    ];
    const createdTickets = await Ticket.create(tickets);
    console.log(`${createdTickets.length} Ticket tiers created.`);

    const freeTicket = createdTickets.find(t => t.type === 'free');
    const paidTicket = createdTickets.find(t => t.type === 'paid');
    const vipTicket = createdTickets.find(t => t.type === 'vip');

    // 6. Create Visitors (In-Person and Virtual)
    console.log('Creating seed visitors...');
    const visitors = [
      {
        name: 'Ananya Sharma',
        email: 'ananya@techcorp.com',
        phone: '+91 98765 43210',
        company: 'TechCorp Solutions',
        designation: 'Senior Developer',
        country: 'India',
        qrCode: `visitexpo-${event._id}-ananyatechcorpcom`,
        registrationStatus: 'confirmed',
        attendanceType: 'in_person',
        checkInStatus: 'checked_in',
        checkInTime: new Date(Date.now() - 3600000), // 1 hour ago
        event: event._id
      },
      {
        name: 'Rajesh Patel',
        email: 'rajesh@patelsolutions.in',
        phone: '+91 91234 56789',
        company: 'Patel Solutions',
        designation: 'CTO',
        country: 'India',
        qrCode: `visitexpo-${event._id}-rajeshpatelsolutionsin`,
        registrationStatus: 'confirmed',
        attendanceType: 'in_person',
        checkInStatus: 'checked_in',
        checkInTime: new Date(Date.now() - 1800000), // 30 mins ago
        event: event._id
      },
      {
        name: 'Vikram Singh',
        email: 'vikram@fintech.org',
        phone: '+91 98888 77777',
        company: 'FinTech Org',
        designation: 'Product Manager',
        country: 'India',
        qrCode: `visitexpo-${event._id}-vikramfintechorg`,
        registrationStatus: 'confirmed',
        attendanceType: 'in_person',
        checkInStatus: 'not_checked_in',
        event: event._id
      },
      {
        name: 'Priya Das',
        email: 'priya@creativeweb.in',
        phone: '+91 87654 32109',
        company: 'Creative Web',
        designation: 'UI/UX Designer',
        country: 'India',
        qrCode: `visitexpo-${event._id}-priyacreativewebin`,
        registrationStatus: 'confirmed',
        attendanceType: 'virtual',
        virtualJoinStatus: 'checked_in',
        virtualJoinTime: new Date(Date.now() - 900000), // 15 mins ago
        event: event._id
      },
      {
        name: 'Alexander Novak',
        email: 'alex.novak@globaltech.cz',
        phone: '+420 777 123 456',
        company: 'Novak Dev Studio',
        designation: 'Software Engineer',
        country: 'Czech Republic',
        qrCode: `visitexpo-${event._id}-alexnovakglobaltechcz`,
        registrationStatus: 'confirmed',
        attendanceType: 'virtual',
        virtualJoinStatus: 'not_checked_in',
        event: event._id
      },
      {
        name: 'Meera Nair',
        email: 'meera@nairconsultancy.com',
        phone: '+91 90000 11111',
        company: 'Nair Consultancy',
        designation: 'Marketing Lead',
        country: 'India',
        qrCode: `visitexpo-${event._id}-meeranairconsultancycom`,
        registrationStatus: 'pending',
        attendanceType: 'in_person',
        event: event._id
      }
    ];

    const createdVisitors = await Visitor.create(visitors);
    console.log(`${createdVisitors.length} Visitors created.`);

    // 7. Create Orders and Payments
    console.log('Creating seed orders and payment logs...');
    
    // Map visitors to their order details
    const orderData = [
      {
        buyer: createdVisitors[0], // Ananya (Regular paid ticket)
        ticket: paidTicket,
        amount: paidTicket.price,
        status: 'completed',
        method: 'credit_card'
      },
      {
        buyer: createdVisitors[1], // Rajesh (VIP paid ticket)
        ticket: vipTicket,
        amount: vipTicket.price,
        status: 'completed',
        method: 'credit_card'
      },
      {
        buyer: createdVisitors[2], // Vikram (Regular paid ticket)
        ticket: paidTicket,
        amount: paidTicket.price,
        status: 'completed',
        method: 'bank_transfer'
      },
      {
        buyer: createdVisitors[3], // Priya (Free registration)
        ticket: freeTicket,
        amount: 0,
        status: 'completed',
        method: 'free_pass'
      },
      {
        buyer: createdVisitors[4], // Novak (Free registration)
        ticket: freeTicket,
        amount: 0,
        status: 'completed',
        method: 'free_pass'
      },
      {
        buyer: createdVisitors[5], // Meera (Pending, pending order)
        ticket: freeTicket,
        amount: 0,
        status: 'pending',
        method: 'free_pass'
      }
    ];

    for (let i = 0; i < orderData.length; i++) {
      const data = orderData[i];
      const orderNumber = `ORD-${Date.now()}-${1000 + i}`;
      const paymentId = data.amount > 0 ? `pay_MOCK${1000 + i}TRANS` : 'FREE_PASS';

      const order = await Order.create({
        orderNumber,
        event: event._id,
        organizer: organization._id,
        buyer: {
          name: data.buyer.name,
          email: data.buyer.email,
          phone: data.buyer.phone
        },
        items: [
          {
            ticket: data.ticket._id,
            title: data.ticket.title,
            price: data.ticket.price,
            quantity: 1
          }
        ],
        totalAmount: data.amount,
        status: data.status,
        paymentMethod: data.method,
        paymentId
      });

      if (data.amount > 0 && data.status === 'completed') {
        await Payment.create({
          order: order._id,
          transactionId: paymentId,
          amount: data.amount,
          currency: 'INR',
          gateway: 'stripe',
          status: 'successful'
        });
      }
    }
    console.log('Orders and Payment logs created.');

    // 8. Create CRM Leads representing a full pipeline
    console.log('Creating CRM Leads with diverse funnel stages...');
    
    // Visitor-based leads mapped to pipeline stages
    const leadData = [
      {
        visitor: createdVisitors[0], // Ananya
        status: 'qualified',
        score: 65,
        notes: 'Interested in AI platforms. Attended hourly delegate keynotes.'
      },
      {
        visitor: createdVisitors[1], // Rajesh (VIP)
        status: 'won',
        score: 95,
        notes: 'CTO, signed enterprise agreement with NeuroCore Systems at booth A-12.'
      },
      {
        visitor: createdVisitors[2], // Vikram
        status: 'contacted',
        score: 45,
        notes: 'Contacted sales team about sponsorship opportunities.'
      },
      {
        visitor: createdVisitors[3], // Priya (Virtual)
        status: 'new',
        score: 30,
        notes: 'Joined virtually. Looking at Web3 startup materials.'
      },
      {
        visitor: createdVisitors[4], // Novak (Virtual)
        status: 'lost',
        score: 15,
        notes: 'No activity registered on virtual streams. Low interest.'
      },
      {
        visitor: createdVisitors[5], // Meera (Pending)
        status: 'new',
        score: 25,
        notes: 'Registration requested online via WordPress.'
      }
    ];

    const leads = leadData.map((ld, i) => {
      return {
        name: ld.visitor.name,
        email: ld.visitor.email,
        phone: ld.visitor.phone,
        company: ld.visitor.company,
        designation: ld.visitor.designation,
        country: ld.visitor.country,
        leadScore: ld.score,
        source: i % 2 === 0 ? 'website' : 'campaign',
        status: ld.status,
        event: event._id,
        notes: ld.notes,
        activityTimeline: [
          {
            type: 'note',
            content: `Lead captured for Global Tech Expo 2026. Registered as ${ld.visitor.attendanceType} visitor.`
          },
          ...(ld.status !== 'new' ? [{
            type: 'note',
            content: `Contacted lead and updated status to: ${ld.status}`
          }] : []),
          ...(ld.visitor.checkInStatus === 'checked_in' ? [{
            type: 'note',
            content: 'Checked in physically at Pragati Maidan Hall 5 registration gate.'
          }] : []),
          ...(ld.visitor.virtualJoinStatus === 'checked_in' ? [{
            type: 'note',
            content: 'Logged in and active on the virtual event stream.'
          }] : [])
        ]
      };
    });

    const createdLeads = await Lead.create(leads);
    console.log(`${createdLeads.length} CRM Leads created.`);

    // 10. Seed Support Tickets
    console.log('Creating seed support tickets...');
    await SupportTicket.create([
      {
        ticketId: 'TKT-2451',
        user: user._id,
        reporterName: user.name,
        reporterEmail: user.email,
        organization: organization._id,
        event: event._id,
        title: 'Payment Gateway webhook handshakes failing (Stripe sandbox)',
        description: 'Orders created during simulated checkouts are occasionally timing out on callback verifications. Requesting team to inspect webhook secrets.',
        category: 'billing',
        priority: 'high',
        status: 'open',
        responses: [
          {
            sender: user._id,
            senderName: user.name,
            senderRole: user.role,
            message: 'We noticed this error during our trial setup for Global Tech Expo 2026.',
            createdAt: new Date(Date.now() - 3600000 * 3)
          }
        ]
      },
      {
        ticketId: 'TKT-2449',
        user: user._id,
        reporterName: user.name,
        reporterEmail: user.email,
        organization: organization._id,
        event: event._id,
        title: 'Custom domain SSL certificate renewal for visitexpo.in subdomain',
        description: 'Need assistance setting up automatic wildcard SSL certificates for our custom microsite URL.',
        category: 'technical',
        priority: 'medium',
        status: 'in_progress',
        responses: [
          {
            sender: user._id,
            senderName: user.name,
            senderRole: user.role,
            message: 'DNS CNAME records have been updated to point to visitexpo proxy.',
            createdAt: new Date(Date.now() - 86400000)
          },
          {
            sender: superAdmin._id,
            senderName: superAdmin.name,
            senderRole: superAdmin.role,
            message: 'Admin team is verifying Let\'s Encrypt challenge record propagation.',
            createdAt: new Date(Date.now() - 43200000)
          }
        ]
      },
      {
        ticketId: 'TKT-2448',
        user: user._id,
        reporterName: user.name,
        reporterEmail: user.email,
        organization: organization._id,
        event: event._id,
        title: 'Exhibitor roster booth allocation capacity request',
        description: 'Would like to increase maximum exhibitor booth allocations from 50 to 100 for Hall 5.',
        category: 'event_setup',
        priority: 'low',
        status: 'resolved',
        resolutionNotes: 'Approved capacity increase to 100 booths for Hall 5.',
        resolvedAt: new Date(Date.now() - 86400000 * 2),
        resolvedBy: superAdmin._id,
        responses: [
          {
            sender: superAdmin._id,
            senderName: superAdmin.name,
            senderRole: superAdmin.role,
            message: 'Booth capacity limit has been upgraded to 100 in database settings.',
            createdAt: new Date(Date.now() - 86400000 * 2)
          }
        ]
      }
    ]);
    console.log('Seed Support Tickets created.');

    console.log('\nSeeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seed();
