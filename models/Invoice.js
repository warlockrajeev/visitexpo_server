/**
 * @file Invoice.js
 * @description Mongoose schema and model for Billing Invoices.
 */

import mongoose from 'mongoose';

const InvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true
    },
    customer: {
      name: String,
      email: String,
      address: String,
      gst: String
    },
    subtotal: {
      type: Number,
      required: true
    },
    tax: {
      type: Number,
      default: 0
    },
    discount: {
      type: Number,
      default: 0
    },
    total: {
      type: Number,
      required: true
    },
    issuedAt: {
      type: Date,
      default: Date.now
    },
    pdfUrl: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Invoice', InvoiceSchema);
