/**
 * @file rateLimiter.js
 * @description API Rate limiting middleware using express-rate-limit to protect endpoints.
 */

import rateLimit from 'express-rate-limit';

// Standard rate limiter for global API access
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again after 15 minutes.'
  }
});

// Stricter rate limiter for authentication routes (login/register)
export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15, // Limit each IP to 15 login/registration attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many login or registration attempts. Please try again after an hour.'
  }
});

// Rate limiter for WordPress public integrations
export const wordpressLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // Limit WordPress site checks to 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'WordPress integration requests throttled. Please reduce API polling rates.'
  }
});
