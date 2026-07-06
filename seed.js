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
      Payment.deleteMany({})
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

    // Add user back to organization team members
    organization.teamMembers.push({ user: user._id, role: 'organizer' });
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
    console.log('Seeding WordPress 7.0 directory events...');
    const wpEvents = [
      {
        title: '11th Asian Australian Rotorcraft Forum',
        slug: '11th-asian-australian-rotorcraft-forum',
        description: 'Global forum on vertical flight, rotorcraft technology, and advanced air mobility.',
        venue: 'IIT Madras, Chennai',
        city: 'Chennai',
        startDate: new Date('2025-06-09'),
        endDate: new Date('2025-06-11'),
        categories: ['Aeronautics', 'Engineering'],
        wpPostId: 'wp-1001',
        isClaimed: false,
        status: 'published'
      },
      {
        title: '12th Symposium on Diseases in Asian Aquaculture (DAA12)',
        slug: '12th-symposium-on-diseases-in-asian-aquaculture-daa12',
        description: 'International symposium focusing on aquatic animal health and one health aquaculture.',
        venue: 'Chennai Convention Center',
        city: 'Chennai',
        startDate: new Date('2025-06-09'),
        endDate: new Date('2025-06-12'),
        categories: ['Aquaculture', 'Marine'],
        wpPostId: 'wp-1002',
        isClaimed: false,
        status: 'published'
      },
      {
        title: '15th Cement Expo 2025',
        slug: '15th-cement-expo-2025',
        description: 'Premier trade fair for cement manufacturing technology and green building materials.',
        venue: 'Pragati Maidan',
        city: 'New Delhi',
        startDate: new Date('2025-10-29'),
        endDate: new Date('2025-10-31'),
        categories: ['Construction', 'Industrial'],
        wpPostId: 'wp-1003',
        isClaimed: false,
        status: 'published'
      },
      {
        title: '6th EV India Expo 2026',
        slug: '6th-ev-india-expo-2026',
        description: 'Electric vehicle, battery storage, and charging infrastructure exhibition.',
        venue: 'India Expo Mart, Greater Noida',
        city: 'Greater Noida',
        startDate: new Date('2026-07-03'),
        endDate: new Date('2026-07-05'),
        categories: ['Automotive', 'EV Technology'],
        wpPostId: 'wp-1004',
        isClaimed: false,
        status: 'published'
      },
      {
        title: '74th India International Garment Fair (IIGF)',
        slug: '74th-india-international-garment-fair-iigf',
        description: 'Major apparel and textile sourcing fair for international buyers and fashion brands.',
        venue: 'Yashobhoomi Complex, New Delhi',
        city: 'New Delhi',
        startDate: new Date('2026-01-04'),
        endDate: new Date('2026-01-06'),
        categories: ['Textile', 'Fashion'],
        wpPostId: 'wp-1005',
        isClaimed: false,
        status: 'published'
      }
    ];

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

    console.log('\nSeeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seed();
