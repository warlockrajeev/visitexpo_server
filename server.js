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

// Start Server
const server = app.listen(PORT, () => {
  console.log(`VisitExpo API Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
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
