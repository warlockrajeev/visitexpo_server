/**
 * @file twoFactorService.js
 * @description 2Factor.in SMS OTP integration service for mobile number verification.
 * API Gateway: https://2factor.in/API/V1/{API_KEY}/SMS/...
 */

import jwt from 'jsonwebtoken';

const TWO_FACTOR_BASE_URL = 'https://2factor.in/API/V1';

export class TwoFactorService {
  /**
   * Normalize input phone number to standard clean format for 2Factor.in
   * Handles Indian formats: +919876543210, 919876543210, 09876543210, 9876543210
   */
  static cleanPhoneNumber(phone) {
    if (!phone) return '';
    let digits = String(phone).replace(/\D/g, '');
    
    // If prefixed with 91 and 12 digits (e.g. 919876543210)
    if (digits.length === 12 && digits.startsWith('91')) {
      digits = digits.substring(2);
    }
    // If prefixed with 0 and 11 digits (e.g. 09876543210)
    if (digits.length === 11 && digits.startsWith('0')) {
      digits = digits.substring(1);
    }
    return digits;
  }

  static getApiKey() {
    return process.env.TWO_FACTOR_API_KEY || 'e100befd-3ed7-11f1-9800-0200cd936042';
  }

  /**
   * Request 2Factor.in to auto-generate and dispatch an SMS OTP
   * @param {string} phone 
   * @returns {Promise<{success: boolean, sessionId?: string, error?: string}>}
   */
  static async sendOtp(phone) {
    const cleanPhone = this.cleanPhoneNumber(phone);
    if (!cleanPhone || cleanPhone.length < 10) {
      return {
        success: false,
        error: 'Please provide a valid 10-digit mobile number'
      };
    }

    const apiKey = this.getApiKey();
    const url = `${TWO_FACTOR_BASE_URL}/${apiKey}/SMS/${cleanPhone}/AUTOGEN`;

    try {
      const response = await fetch(url, { method: 'GET' });
      const data = await response.json();

      if (data.Status === 'Success') {
        return {
          success: true,
          sessionId: data.Details,
          phone: cleanPhone,
          message: 'OTP sent successfully to your mobile number'
        };
      }

      return {
        success: false,
        error: data.Details || 'Failed to dispatch OTP. Please check the mobile number.'
      };
    } catch (err) {
      console.error('2Factor Send OTP Error:', err);
      return {
        success: false,
        error: 'SMS service temporarily unavailable. Please try again in a few moments.'
      };
    }
  }

  /**
   * Verify OTP provided by user against 2Factor.in session
   * @param {string} sessionId 
   * @param {string} otp 
   * @param {string} phone 
   * @returns {Promise<{success: boolean, verificationToken?: string, error?: string}>}
   */
  static async verifyOtp(sessionId, otp, phone) {
    if (!sessionId) {
      return {
        success: false,
        error: 'Session expired or missing. Please request a new OTP.'
      };
    }

    const cleanOtp = String(otp || '').trim();
    if (!cleanOtp || cleanOtp.length < 4) {
      return {
        success: false,
        error: 'Please enter a valid OTP code'
      };
    }

    const cleanPhone = this.cleanPhoneNumber(phone);
    const apiKey = this.getApiKey();
    const url = `${TWO_FACTOR_BASE_URL}/${apiKey}/SMS/VERIFY/${sessionId}/${cleanOtp}`;

    try {
      const response = await fetch(url, { method: 'GET' });
      const data = await response.json();

      if (data.Status === 'Success' && data.Details === 'OTP Matched') {
        // Generate signed verification token valid for 30 minutes
        const verificationToken = this.generateVerificationToken(cleanPhone);

        return {
          success: true,
          message: 'Mobile number verified successfully',
          phone: cleanPhone,
          verificationToken
        };
      }

      return {
        success: false,
        error: data.Details === 'OTP Mismatch' ? 'Incorrect OTP code entered. Please check and try again.' : (data.Details || 'OTP verification failed')
      };
    } catch (err) {
      console.error('2Factor Verify OTP Error:', err);
      return {
        success: false,
        error: 'Verification service temporarily unavailable. Please try again.'
      };
    }
  }

  /**
   * Generate signed phone verification token
   * @param {string} phone 
   * @returns {string}
   */
  static generateVerificationToken(phone) {
    const cleanPhone = this.cleanPhoneNumber(phone);
    const jwtSecret = process.env.JWT_SECRET || 'visitexpo_access_key_super_secret_change_me_in_production';
    return jwt.sign(
      {
        phone: cleanPhone,
        purpose: 'phone_verification',
        verifiedAt: Date.now()
      },
      jwtSecret,
      { expiresIn: '30m' }
    );
  }

  /**
   * Validate signed phone verification token on final registration
   * @param {string} token 
   * @param {string} phone 
   * @returns {boolean}
   */
  static validateVerificationToken(token, phone) {
    if (!token) return false;
    const cleanPhone = this.cleanPhoneNumber(phone);

    try {
      const jwtSecret = process.env.JWT_SECRET || 'visitexpo_access_key_super_secret_change_me_in_production';
      const decoded = jwt.verify(token, jwtSecret);

      if (decoded.purpose !== 'phone_verification') return false;
      if (decoded.phone !== cleanPhone) return false;

      return true;
    } catch (err) {
      return false;
    }
  }
}

export default TwoFactorService;
