import mongoose from 'mongoose';

const EnquiryMessageSchema = new mongoose.Schema(
  {
    senderRole: {
      type: String,
      enum: ['organizer', 'exhibitor'],
      required: true
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    senderName: {
      type: String,
      required: true,
      trim: true
    },
    senderEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    message: {
      type: String,
      trim: true,
      default: '',
      maxlength: 5000
    },
    deliveryStatus: {
      type: String,
      enum: ['draft', 'pending', 'delivered', 'failed', 'canceled'],
      default: 'pending'
    },
    sentAt: {
      type: Date,
      default: null
    }
  },
  { _id: true }
);

const ExhibitorEnquirySchema = new mongoose.Schema(
  {
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    organizerName: { type: String, required: true, trim: true },
    organizerEmail: { type: String, required: true, trim: true, lowercase: true },
    organizerCompany: { type: String, default: '', trim: true },
    exhibitorId: { type: String, default: '' },
    exhibitorName: { type: String, required: true, trim: true, index: true },
    exhibitorContactPerson: { type: String, default: '', trim: true },
    exhibitorEmail: { type: String, required: true, trim: true, lowercase: true },
    exhibitorPhone: { type: String, default: '', trim: true },
    exhibitorCountry: { type: String, default: '', trim: true, index: true },
    exhibitorWebsite: { type: String, default: '', trim: true },
    exhibitorIndustry: { type: String, default: '', trim: true },
    exhibitorLogo: { type: String, default: '' },
    inquiryType: { type: String, default: 'B2B Trade Partnership', trim: true, index: true },
    messages: {
      type: [EnquiryMessageSchema],
      validate: [(messages) => messages.length > 0, 'An enquiry must contain a message']
    },
    creditsCharged: { type: Number, default: 10 },
    creditsRefunded: { type: Number, default: 0 },
    deliveryStatus: {
      type: String,
      enum: ['draft', 'pending', 'delivered', 'failed', 'canceled'],
      default: 'draft',
      index: true
    },
    sendLockUntil: { type: Date, default: null },
    sentAt: { type: Date, default: null, index: true },
    deliveredAt: { type: Date, default: null },
    viewedAt: { type: Date, default: null, index: true },
    trackingTokenHashes: { type: [String], default: [] },
    firstReplyAt: { type: Date, default: null, index: true },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    followUpDueAt: { type: Date, default: null, index: true },
    reminderClaimedAt: { type: Date, default: null },
    reminderSentAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null, index: true },
    deletedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true }
);

ExhibitorEnquirySchema.index({ organizer: 1, sentAt: -1 });
ExhibitorEnquirySchema.index({ exhibitorEmail: 1, sentAt: -1 });

export default mongoose.model('ExhibitorEnquiry', ExhibitorEnquirySchema);
