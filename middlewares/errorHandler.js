/**
 * @file errorHandler.js
 * @description Global Error handler middleware to format errors into standard JSON responses.
 */

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log for developers
  console.error('API Error details:', err);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = `Resource not found with id of ${err.value}`;
    error = new Error(message);
    error.statusCode = 404;
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = new Error(message);
    error.statusCode = 400;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new Error(message);
    error.statusCode = 400;
  }

  const statusCode = error.statusCode || 500;
  const responseMessage = error.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    error: responseMessage,
    // Provide stack trace in non-production mode
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
};

export default errorHandler;
