import express from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Configure Multer memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    // Configure Cloudinary dynamically inside the request handler
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });

    console.log('[Upload] Cloudinary config status:', {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'Missing',
      api_key: process.env.CLOUDINARY_API_KEY ? 'Present' : 'Missing',
      api_secret: process.env.CLOUDINARY_API_SECRET ? 'Present' : 'Missing'
    });
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // Convert file buffer to base64 Data URI
    const fileBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    console.log('[Upload] Uploading file to Cloudinary...');
    const result = await cloudinary.uploader.upload(fileBase64, {
      folder: 'visitexpo',
      resource_type: 'auto'
    });

    res.status(200).json({
      success: true,
      url: result.secure_url,
      publicId: result.public_id
    });
  } catch (error) {
    console.error('[Upload] Cloudinary upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Cloudinary upload failed'
    });
  }
});

export default router;
