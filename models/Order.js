/**
 * @file Order.js
 * @description Mongoose schema and model for Platform/Ticket Orders.
 */

import mongoose from 'mongoose';

const OrderItemSchema = new mongoose.Schema({
  ticket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    required: true
  },
  title: String,
  price: Number,
  quantity: { type: Number, required: true }
});

const OrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true
    },
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    buyer: {
      name: { type: String, required: true },
      email: { type: String, required: true },
      phone: String
    },
    items: [OrderItemSchema],
    totalAmount: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending',
      index: true
    },
    paymentMethod: String,
    paymentId: String,
    invoiceUrl: String
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Order', OrderSchema);
