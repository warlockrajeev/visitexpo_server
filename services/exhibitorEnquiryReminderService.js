import ExhibitorEnquiry from '../models/ExhibitorEnquiry.js';
import Notification from '../models/Notification.js';
import { sendEmail } from './emailService.js';

const CLIENT_URL = process.env.CLIENT_URL || 'https://client.visitexpo.in';
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);

export const sendExhibitorEnquiryReminders = async () => {
  const staleClaimBefore = new Date(Date.now() - 30 * 60 * 1000);
  const dueEnquiries = await ExhibitorEnquiry.find({
    deliveryStatus: 'delivered',
    followUpDueAt: { $lte: new Date() },
    reminderSentAt: null,
    $or: [
      { reminderClaimedAt: null },
      { reminderClaimedAt: { $lt: staleClaimBefore } }
    ],
    archivedAt: null,
    deletedAt: null,
    firstReplyAt: null,
    acceptedAt: null,
    rejectedAt: null
  }).select('_id organizer organizerName organizerEmail exhibitorName followUpDueAt');

  for (const enquiry of dueEnquiries) {
    const claimed = await ExhibitorEnquiry.findOneAndUpdate(
      {
        _id: enquiry._id,
        reminderSentAt: null,
        $or: [
          { reminderClaimedAt: null },
          { reminderClaimedAt: { $lt: staleClaimBefore } }
        ],
        firstReplyAt: null,
        acceptedAt: null,
        rejectedAt: null,
        deletedAt: null
      },
      { $set: { reminderClaimedAt: new Date() } },
      { new: true }
    );

    if (!claimed) continue;

    const stillWaiting = await ExhibitorEnquiry.exists({
      _id: enquiry._id,
      firstReplyAt: null,
      acceptedAt: null,
      rejectedAt: null,
      archivedAt: null,
      deletedAt: null
    });
    if (!stillWaiting) {
      await ExhibitorEnquiry.updateOne(
        { _id: enquiry._id },
        { $set: { reminderClaimedAt: null } }
      );
      continue;
    }

    const title = `Follow up with ${enquiry.exhibitorName}`;
    const message = `No response has been recorded for your exhibitor enquiry to ${enquiry.exhibitorName}. Send a follow-up when convenient.`;
    const url = `${CLIENT_URL}/campaigns/exhibitor-discovery`;

    try {
      await Notification.create({
        user: enquiry.organizer,
        title,
        message,
        type: 'in_app',
        metadata: {
          eventType: 'exhibitor_enquiry_reminder',
          enquiryId: enquiry._id,
          url
        }
      });

      const emailResult = await sendEmail({
        to: enquiry.organizerEmail,
        subject: title,
        text: message,
        html: `<p>${escapeHtml(message)}</p><p><a href="${url}">Open your exhibitor enquiries</a></p>`
      });
      if (!emailResult.success) {
        console.warn(`[ExhibitorEnquiryReminder] Email reminder failed for ${enquiry._id}: ${emailResult.error}`);
      }
      await ExhibitorEnquiry.updateOne(
        { _id: enquiry._id, reminderClaimedAt: { $ne: null } },
        { $set: { reminderSentAt: new Date(), reminderClaimedAt: null } }
      );
    } catch (error) {
      await ExhibitorEnquiry.updateOne(
        { _id: enquiry._id, reminderClaimedAt: { $ne: null } },
        { $set: { reminderClaimedAt: null } }
      );
      throw error;
    }
  }

  return dueEnquiries.length;
};
