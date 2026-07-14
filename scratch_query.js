import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Event from './models/Event.js';

dotenv.config();

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const events = await Event.find({ slug: { $in: ['cancer-awareness-1', 'cancer-awareness', 'technova-summit-2026'] } });
    console.log(JSON.stringify(events, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
};
run();
