/**
 * @file app.js
 * @description Express application setup, security middlewares, CORS configuration, and routing mounts.
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
import wordpressRoutes from './routes/wordpressRoutes.js';

// Import Error Middleware
import errorHandler from './middlewares/errorHandler.js';

const app = express();

// Enable trust proxy for production deployments behind reverse proxies (Render, Vercel, Cloudflare)
app.set('trust proxy', 1);

// 1. HTTP Security Headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

// 2. Production CORS Policy configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://visitexpo-client.vercel.app',
  'https://visitexpo-admin.vercel.app',
  'https://visitexpo-server.onrender.com',
  'https://dashboard.visitexpo.in',
  'https://admin.visitexpo.in',
  'https://visitexpo.in'
];

if (process.env.CLIENT_URL) allowedOrigins.push(process.env.CLIENT_URL);
if (process.env.ADMIN_URL) allowedOrigins.push(process.env.ADMIN_URL);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, postman, curl) or matched origins / vercel preview deployments
      if (
        !origin ||
        allowedOrigins.indexOf(origin) !== -1 ||
        origin.endsWith('.vercel.app') ||
        origin.endsWith('.onrender.com')
      ) {
        callback(null, true);
      } else {
        callback(new Error(`Blocked by CORS policy for origin: ${origin}`));
      }
    },
    credentials: true, // Allow cookies transfer
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
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
app.use('/api/wordpress', wordpressRoutes);

// Health check endpoint for Render monitoring
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    environment: process.env.NODE_ENV || 'production',
    serverUrl: 'https://visitexpo-server.onrender.com',
    timestamp: new Date()
  });
});

// Root welcome endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'VisitExpo API Server running live on Render',
    docs: 'https://visitexpo-server.onrender.com/api/health'
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
