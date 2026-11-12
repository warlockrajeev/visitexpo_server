import mongoose from 'mongoose';

const WorkEmailVerificationSchema = new mongoose.Schema(
  {
    workEmail: { type: String, required: true, lowercase: true, trim: true },
    accountEmail: { type: String, required: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

WorkEmailVerificationSchema.index({ workEmail: 1, accountEmail: 1 }, { unique: true });
WorkEmailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('WorkEmailVerification', WorkEmailVerificationSchema);
