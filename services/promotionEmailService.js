/**
 * @file promotionEmailService.js
 * @description Nodemailer email transport service dedicated to Organizer Email Promotions
 * utilizing cPanel SMTP on nexus.herosite.pro with promotion@client.visitexpo.in.
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

// Create reusable promotional email transporter
export const createPromotionTransporter = () => {
  const host = process.env.PROMOTION_SMTP_HOST || 'nexus.herosite.pro';
  const port = parseInt(process.env.PROMOTION_SMTP_PORT || '465', 10);
  const secure = process.env.PROMOTION_SMTP_SECURE !== 'false';
  const user = process.env.PROMOTION_SMTP_USER || 'promotion@client.visitexpo.in';
  const pass = process.env.PROMOTION_SMTP_PASS || 'nFMznvLC5^Abd*I+';

  return nodemailer.createTransport({
    host,
    port,
    secure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: {
      user,
      pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });
};

/**
 * Verify active connection to cPanel promotional SMTP
 */
export const verifyPromotionSMTP = async () => {
  const startTime = Date.now();
  try {
    const transporter = createPromotionTransporter();
    await transporter.verify();
    const latencyMs = Date.now() - startTime;
    return {
      success: true,
      message: 'Promotion SMTP connection authenticated successfully',
      host: process.env.PROMOTION_SMTP_HOST || 'nexus.herosite.pro',
      port: process.env.PROMOTION_SMTP_PORT || '465',
      user: process.env.PROMOTION_SMTP_USER || 'promotion@client.visitexpo.in',
      latencyMs
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'SMTP Authentication Failed',
      host: process.env.PROMOTION_SMTP_HOST || 'nexus.herosite.pro',
      user: process.env.PROMOTION_SMTP_USER || 'promotion@client.visitexpo.in'
    };
  }
};

/**
 * Build rich, responsive HTML email template for exhibition promotions
 */
export const buildPromotionEmailHtml = ({
  campaign,
  event,
  organizer,
  recipientName = 'Valued Attendee',
  recipientType = 'visitor'
}) => {
  const title = campaign.title || 'Special Exhibition Invitation';
  const headline = campaign.content?.headline || campaign.content?.subject || title;
  const bodyText = campaign.content?.body || '';
  const preheader = campaign.content?.preheader || `Official update from ${organizer?.name || 'the event organizer'}`;
  const bannerUrl =
    campaign.content?.bannerUrl ||
    event?.bannerImage ||
    event?.featuredImage ||
    event?.logo ||
    'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&auto=format&fit=crop&q=80';

  const clientUrl = process.env.CLIENT_URL || 'https://client.visitexpo.in';
  const wpUrl = process.env.WORDPRESS_URL || 'https://visitexpo.in';
  const defaultCtaUrl = event?.slug ? `${wpUrl}/event/${event.slug}` : `${clientUrl}/events`;
  const ctaUrl = campaign.content?.ctaUrl || defaultCtaUrl;
  const ctaText = campaign.content?.ctaText || 'Explore Exhibition Passes';

  // Format paragraphs from bodyText
  const formattedBody = bodyText
    .split('\n\n')
    .filter(p => p.trim())
    .map(p => `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.7; color: #334155;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  const audienceBadgeText = {
    lead: 'VIP Invited Lead',
    visitor: 'Registered Trade Visitor',
    follower: 'Official Event Follower',
    interested: 'Interested Attendee',
    test: 'Preview / Test Recipient'
  }[recipientType] || 'Exhibition Attendee';

  const eventDates = event?.dates || (event?.startDate ? `${new Date(event.startDate).toLocaleDateString()} - ${event?.endDate ? new Date(event.endDate).toLocaleDateString() : ''}` : 'Upcoming Dates');
  const eventVenue = event?.venue?.name || event?.venueName || event?.venue || event?.city || 'Premier Exhibition Hall';
  const eventCity = event?.city || event?.venue?.city || 'India';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline}</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #1e293b; }
    .wrapper { width: 100%; table-layout: fixed; background-color: #0b0f19; padding: 30px 12px; }
    .container { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); }
    .header-bar { background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%); padding: 24px 32px; text-align: left; }
    .brand-tag { display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); border-radius: 9999px; padding: 4px 14px; color: #ffffff; font-size: 11px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; }
    .audience-tag { float: right; background: #fbbf24; color: #78350f; font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.5px; }
    .hero-banner { width: 100%; max-height: 280px; object-fit: cover; display: block; border-bottom: 1px solid #e2e8f0; }
    .main-body { padding: 36px 32px; }
    .greeting { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
    .headline { font-size: 26px; font-weight: 800; color: #0f172a; line-height: 1.3; margin: 0 0 20px 0; letter-spacing: -0.5px; }
    .event-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; margin: 24px 0; }
    .event-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .event-title { font-size: 17px; font-weight: 800; color: #1e1b4b; margin: 0; }
    .event-meta { font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 8px; }
    .event-meta span { display: inline-block; margin-right: 16px; color: #334155; font-weight: 600; }
    .btn-wrap { text-align: center; margin: 32px 0 24px 0; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); color: #ffffff !important; font-weight: 800; text-decoration: none; padding: 16px 36px; border-radius: 14px; font-size: 15px; box-shadow: 0 8px 24px rgba(79,70,229,0.35); letter-spacing: 0.2px; text-align: center; }
    .organizer-box { background: #f1f5f9; border-radius: 14px; padding: 18px; margin-top: 28px; border-left: 4px solid #4f46e5; }
    .organizer-name { font-size: 14px; font-weight: 800; color: #0f172a; margin: 0 0 4px 0; }
    .organizer-role { font-size: 12px; color: #64748b; margin: 0; }
    .footer { background: #0f172a; padding: 28px 32px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.6; border-top: 1px solid rgba(255,255,255,0.05); }
    .footer a { color: #818cf8; text-decoration: none; font-weight: 600; }
    .footer-badge { display: inline-block; background: rgba(255,255,255,0.06); padding: 4px 12px; border-radius: 6px; font-family: monospace; font-size: 11px; margin-top: 10px; color: #cbd5e1; }
  </style>
</head>
<body>
  <!-- Preheader text hidden in inbox view -->
  <div style="display: none; max-height: 0px; overflow: hidden;">
    ${preheader} &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <div class="wrapper">
    <div class="container">
      <!-- Header -->
      <div class="header-bar">
        <div style="overflow: hidden;">
          <span class="brand-tag">⚡ VisitExpo Verified Promotion</span>
          <span class="audience-tag">${audienceBadgeText}</span>
        </div>
      </div>

      <!-- Banner if present -->
      ${bannerUrl ? `<img src="${bannerUrl}" alt="${event?.title || title}" class="hero-banner" />` : ''}

      <!-- Main Body -->
      <div class="main-body">
        <div class="greeting">Hello ${recipientName || 'Trade Visitor'},</div>
        <h1 class="headline">${headline}</h1>

        <!-- Custom Content Body -->
        <div class="content-text">
          ${formattedBody}
        </div>

        <!-- Event Summary Box -->
        ${event?.title ? `
        <div class="event-card">
          <h3 class="event-title">🏛️ ${event.title}</h3>
          <div class="event-meta">
            <div>📍 <strong>Venue:</strong> ${eventVenue}, ${eventCity}</div>
            <div>📅 <strong>Dates:</strong> ${eventDates}</div>
            ${event.category ? `<div>🏷️ <strong>Category:</strong> ${event.category}</div>` : ''}
          </div>
        </div>
        ` : ''}

        <!-- Call to Action -->
        <div class="btn-wrap">
          <a href="${ctaUrl}" class="cta-button" target="_blank">${ctaText} &rarr;</a>
        </div>

        <!-- Organizer Profile Box -->
        <div class="organizer-box">
          <div class="organizer-name">${organizer?.name || 'Event Management Team'}</div>
          <div class="organizer-role">
            Official Organizer · ${organizer?.organization?.name || organizer?.company || 'Verified Expo Partner'}
            ${organizer?.email ? ` · Contact: ${organizer.email}` : ''}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer">
        <p style="margin: 0 0 10px 0;">
          <strong>VisitExpo Exhibition Network</strong> · India's Premier B2B/B2C Expo Platform<br>
          Sent securely on behalf of ${organizer?.name || 'the event organizer'} via our Growth Plan promotion gateway.
        </p>
        <p style="margin: 0 0 10px 0;">
          You received this email because you are a registered attendee, lead, or interested follower for ${event?.title || 'an exhibition on VisitExpo'}.
        </p>
        <div class="footer-badge">
          Delivered by VisitExpo Mail Relay: promotion@client.visitexpo.in
        </div>
        <p style="margin: 12px 0 0 0; font-size: 11px;">
          <a href="${wpUrl}" target="_blank">VisitExpo Home</a> &bull;
          <a href="${clientUrl}" target="_blank">Organizer Portal</a> &bull;
          <a href="mailto:support@visitexpo.in">Support &amp; Assistance</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
};

/**
 * Send a single promotional email
 */
export const sendPromotionEmail = async ({
  to,
  subject,
  html,
  text,
  replyTo,
  from
}) => {
  try {
    const transporter = createPromotionTransporter();
    const fromAddress =
      from || process.env.PROMOTION_SMTP_FROM || '"VisitExpo Promotions" <promotion@client.visitexpo.in>';

    const mailOptions = {
      from: fromAddress,
      to,
      subject,
      text: text || (html ? html.replace(/<[^>]*>?/gm, '') : ''),
      html,
      replyTo: replyTo || fromAddress,
      headers: {
        'X-VisitExpo-Campaign': 'GrowthPromotion',
        'X-Mailer': 'VisitExpo-Promotion-Relay-1.0'
      }
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[PromotionEmail] Sent successfully to ${to}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[PromotionEmail] Error sending to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Batch dispatch campaign to list of recipients with rate limiting
 */
export const dispatchCampaignBatch = async ({
  campaign,
  event,
  organizer,
  recipients = [],
  delayMs = 300
}) => {
  const recipientsLog = [];
  let deliveredCount = 0;
  let failedCount = 0;

  const subject = campaign.content?.subject || campaign.title || 'Official Exhibition Promotion';

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const html = buildPromotionEmailHtml({
      campaign,
      event,
      organizer,
      recipientName: r.name || 'Valued Attendee',
      recipientType: r.audienceType || 'visitor'
    });

    const replyTo = organizer?.email || process.env.PROMOTION_SMTP_USER || 'promotion@client.visitexpo.in';

    const sendRes = await sendPromotionEmail({
      to: r.email,
      subject,
      html,
      replyTo
    });

    if (sendRes.success) {
      deliveredCount++;
      recipientsLog.push({
        email: r.email,
        name: r.name || '',
        audienceType: r.audienceType || 'visitor',
        status: 'sent',
        error: null,
        sentAt: new Date()
      });
    } else {
      failedCount++;
      recipientsLog.push({
        email: r.email,
        name: r.name || '',
        audienceType: r.audienceType || 'visitor',
        status: 'failed',
        error: sendRes.error || 'Delivery rejected',
        sentAt: new Date()
      });
    }

    // Gentle delay to respect cPanel SMTP connections
    if (i < recipients.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return {
    totalRecipients: recipients.length,
    deliveredCount,
    failedCount,
    recipientsLog
  };
};

export default {
  createPromotionTransporter,
  verifyPromotionSMTP,
  buildPromotionEmailHtml,
  sendPromotionEmail,
  dispatchCampaignBatch
};
