const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Lead = mongoose.model('Lead', new mongoose.Schema({}, { strict: false }));

  const user = await User.findOne({ email: 'mehrotravansh00@gmail.com' });
  console.log('User found:', user.email, 'Role:', user.role);

  // Generate JWT token matching auth middleware
  const token = jwt.sign(
    { id: user._id, role: user.role, organization: user.organization },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  // Find one of Vansh's leads
  const lead = await Lead.findOne({ event: new mongoose.Types.ObjectId('6ab769d2cd9cfc9261d14cf2') });
  console.log('Lead to test delete on:', lead ? { id: lead._id, name: lead.name } : 'None');

  // Create a temporary dummy lead to test delete
  const tempLead = await Lead.create({
    name: 'Test Delete Lead',
    email: 'delete_test@example.com',
    event: lead.event,
    status: 'new'
  });
  console.log('Created temporary lead:', tempLead._id.toString());

  try {
    const res = await fetch(`http://localhost:5000/api/leads/${tempLead._id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await res.json();
    console.log('DELETE response status:', res.status, data);
  } catch (err) {
    console.error('DELETE error:', err);
  }

  process.exit(0);
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});
