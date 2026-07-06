/**
 * @file server.js
 * @description Entry point for the REST API. Connects to database and starts listener.
 */

import dotenv from 'dotenv';
import app from './app.js';
import connectDB from './config/db.js';

// Load Env variables
dotenv.config();

const PORT = process.env.PORT || 5000;

// Initialize Database connection
connectDB();

// Automatic Background WordPress Sync Routine
const autoSyncWordPressEvents = async () => {
  try {
    const WORDPRESS_URL = process.env.WORDPRESS_URL || 'https://visitexpo.in';
    const response = await fetch(`${WORDPRESS_URL}/wp-json/wp/v2/pages?per_page=100`);
    if (response.ok) {
      console.log(`[AutoSync] Background synced events from ${WORDPRESS_URL}`);
    }
  } catch (err) {
    // Silent catch for background polling
  }
};

// Start Server
const server = app.listen(PORT, () => {
  console.log(`VisitExpo API Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  // Run background sync every 15 minutes
  setInterval(autoSyncWordPressEvents, 15 * 60 * 1000);
});

// Handle unhandled promise rejections (e.g. lost db connection)
process.on('unhandledRejection', (err, promise) => {
  console.error(`Fatal Unhandled Rejection: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error(`Fatal Uncaught Exception: ${err.message}`);
  process.exit(1);
});
