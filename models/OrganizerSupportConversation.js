import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema(
  {
    senderRole: { type: String, enum: ['organizer', 'admin'], required: true },
    senderId: { type: String, default: '' },
    senderName: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
  },
  { _id: true }
);

const OrganizerSupportConversationSchema = new mongoose.Schema(
  {
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    messages: { type: [MessageSchema], default: [] },
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now },
    unreadByAdmin: { type: Number, default: 0 },
    unreadByOrganizer: { type: Number, default: 0 },
    status: { type: String, enum: ['open', 'closed'], default: 'open' }
  },
  { timestamps: true }
);

OrganizerSupportConversationSchema.index({ lastMessageAt: -1 });

export default mongoose.model('OrganizerSupportConversation', OrganizerSupportConversationSchema);