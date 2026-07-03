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
    return await this.model.findByIdAndUpdate(
      userId,
      {
        $push: { refreshTokens: { token, expiresAt } }
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
