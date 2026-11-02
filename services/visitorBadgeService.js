import { randomBytes } from 'node:crypto';
import Visitor from '../models/Visitor.js';

export function createVisitorQrCode() {
  return `VEX-${randomBytes(32).toString('hex').toUpperCase()}`;
}

export async function ensureVisitorQrCode(visitor) {
  if (visitor.qrCode && !visitor.qrCode.startsWith('visitexpo-')) {
    return visitor.qrCode;
  }
  if (visitor.qrCode) {
    const duplicate = await Visitor.exists({
      _id: { $ne: visitor._id },
      qrCode: visitor.qrCode
    });
    if (!duplicate) return visitor.qrCode;
  }
  visitor.qrCode = createVisitorQrCode();
  await visitor.save();
  return visitor.qrCode;
}
