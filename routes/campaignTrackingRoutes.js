import express from 'express';
import { createHash } from 'crypto';
import Campaign from '../models/Campaign.js';
import Event from '../models/Event.js';

const router = express.Router();
const TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');

const hashTrackingToken = (token) => createHash('sha256').update(token).digest('hex');

const recordRecipientEvent = async (campaignId, token, eventField, countField) => {
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  const recipientMatch = {
    trackingTokenHash: hashTrackingToken(token),
    status: 'sent'
  };
  const campaignMatch = {
    _id: campaignId,
    recipientsLog: { $elemMatch: recipientMatch }
  };
  const updateResult = await Campaign.updateOne(
    {
      _id: campaignId,
      recipientsLog: {
        $elemMatch: {
          ...recipientMatch,
          [eventField]: { $exists: false }
        }
      }
    },
    {
      $set: { [`recipientsLog.$.${eventField}`]: new Date() },
      $inc: { [countField]: 1 }
    }
  );
  if (updateResult.modifiedCount === 1) return true;
  return Boolean(await Campaign.exists(campaignMatch));
};

router.get('/open/:campaignId/:token', async (req, res, next) => {
  try {
    await recordRecipientEvent(req.params.campaignId, req.params.token, 'openedAt', 'openCount');
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'Content-Type': 'image/gif'
    });
    res.status(200).send(TRACKING_PIXEL);
  } catch (error) {
    next(error);
  }
});

router.get('/click/:campaignId/:token', async (req, res, next) => {
  try {
    const token = req.params.token;
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(404).send('Campaign link not found');
    }

    const campaign = await Campaign.findById(req.params.campaignId).select('content event');

    if (!campaign) {
      return res.status(404).send('Campaign link not found');
    }

    const recipientTracked = await recordRecipientEvent(
      campaign._id,
      token,
      'clickedAt',
      'clickCount'
    );
    const event = await Event.findById(campaign.event).select('slug');
    const clientUrl = process.env.CLIENT_URL || 'https://client.visitexpo.in';
    const wpUrl = process.env.WORDPRESS_URL || 'https://visitexpo.in';
    const destination = campaign.content?.ctaUrl ||
      (event?.slug ? `${wpUrl}/event/${event.slug}` : `${clientUrl}/events`);
    const redirectUrl = new URL(destination, clientUrl);

    if (!['http:', 'https:'].includes(redirectUrl.protocol)) {
      return res.status(400).send('Campaign destination is invalid');
    }
    if (recipientTracked) {
      redirectUrl.searchParams.set('ve_campaign', campaign._id.toString());
      redirectUrl.searchParams.set('ve_recipient', token);
    }
    res.redirect(302, redirectUrl.toString());
  } catch (error) {
    next(error);
  }
});

export default router;
