/**
 * @file db.js
 * @description MongoDB connection setup using Mongoose with event listeners and retry logic.
 */

import mongoose from 'mongoose';

const connectDB = async () => {
  const connString = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/visitexpo';

  const options = {
    autoIndex: true, // Auto-build indexes in development, consider disabling in high-load production
    maxPoolSize: 10,  // Maintain up to 10 socket connections
    serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  };

  // Connection events
  mongoose.connection.on('connected', () => {
    console.log('MongoDB successfully connected to database server.');
  });

  mongoose.connection.on('error', (err) => {
    console.error(`MongoDB connection error: ${err}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB connection disconnected. Attempting to reconnect...');
  });

  try {
    await mongoose.connect(connString, options);
  } catch (error) {
    console.error(`Initial MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
