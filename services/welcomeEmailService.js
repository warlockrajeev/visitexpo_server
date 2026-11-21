/**
 * @file welcomeEmailService.js
 * @description Sends an automatic Zoho-inspired "Account Created / Welcome to VisitExpo"
 * transactional email via Zoho CPaaS when a user registers for the very first time.
 */

import EmailOtpService from './emailOtpService.js';
import User from '../models/User.js';

const escapeHtml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getClientBaseUrl = () => {
  const raw = String(process.env.CLIENT_URL || 'https://client.visitexpo.in').trim();
  return raw.replace(/\/+$/, '');
};

const getRoleConfig = (role, clientUrl) => {
  const normalized = String(role || 'visitor').toLowerCase();

  if (normalized === 'organizer') {
    return {
      roleLabel: 'Organiser',
      introLine:
        "You're now ready to publish your trade shows, manage exhibitor booths, and welcome business visitors from across the globe.",
      ctaLabel: 'Open Organiser Dashboard',
      ctaUrl: `${clientUrl}/dashboard`,
      sectionSubtitle: 'Everything you need to launch, manage, and grow your exhibitions.',
      features: [
        {
          icon: '&#128197;',
          iconBg: '#EFF6FF',
          iconColor: '#2563EB',
          title: 'Publish & Manage Expos',
          desc: 'Create multi-day trade shows, manage event schedules, venue maps, and publish verified listings instantly.'
        },
        {
          icon: '&#127970;',
          iconBg: '#ECFDF5',
          iconColor: '#059669',
          title: 'Exhibitor Booth Approvals',
          desc: 'Review incoming booth applications, assign stall numbers, and onboard brands into your exhibitor directory.'
        },
        {
          icon: '&#127915;',
          iconBg: '#F5F3FF',
          iconColor: '#7C3AED',
          title: 'Visitor Passes & Leads',
          desc: 'Track live visitor registrations, QR pass check-ins, and audience engagement directly from your portal.'
        },
        {
          icon: '&#128227;',
          iconBg: '#FFFBEB',
          iconColor: '#D97706',
          title: 'Promote Your Event',
          desc: 'Reach thousands of active business buyers using featured spotlights, email promotions, and smart discovery.'
        }
      ]
    };
  }

  if (normalized === 'exhibitor') {
    return {
      roleLabel: 'Exhibitor',
      introLine:
        "You're now ready to showcase your brand at upcoming trade shows, register booths, and capture verified B2B buyer leads.",
      ctaLabel: 'Open Exhibitor Hub',
      ctaUrl: `${clientUrl}/dashboard`,
      sectionSubtitle: 'Everything you need to exhibit, network, and convert booth visitors.',
      features: [
        {
          icon: '&#127978;',
          iconBg: '#EFF6FF',
          iconColor: '#2563EB',
          title: 'Exhibitor Hub & Booths',
          desc: 'Apply for exhibition booths across upcoming trade shows and track booth allocations in one unified workspace.'
        },
        {
          icon: '&#128247;',
          iconBg: '#ECFDF5',
          iconColor: '#059669',
          title: 'Scan Visitor Leads',
          desc: 'Scan attendee QR badges right at your stall to capture, organize, and export high-intent buyer leads.'
        },
        {
          icon: '&#128188;',
          iconBg: '#F5F3FF',
          iconColor: '#7C3AED',
          title: 'Company Profile & Badges',
          desc: 'Customize your public exhibitor profile, brand logo, and issue representative passes for your booth staff.'
        },
        {
          icon: '&#128172;',
          iconBg: '#FFFBEB',
          iconColor: '#D97706',
          title: 'Organisers & Live Chat',
          desc: 'Connect directly with exhibition organisers, get quick booth support, and stay updated on show schedules.'
        }
      ]
    };
  }

  // Default: Visitor
  return {
    roleLabel: 'Visitor',
    introLine:
      "You're now ready to discover verified trade shows, book digital visitor passes, and connect with top exhibitors worldwide.",
    ctaLabel: 'Explore Exhibitions',
    ctaUrl: `${clientUrl}/events`,
    sectionSubtitle: 'Discover upcoming trade shows and connect with industry leaders effortlessly.',
    features: [
      {
        icon: '&#127758;',
        iconBg: '#EFF6FF',
        iconColor: '#2563EB',
        title: 'Discover Trade Shows',
        desc: 'Browse 2,700+ verified exhibitions, B2B summits, and industry expos across India and global destinations.'
      },
      {
        icon: '&#127915;',
        iconBg: '#ECFDF5',
        iconColor: '#059669',
        title: 'Instant Visitor Passes',
        desc: 'Register for upcoming expos in seconds and keep all your digital QR entry badges ready in My Badges.'
      },
      {
        icon: '&#128278;',
        iconBg: '#F5F3FF',
        iconColor: '#7C3AED',
        title: 'Bookmarks & Alerts',
        desc: 'Save favorite events, follow leading exhibitions, and stay ahead with timely schedule reminders.'
      },
      {
        icon: '&#129309;',
        iconBg: '#FFFBEB',
        iconColor: '#D97706',
        title: 'Connect with Exhibitors',
        desc: 'Explore verified exhibitor directories, review participating brands, and plan your venue meetings in advance.'
      }
    ]
  };
};

const renderFeatureCard = (feature) => `
  <td width="50%" valign="top" style="padding:6px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;">
      <tr>
        <td style="padding:16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:8px;">
            <tr>
              <td align="center" valign="middle" width="26" height="26" style="background-color:${feature.iconBg};color:${feature.iconColor};border-radius:6px;font-size:13px;line-height:26px;">
                ${feature.icon}
              </td>
              <td style="padding-left:8px;font-size:13px;font-weight:700;color:#111827;">
                ${escapeHtml(feature.title)}
              </td>
            </tr>
          </table>
          <p style="margin:0;font-size:12px;line-height:1.55;color:#4B5563;">
            ${escapeHtml(feature.desc)}
          </p>
        </td>
      </tr>
    </table>
  </td>
`;

export const buildAccountCreatedEmail = ({ name, email, role, organizationName }) => {
  const clientUrl = getClientBaseUrl();
  const logoUrl = `${clientUrl}/logo.png`;
  const config = getRoleConfig(role, clientUrl);

  const safeName = escapeHtml(String(name || '').trim() || 'there');
  const safeEmail = escapeHtml(String(email || '').trim().toLowerCase());
  const safeOrg = escapeHtml(String(organizationName || '').trim());

  const subject = 'Welcome to VisitExpo — Your Account Is Ready!';

  const text = [
    `Hi ${String(name || '').trim() || 'there'},`,
    '',
    'Welcome to VisitExpo!',
    'Your account is ready.',
    '',
    `Thank you for signing up! ${config.introLine}`,
    '',
    'VisitExpo brings exhibitions, exhibitors, and business visitors together under one roof, all accessible from one unified platform.',
    '',
    `${config.ctaLabel}: ${config.ctaUrl}`,
    `Account Type: ${config.roleLabel}${organizationName ? ` | Organization: ${organizationName}` : ''}`,
    '',
    'EXPLORE WHAT YOU CAN DO:',
    ...config.features.map((f) => `- ${f.title}: ${f.desc}`),
    '',
    'USEFUL RESOURCES:',
    `- Homepage: ${clientUrl}`,
    `- Explore Expos: ${clientUrl}/events`,
    `- Dashboard: ${clientUrl}/dashboard`,
    `- Help & Support: ${clientUrl}/contact`,
    '',
    "If you have any trouble accessing your account or if you think that you've received this email by mistake, please contact support@visitexpo.in.",
    '',
    'Have a great day!',
    'The VisitExpo Team'
  ].join('\n');

  const [f1, f2, f3, f4] = config.features;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to VisitExpo</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F4F6FA;padding:32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:#FFFFFF;border-radius:16px;border:1px solid #E5E7EB;overflow:hidden;box-shadow:0 4px 20px rgba(15,23,42,0.04);">

          <!-- Top Hero Section -->
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              <!-- Brand Header -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:22px;">
                <tr>
                  <td valign="middle">
                    <img src="${logoUrl}" alt="VisitExpo" width="34" height="34" style="display:block;border-radius:50%;border:0;outline:none;text-decoration:none;" />
                  </td>
                  <td valign="middle" style="padding-left:10px;">
                    <div style="font-size:11px;font-weight:700;color:#6B7280;line-height:1.1;letter-spacing:0.3px;">Visit</div>
                    <div style="font-size:16px;font-weight:800;color:#111827;line-height:1.15;letter-spacing:-0.2px;">Expo</div>
                  </td>
                </tr>
              </table>

              <!-- Hero Two-Column Content -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <!-- Left Text Column -->
                  <td width="66%" valign="top" style="padding-right:16px;">
                    <p style="margin:0 0 14px 0;font-size:15px;font-weight:500;color:#1F2937;line-height:1.4;">
                      Hi ${safeName},
                    </p>
                    <h1 style="margin:0 0 2px 0;font-size:23px;font-weight:800;color:#111827;line-height:1.25;letter-spacing:-0.3px;">
                      Welcome to VisitExpo!
                    </h1>
                    <div style="margin:0 0 18px 0;font-size:21px;font-weight:800;color:#2563EB;line-height:1.25;letter-spacing:-0.2px;">
                      Your account is ready.
                    </div>

                    <p style="margin:0 0 12px 0;font-size:13.5px;color:#374151;line-height:1.6;">
                      Thank you for signing up!<br />
                      ${escapeHtml(config.introLine)}
                    </p>
                    <p style="margin:0 0 22px 0;font-size:13.5px;color:#374151;line-height:1.6;">
                      VisitExpo brings trade shows, exhibitors, and business visitors together under one roof — all accessible through one unified dashboard.
                    </p>

                    <!-- Primary CTA Button -->
                    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:12px;">
                      <tr>
                        <td align="center" style="border-radius:8px;background-color:#2563EB;">
                          <a href="${config.ctaUrl}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:13.5px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:8px;">
                            ${escapeHtml(config.ctaLabel)}
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:0;font-size:11.5px;color:#6B7280;line-height:1.5;">
                      Registered as <strong style="color:#374151;">${escapeHtml(config.roleLabel)}</strong>${safeOrg ? ` &bull; ${safeOrg}` : ''} &bull; ${safeEmail}
                    </p>
                  </td>

                  <!-- Right Visual Emblem Column (Gmail-safe orbital motif) -->
                  <td width="34%" valign="middle" align="center" style="padding-left:8px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" align="center">
                      <tr>
                        <td align="center" valign="middle" width="144" height="144" style="border-radius:72px;border:1.5px dashed #DBEAFE;background-color:#F8FAFC;padding:16px;">
                          <table role="presentation" cellspacing="0" cellpadding="0" align="center">
                            <tr>
                              <td align="center" valign="middle" width="96" height="96" style="border-radius:48px;border:1px dashed #BFDBFE;background-color:#FFFFFF;box-shadow:0 4px 14px rgba(37,99,235,0.08);">
                                <img src="${logoUrl}" alt="VisitExpo" width="58" height="58" style="display:block;border-radius:50%;border:0;outline:none;margin:0 auto;" />
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding-top:10px;">
                          <span style="display:inline-block;background-color:#EFF6FF;border:1px solid #DBEAFE;color:#2563EB;font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:999px;">
                            &#10003; Account Verified
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Subtle Divider -->
          <tr>
            <td style="padding:0 32px;">
              <div style="height:1px;background-color:#EEF2F7;font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Middle Features Section -->
          <tr>
            <td style="padding:26px 32px 24px 32px;">
              <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:1.1px;color:#64748B;margin-bottom:6px;">
                AVAILABLE FEATURES
              </div>
              <h2 style="margin:0 0 6px 0;font-size:18px;font-weight:800;color:#111827;letter-spacing:-0.2px;">
                Explore what you can do
              </h2>
              <p style="margin:0 0 16px 0;font-size:13px;color:#4B5563;line-height:1.5;">
                ${escapeHtml(config.sectionSubtitle)}
              </p>

              <!-- 2x2 Feature Cards Grid -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 -6px;width:calc(100% + 12px);">
                <tr>
                  ${renderFeatureCard(f1)}
                  ${renderFeatureCard(f2)}
                </tr>
                <tr>
                  ${renderFeatureCard(f3)}
                  ${renderFeatureCard(f4)}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Subtle Divider -->
          <tr>
            <td style="padding:0 32px;">
              <div style="height:1px;background-color:#EEF2F7;font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Useful Resources + Footer Sign-Off -->
          <tr>
            <td style="padding:24px 32px 32px 32px;">
              <div style="font-size:13.5px;font-weight:700;color:#111827;margin-bottom:12px;">
                Useful Resources
              </div>

              <!-- Pill Buttons Row -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:22px;">
                <tr>
                  <td style="padding-right:8px;padding-bottom:6px;">
                    <a href="${clientUrl}" target="_blank" style="display:inline-block;background-color:#EFF6FF;border:1px solid #DBEAFE;color:#2563EB;font-size:12px;font-weight:600;text-decoration:none;padding:6px 12px;border-radius:6px;">
                      Homepage
                    </a>
                  </td>
                  <td style="padding-right:8px;padding-bottom:6px;">
                    <a href="${clientUrl}/events" target="_blank" style="display:inline-block;background-color:#EFF6FF;border:1px solid #DBEAFE;color:#2563EB;font-size:12px;font-weight:600;text-decoration:none;padding:6px 12px;border-radius:6px;">
                      Explore Expos
                    </a>
                  </td>
                  <td style="padding-right:8px;padding-bottom:6px;">
                    <a href="${clientUrl}/dashboard" target="_blank" style="display:inline-block;background-color:#EFF6FF;border:1px solid #DBEAFE;color:#2563EB;font-size:12px;font-weight:600;text-decoration:none;padding:6px 12px;border-radius:6px;">
                      Dashboard
                    </a>
                  </td>
                  <td style="padding-bottom:6px;">
                    <a href="${clientUrl}/contact" target="_blank" style="display:inline-block;background-color:#EFF6FF;border:1px solid #DBEAFE;color:#2563EB;font-size:12px;font-weight:600;text-decoration:none;padding:6px 12px;border-radius:6px;">
                      Help &amp; Support
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px 0;font-size:12.5px;color:#4B5563;line-height:1.6;">
                If you have any trouble accessing your account or if you think that you've received this email by mistake, please contact
                <a href="mailto:support@visitexpo.in" style="color:#2563EB;text-decoration:none;font-weight:600;">support@visitexpo.in</a>.
              </p>

              <p style="margin:0;font-size:12.5px;color:#374151;line-height:1.6;">
                Have a great day!<br />
                <strong style="color:#111827;">The VisitExpo Team</strong>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, html, text };
};

/**
 * Automatically send the Welcome / Account Created email ONCE for a newly registered user.
 * Safe to invoke without awaiting (never blocks registration response).
 */
export const sendAccountCreatedWelcomeEmail = async ({
  userId,
  name,
  email,
  role = 'visitor',
  organizationName = ''
}) => {
  const normalizedEmail = EmailOtpService.normalizeEmail(email);
  if (!EmailOtpService.isValidEmail(normalizedEmail)) {
    return { success: false, error: 'Invalid recipient email address.' };
  }

  // Atomic idempotency guard: ensure welcome email is only ever sent once per user
  if (userId) {
    try {
      const claimed = await User.findOneAndUpdate(
        { _id: userId, welcomeEmailSentAt: { $exists: false } },
        { $set: { welcomeEmailSentAt: new Date() } },
        { new: false }
      );
      if (!claimed) {
        return { success: true, skipped: true, message: 'Welcome email already sent.' };
      }
    } catch (claimErr) {
      console.error('[WelcomeEmailService] Failed to claim welcomeEmailSentAt flag:', claimErr.message);
    }
  }

  const { subject, html, text } = buildAccountCreatedEmail({
    name,
    email: normalizedEmail,
    role,
    organizationName
  });

  const result = await EmailOtpService.sendTransactionalEmail({
    toEmail: normalizedEmail,
    toName: name,
    subject,
    html,
    text
  });

  if (!result.success) {
    // Roll back the flag if dispatch failed so a retry is possible later
    if (userId) {
      await User.updateOne({ _id: userId }, { $unset: { welcomeEmailSentAt: '' } }).catch(() => {});
    }
    console.error(`[WelcomeEmailService] Failed to send welcome email to ${normalizedEmail}:`, result.error);
    return result;
  }

  console.log(`[WelcomeEmailService] Account created welcome email sent to ${normalizedEmail} via ${result.provider}`);
  return result;
};

export default {
  buildAccountCreatedEmail,
  sendAccountCreatedWelcomeEmail
};
