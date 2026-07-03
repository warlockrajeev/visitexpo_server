/**
 * @file app.js
 * @description Express application setup, middlewares configuration, and routing mounts.
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';

// Import Route handlers
import authRoutes from './routes/authRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import visitorRoutes from './routes/visitorRoutes.js';
import exhibitorRoutes from './routes/exhibitorRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import campaignRoutes from './routes/campaignRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

// Import Error Middleware
import errorHandler from './middlewares/errorHandler.js';

const app = express();

// 1. HTTP Security Headers
app.use(helmet());

// 2. CORS Policy configuration
const allowedOrigins = [
  'http://localhost:3000', // Organizer Dashboard dev
  'http://localhost:3001', // Super Admin Dashboard dev
  'https://dashboard.visitexpo.in',
  'https://admin.visitexpo.in',
  'https://visitexpo.in'    // Main WordPress site
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Blocked by CORS policy'));
      }
    },
    credentials: true, // Allow cookies transfer
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

// 3. Performance Compression
app.use(compression());

// 4. Request Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// 5. API Routes Mounts
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/visitors', visitorRoutes);
app.use('/api/exhibitors', exhibitorRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date()
  });
});

// 6. Catch-all for non-existing routes
app.use('*', (req, res, next) => {
  const err = new Error(`Cannot find requested route ${req.originalUrl} on this server`);
  err.statusCode = 404;
  next(err);
});

// 7. Global Error Handler Middleware
app.use(errorHandler);

export default app;
