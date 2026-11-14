import mongoose from 'mongoose';

const calendarReminderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    eventKey: {
      type: String,
      required: true,
      trim: true
    },
    eventId: {
      type: String,
      default: '',
      trim: true
    },
    eventSlug: {
      type: String,
      default: '',
      trim: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    dates: {
      type: String,
      default: '',
      trim: true
    },
    venue: {
      type: String,
      default: '',
      trim: true
    },
    city: {
      type: String,
      default: '',
      trim: true
    },
    country: {
      type: String,
      default: '',
      trim: true
    },
    provider: {
      type: String,
      enum: ['google', 'outlook', 'ics', 'apple'],
      default: 'google'
    },
    reminderTimes: {
      type: [String],
      default: ['24h', '1h', '15m']
    },
    userEmail: {
      type: String,
      default: '',
      trim: true
    },
    googleCalendarUrl: {
      type: String,
      default: ''
    },
    savedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

calendarReminderSchema.index({ user: 1, eventKey: 1 }, { unique: true });
calendarReminderSchema.index({ user: 1, savedAt: -1 });

const CalendarReminder =
  mongoose.models.CalendarReminder || mongoose.model('CalendarReminder', calendarReminderSchema);

export default CalendarReminder;
