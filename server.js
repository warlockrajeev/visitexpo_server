/**
 * @file server.js
 * @description// Entry point for the REST API. Connects to database and starts listener.
// Includes reviews and FAQ management routes.
 */

import 'dotenv/config';
import app from './app.js';
import connectDB from './config/db.js';
import CalendarService from './services/CalendarService.js';
import WordPressDirectorySyncService from './services/WordPressDirectorySyncService.js';
import { sendExhibitorEnquiryReminders } from './services/exhibitorEnquiryReminderService.js';

const PORT = process.env.PORT || 5000;

// Initialize Database connections
connectDB();

// Automatic Background WordPress Sync Routine (Ingests to MongoDB)
const autoSyncWordPressEvents = async () => {
  try {
    await WordPressDirectorySyncService.syncWordPressEventsToMongoDB();
  } catch (err) {
    console.warn('[AutoSync] Background WordPress sync error:', err.message);
  }
};

// Automatic Scheduled Event Reminder Dispatcher
const runScheduledEventReminders = async () => {
  try {
    await CalendarService.sendUpcomingEventReminders();
  } catch (err) {
    console.error('[ReminderCron] Background reminder dispatch error:', err.message);
  }
};

const runExhibitorEnquiryReminders = async () => {
  try {
    await sendExhibitorEnquiryReminders();
  } catch (err) {
    console.error('[ExhibitorEnquiryReminder] Scheduled reminder error:', err.message);
  }
};

// Start Server
const server = app.listen(PORT, () => {
  console.log(`VisitExpo API Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  // Run background sync every 30 minutes
  setInterval(autoSyncWordPressEvents, 30 * 60 * 1000);
  // Initial sync 5 seconds after boot (non-blocking)
  setTimeout(autoSyncWordPressEvents, 5 * 1000);
  // Run scheduled event reminder checks every 30 minutes
  setInterval(runScheduledEventReminders, 30 * 60 * 1000);
  // Initial check 10 seconds after boot
  setTimeout(runScheduledEventReminders, 10 * 1000);
  // Follow up with exhibitors after four business days without a response
  setInterval(runExhibitorEnquiryReminders, 60 * 60 * 1000);
  setTimeout(runExhibitorEnquiryReminders, 15 * 1000);
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
