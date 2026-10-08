/**
 * @file UserRepository.js
 * @description User-specific data operations, extending BaseRepository.
 */

import { BaseRepository } from './BaseRepository.js';
import User from '../models/User.js';

class UserRepository extends BaseRepository {
  constructor() {
    super(User);
  }

  async findByEmailWithPassword(email) {
    return await this.model.findOne({ email }).select('+password');
  }

  async findByVerificationToken(token) {
    return await this.model.findOne({ verificationToken: token });
  }

  async findByResetPasswordToken(token) {
    return await this.model.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
  }

  async addRefreshToken(userId, token, expiresAt) {
    const now = new Date();
    // 1. Purge expired tokens
    await this.model.findByIdAndUpdate(userId, {
      $pull: { refreshTokens: { expiresAt: { $lt: now } } }
    });
    // 2. Push active token
    return await this.model.findByIdAndUpdate(
      userId,
      {
        $push: { refreshTokens: { token, expiresAt } }
      },
      { new: true }
    );
  }

  async markRefreshTokenRotated(userId, oldToken, newToken, expiresAt) {
    const now = new Date();
    const graceCutoff = new Date(now.getTime() - 60 * 1000); // 60-second grace window

    // 1. Mark old token as rotated with replacement reference
    await this.model.updateOne(
      { _id: userId, 'refreshTokens.token': oldToken },
      {
        $set: {
          'refreshTokens.$.rotatedAt': now,
          'refreshTokens.$.replacedBy': newToken
        }
      }
    );

    // 2. Purge expired or stale-rotated tokens
    await this.model.findByIdAndUpdate(userId, {
      $pull: {
        refreshTokens: {
          $or: [
            { expiresAt: { $lt: now } },
            { rotatedAt: { $lt: graceCutoff } }
          ]
        }
      }
    });

    // 3. Push newly issued refresh token
    return await this.model.findByIdAndUpdate(
      userId,
      {
        $push: {
          refreshTokens: {
            token: newToken,
            expiresAt
          }
        }
      },
      { new: true }
    );
  }

  async removeRefreshToken(userId, token) {
    return await this.model.findByIdAndUpdate(
      userId,
      {
        $pull: { refreshTokens: { token } }
      },
      { new: true }
    );
  }
}

export default new UserRepository();
