const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Event = mongoose.model('Event', new mongoose.Schema({}, { strict: false }));
  const Lead = mongoose.model('Lead', new mongoose.Schema({}, { strict: false }));

  const vansh = await User.findOne({ email: 'mehrotravansh00@gmail.com' });
  console.log('User:', vansh?.email, 'ID:', vansh?._id);

  const events = await Event.find({
    $or: [
      { organizer: vansh._id },
      { organizer: vansh.organization },
      { claimedBy: vansh._id },
      { claimedBy: vansh.organization },
      { organizerEmail: vansh.email }
    ]
  });
  console.log('Events:', events.map(e => ({ id: e._id.toString(), title: e.title })));

  const eventIds = events.map(e => e._id);
  const leads = await Lead.find({ event: { $in: eventIds } });
  console.log('Leads for Vansh events:', leads.length);
  leads.forEach(l => console.log(' - Lead:', l._id.toString(), l.name, 'Event:', l.event?.toString()));

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
