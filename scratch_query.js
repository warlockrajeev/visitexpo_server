import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Event from './models/Event.js';

dotenv.config();

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const events = await Event.find({
      $or: [
        { title: { $regex: 'impression', $options: 'i' } },
        { slug: { $regex: 'impression', $options: 'i' } }
      ]
    }).lean();
    console.log('MongoDB Events count:', events.length);
    console.log(JSON.stringify(events.map(e => ({ id: e._id, title: e.title, slug: e.slug, city: e.city, isClaimed: e.isClaimed, status: e.status })), null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
};
run();
