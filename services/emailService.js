/**
 * @file emailService.js
 * @description Nodemailer email transport service using cPanel/Hostinger SMTP for VisitExpo.
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

// Create reusable Nodemailer transporter
const createTransporter = () => {
  const host = process.env.SMTP_HOST || 'nexus.herosite.pro';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE !== 'false';
  const user = process.env.SMTP_USER || 'support@visitexpo.in';
  const pass = process.env.SMTP_PASS || 'BdMvnk]b_pFOIQPE';

  return nodemailer.createTransport({
    host,
    port,
    secure,
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
 * Send an email using configured SMTP options
 */
export const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const transporter = createTransporter();
    const from = process.env.SMTP_FROM || '"VisitExpo Support" <support@visitexpo.in>';

    const mailOptions = {
      from,
      to,
      subject,
      text: text || html.replace(/<[^>]*>?/gm, ''),
      html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EmailService] Email successfully sent to ${to}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[EmailService] Error sending email to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send Account Created & Approved Notification to Organizer
 */
export const sendOrganizerApprovalNotification = async ({ name, email, orgName, dashboardUrl }) => {
  const url = dashboardUrl || process.env.CLIENT_URL || 'https://visitexpo-client.vercel.app';
  const subject = '🎉 Account Created & Approved Successfully — Welcome to VisitExpo!';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Account Created Successfully</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #1e293b; }
        .wrapper { width: 100%; table-layout: fixed; background-color: #f8fafc; padding: 40px 0; }
        .main-card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 32px; text-align: center; color: #ffffff; }
        .brand-badge { display: inline-block; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); padding: 6px 16px; border-radius: 50px; font-size: 12px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px; }
        .header h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; line-height: 1.2; }
        .content { padding: 36px 32px; }
        .greeting { font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 12px; }
        .lead-text { font-size: 15px; color: #475569; line-height: 1.6; margin-bottom: 24px; }
        .account-box { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 16px; padding: 24px; margin-bottom: 28px; }
        .account-box-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 16px; }
        .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
        .info-row:last-child { border-bottom: none; }
        .info-label { color: #64748b; font-weight: 600; }
        .info-value { color: #0f172a; font-weight: 700; text-align: right; }
        .status-badge { display: inline-block; background: #dcfce7; color: #15803d; font-weight: 800; padding: 2px 10px; border-radius: 50px; font-size: 12px; }
        .feature-list { background: #faf5ff; border: 1px solid #f3e8ff; border-radius: 16px; padding: 20px; margin-bottom: 28px; }
        .feature-title { font-size: 13px; font-weight: 800; color: #7e22ce; margin-bottom: 10px; }
        .feature-item { font-size: 13px; color: #581c87; padding: 4px 0; display: flex; align-items: center; gap: 8px; }
        .btn-container { text-align: center; margin: 32px 0 16px 0; }
        .btn { display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); color: #ffffff !important; font-weight: 800; text-decoration: none; padding: 16px 36px; border-radius: 14px; font-size: 15px; box-shadow: 0 6px 20px rgba(79,70,229,0.35); transition: all 0.2s ease; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5; }
        .footer a { color: #6366f1; text-decoration: none; font-weight: 700; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="main-card">
          <div class="header">
            <div class="brand-badge">VisitExpo Engine</div>
            <h1>Account Created & Approved Successfully 🎉</h1>
          </div>
          <div class="content">
            <div class="greeting">Welcome aboard, ${name}!</div>
            <div class="lead-text">
              We are excited to inform you that your VisitExpo Organizer Account for <strong>${orgName || 'your organization'}</strong> has been reviewed and officially activated by our moderation team.
            </div>

            <div class="account-box">
              <div class="account-box-title">Account Access Credentials</div>
              <div class="info-row">
                <span class="info-label">Organizer Name</span>
                <span class="info-value">${name}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Account Email</span>
                <span class="info-value">${email}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Organization</span>
                <span class="info-value">${orgName || 'VisitExpo Tenant'}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Access Level</span>
                <span class="info-value">Verified Organizer</span>
              </div>
              <div class="info-row">
                <span class="info-label">Account Status</span>
                <span class="info-value"><span class="status-badge">✓ Active & Enabled</span></span>
              </div>
            </div>

            <div class="feature-list">
              <div class="feature-title">⚡ What you can do in your Organizer Dashboard:</div>
              <div class="feature-item">✓ Onboard multi-day expos & sync automatically to WordPress</div>
              <div class="feature-item">✓ Review & approve exhibitor booth applications live</div>
              <div class="feature-item">✓ Monitor real-time visitor check-in velocity & leads</div>
              <div class="feature-item">✓ Generate AI event descriptions & custom venue maps</div>
            </div>

            <div class="btn-container">
              <a href="${url}/login" class="btn" target="_blank">Log In to Organizer Dashboard &rarr;</a>
            </div>
          </div>
          <div class="footer">
            VisitExpo Inc. &bull; Official Event & Expo Synchronization Platform<br>
            Need assistance? Reach us directly at <a href="mailto:support@visitexpo.in">support@visitexpo.in</a> &bull; <a href="https://visitexpo.in">visitexpo.in</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({ to: email, subject, html });
};

/**
 * Send Onboarding / Approval Notification to Exhibitor
 */
export const sendExhibitorApprovalNotification = async ({ companyName, contactEmail, eventName, boothNumber }) => {
  const subject = `✅ Booth Application Approved — ${eventName || 'Expo Event'}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 800; }
        .content { padding: 32px 24px; color: #334155; line-height: 1.6; }
        .box { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 20px; margin: 20px 0; }
        .box p { margin: 6px 0; font-size: 14px; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Booth Application Approved 🎉</h1>
        </div>
        <div class="content">
          <p>Dear <strong>${companyName}</strong> Team,</p>
          <p>We are pleased to inform you that your exhibitor booth application for <strong>${eventName || 'the upcoming Expo'}</strong> has been officially approved!</p>
          
          <div class="box">
            <p><strong>Company Name:</strong> ${companyName}</p>
            <p><strong>Assigned Booth Space:</strong> ${boothNumber || 'Confirmed'}</p>
            <p><strong>Status:</strong> Published & Active</p>
          </div>

          <p>Our event management team will be in touch with further badge printing and booth setup instructions shortly.</p>
        </div>
        <div class="footer">
          VisitExpo Inc. &bull; Support Team &bull; <a href="mailto:support@visitexpo.in" style="color:#10b981;font-weight:700;">support@visitexpo.in</a>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({ to: contactEmail, subject, html });
};
