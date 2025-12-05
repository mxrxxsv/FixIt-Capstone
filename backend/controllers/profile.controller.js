const Joi = require("joi");
const xss = require("xss");
const mongoose = require("mongoose");
const logger = require("../utils/logger");
const Client = require("../models/Client");
const Worker = require("../models/Worker");
const Credential = require("../models/Credential");
const SkillCategory = require("../models/SkillCategory");
const cloudinary = require("../db/cloudinary");
const { encryptAES128, decryptAES128 } = require("../utils/encipher");

// ✅ VALIDATION SCHEMAS
const profilePictureSchema = Joi.object({
  image: Joi.any().required(),
});

const updateBasicProfileSchema = Joi.object({
  firstName: Joi.string().min(2).max(50).required(),
  lastName: Joi.string().min(2).max(50).required(),
  middleName: Joi.string().max(50).allow("", null),
  suffixName: Joi.string().max(10).allow("", null),
  contactNumber: Joi.string()
    .pattern(/^[0-9+\-\s()]+$/)
    .min(7)
    .max(20)
    .required(),
  sex: Joi.string()
    .valid("male", "female", "other", "prefer not to say")
    .required(),
  dateOfBirth: Joi.date().iso().max("now").required(),
  maritalStatus: Joi.string()
    .valid(
      "single",
      "married",
      "separated",
      "divorced",
      "widowed",
      "prefer not to say"
    )
    .required(),
  address: Joi.object({
    region: Joi.string().min(2).max(100).required(),
    province: Joi.string().min(2).max(100).required(),
    city: Joi.string().min(2).max(100).required(),
    barangay: Joi.string().min(2).max(100).required(),
    street: Joi.string().min(2).max(200).required(),
  }).required(),
});

const updateWorkerBiographySchema = Joi.object({
  biography: Joi.string().max(1000).allow(""),
});

const createPortfolioSchema = Joi.object({
  projectTitle: Joi.string().min(2).max(100).required(),
  description: Joi.string().min(10).max(500).required(),
});

const updatePortfolioSchema = Joi.object({
  portfolioId: Joi.string().hex().length(24).required(),
  projectTitle: Joi.string().min(2).max(100).required(),
  description: Joi.string().min(10).max(500).required(),
});

const addExperienceSchema = Joi.object({
  companyName: Joi.string().min(2).max(100).required(),
  position: Joi.string().min(2).max(100).required(),
  startYear: Joi.number()
    .integer()
    .min(1900)
    .max(new Date().getFullYear())
    .required(),
  endYear: Joi.number()
    .integer()
    .min(1900)
    .max(new Date().getFullYear())
    .allow(null),
  responsibilities: Joi.string().max(500).allow(""),
});

const addSkillCategorySchema = Joi.object({
  skillCategoryId: Joi.string().hex().length(24).required(),
});

const addEducationSchema = Joi.object({
  schoolName: Joi.string().trim().min(2).max(200).required().messages({
    "string.empty": "School name is required",
    "string.min": "School name must be at least 2 characters",
    "string.max": "School name must not exceed 200 characters",
  }),
  educationLevel: Joi.string()
    .valid(
      "Elementary",
      "Junior High",
      "Senior High",
      "Vocational",
      "College",
      "Master's",
      "Doctorate"
    )
    .required()
    .messages({
      "any.only": "Invalid education level",
      "any.required": "Education level is required",
    }),
  degree: Joi.string().trim().max(100).allow("", null).optional(),
  startDate: Joi.date().iso().required().messages({
    "date.base": "Start date must be a valid date",
    "any.required": "Start date is required",
  }),
  endDate: Joi.date().iso().required().messages({
    "date.base": "End date must be a valid date",
    "any.required": "End date (or expected) is required",
  }),
  educationStatus: Joi.string()
    .valid("Graduated", "Undergraduate", "Currently Studying")
    .required()
    .messages({
      "any.only": "Invalid education status",
      "any.required": "Education status is required",
    }),
});

const updateEducationSchema = Joi.object({
  educationId: Joi.string().hex().length(24).required(),
  schoolName: Joi.string().trim().min(2).max(200).required(),
  educationLevel: Joi.string()
    .valid(
      "Elementary",
      "Junior High",
      "Senior High",
      "Vocational",
      "College",
      "Master's",
      "Doctorate"
    )
    .required(),
  degree: Joi.string().trim().max(100).allow("", null).optional(),
  startDate: Joi.date().iso().required().messages({
    "date.base": "Start date must be a valid date",
    "any.required": "Start date is required",
  }),
  endDate: Joi.date().iso().required().messages({
    "date.base": "End date must be a valid date",
    "any.required": "End date (or expected) is required",
  }),
  educationStatus: Joi.string()
    .valid("Graduated", "Undergraduate", "Currently Studying")
    .required(),
});

const paramIdSchema = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

// ✅ UTILITY FUNCTIONS
const sanitizeInput = (data) => {
  if (typeof data === "string") {
    return xss(data.trim());
  }
  // Handle Date objects - return them as-is
  if (data instanceof Date) {
    return data;
  }
  if (typeof data === "object" && data !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  return data;
};

const handleProfileError = (err, res, operation, req) => {
  logger.error(`${operation} failed`, {
    error: err.message,
    stack: err.stack,
    userId: req.user?._id,
    userType: req.user?.userType,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    timestamp: new Date().toISOString(),
  });

  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      code: "VALIDATION_ERROR",
      errors: Object.values(err.errors).map((e) => ({
        field: e.path,
        message: e.message,
      })),
    });
  }

  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: "Invalid ID format",
      code: "INVALID_ID",
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
    code: "INTERNAL_ERROR",
  });
};

// ✅ PROFILE PICTURE CONTROLLERS
const uploadProfilePicture = async (req, res) => {
  const startTime = Date.now();

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
        code: "NO_FILE",
      });
    }

    const Model = req.user.userType === "client" ? Client : Worker;
    const profile = await Model.findOne({ credentialId: req.user.id });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // ✅ Delete old profile picture if exists
    if (profile.profilePicture?.public_id) {
      try {
        await cloudinary.uploader.destroy(profile.profilePicture.public_id);
      } catch (deleteError) {
        logger.warn("Failed to delete old profile picture", {
          publicId: profile.profilePicture.public_id,
          error: deleteError.message,
          userId: req.user.id,
        });
      }
    }

    // ✅ Upload new image
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: "profile_pictures",
            public_id: `${req.user.userType}_${req.user.id}_${Date.now()}`,
            transformation: [
              { width: 500, height: 500, crop: "fill", gravity: "face" },
              { quality: "auto", fetch_format: "auto" },
            ],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        )
        .end(req.file.buffer);
    });

    // ✅ Update profile
    profile.profilePicture = {
      url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
    };
    await profile.save();

    const processingTime = Date.now() - startTime;

    logger.info("Profile picture uploaded successfully", {
      userId: req.user.id,
      userType: req.user.userType,
      profileId: profile._id,
      imageUrl: uploadResult.secure_url,
      imageSize: req.file.size,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      message: "Profile picture uploaded successfully",
      data: { image: uploadResult.secure_url },
    });
  } catch (err) {
    const processingTime = Date.now() - startTime;

    logger.error("Profile picture upload failed", {
      error: err.message,
      stack: err.stack,
      userId: req.user?.id,
      ip: req.ip,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return res.status(500).json({
      success: false,
      message: "Server error during image upload",
      code: "UPLOAD_ERROR",
    });
  }
};

const removeProfilePicture = async (req, res) => {
  const startTime = Date.now();

  try {
  const Model = req.user.userType === "client" ? Client : Worker;
  const profile = await Model.findOne({ credentialId: req.user.id });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    if (!profile.profilePicture?.public_id) {
      return res.status(404).json({
        success: false,
        message: "No profile picture found",
        code: "NO_PICTURE",
      });
    }

    // ✅ Delete from Cloudinary
    await cloudinary.uploader.destroy(profile.profilePicture.public_id);

    // ✅ Update profile
    profile.profilePicture = { url: "", public_id: "" };
    await profile.save();

    const processingTime = Date.now() - startTime;

    logger.info("Profile picture removed successfully", {
      userId: req.user._id,
      userType: req.user.userType,
      profileId: profile._id,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Profile picture removed successfully",
      code: "PICTURE_REMOVED",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Remove profile picture", req);
  }
};

// ✅ BASIC PROFILE CONTROLLERS
const updateBasicProfile = async (req, res) => {
  const startTime = Date.now();

  try {
    // ✅ Validate input
    const { error, value } = updateBasicProfileSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Basic profile update validation failed", {
        errors: error.details,
        userId: req.user._id,
        userType: req.user.userType,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const sanitizedData = sanitizeInput(value);

    // ✅ Encrypt sensitive data
    const encryptedData = {
      ...sanitizedData,
      firstName: encryptAES128(sanitizedData.firstName),
      lastName: encryptAES128(sanitizedData.lastName),
      middleName: sanitizedData.middleName
        ? encryptAES128(sanitizedData.middleName)
        : null,
      suffixName: sanitizedData.suffixName
        ? encryptAES128(sanitizedData.suffixName)
        : null,
      contactNumber: encryptAES128(sanitizedData.contactNumber),
    };

    const Model = req.user.userType === "client" ? Client : Worker;
    const profile = await Model.findOneAndUpdate(
      { credentialId: req.user.id },
      encryptedData,
      { new: true, runValidators: true }
    );

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    const processingTime = Date.now() - startTime;

    logger.info("Basic profile updated successfully", {
      userId: req.user._id,
      userType: req.user.userType,
      profileId: profile._id,
      updatedFields: Object.keys(sanitizedData),
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      code: "PROFILE_UPDATED",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Update basic profile", req);
  }
};

// ✅ WORKER-SPECIFIC CONTROLLERS
const updateWorkerBiography = async (req, res) => {
  const startTime = Date.now();

  try {
    if (req.user.userType !== "worker") {
      return res.status(403).json({
        success: false,
        message: "Only workers can update biography",
        code: "ACCESS_DENIED",
      });
    }

    // ✅ Validate input
    const { error, value } = updateWorkerBiographySchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Biography update validation failed", {
        errors: error.details,
        userId: req.user._id,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const sanitizedData = sanitizeInput(value);

    const worker = await Worker.findOneAndUpdate(
      { credentialId: req.user.id },
      { biography: sanitizedData.biography },
      { new: true, runValidators: true }
    );

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    const processingTime = Date.now() - startTime;

    logger.info("Worker biography updated successfully", {
      userId: req.user.id,
      workerId: worker.id,
      biographyLength: sanitizedData.biography.length,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Biography updated successfully",
      code: "BIOGRAPHY_UPDATED",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Update worker biography", req);
  }
};

// ✅ PORTFOLIO CONTROLLERS
const createPortfolio = async (req, res) => {
  const startTime = Date.now();

  try {
    if (req.user.userType !== "worker") {
      return res.status(403).json({
        success: false,
        message: "Only workers can create portfolio items",
        code: "ACCESS_DENIED",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Portfolio image is required",
        code: "NO_IMAGE",
      });
    }

    // ✅ Validate input
    const { error, value } = createPortfolioSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Portfolio creation validation failed", {
        errors: error.details,
        userId: req.user.id,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const sanitizedData = sanitizeInput(value);

    // ✅ Upload image to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: "portfolio",
            public_id: `portfolio_${req.user._id}_${Date.now()}`,
            transformation: [
              { width: 800, height: 600, crop: "fill" },
              { quality: "auto", fetch_format: "auto" },
            ],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        )
        .end(req.file.buffer);
    });

    // ✅ Add to worker portfolio
    const portfolioItem = {
      _id: new mongoose.Types.ObjectId(),
      projectTitle: sanitizedData.projectTitle,
      description: sanitizedData.description,
      image: {
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
      },
    };

    const worker = await Worker.findOneAndUpdate(
      { credentialId: req.user.id },
      { $push: { portfolio: portfolioItem } },
      { new: true, runValidators: true }
    );

    if (!worker) {
      // ✅ Clean up uploaded image if worker not found
      await cloudinary.uploader.destroy(uploadResult.public_id);
      return res.status(404).json({
        success: false,
        message: "Worker profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    const processingTime = Date.now() - startTime;

    logger.info("Portfolio item created successfully", {
      userId: req.user._id,
      workerId: worker._id,
      portfolioId: portfolioItem._id,
      projectTitle: sanitizedData.projectTitle,
      imageUrl: uploadResult.secure_url,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      message: "Portfolio item created successfully",
      code: "PORTFOLIO_CREATED",
      data: {
        portfolioItem: {
          id: portfolioItem._id,
          projectTitle: portfolioItem.projectTitle,
          description: portfolioItem.description,
          image: portfolioItem.image,
        },
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Create portfolio", req);
  }
};

const updatePortfolio = async (req, res) => {
  const startTime = Date.now();

  try {
    if (req.user.userType !== "worker") {
      return res.status(403).json({
        success: false,
        message: "Only workers can update portfolio items",
        code: "ACCESS_DENIED",
      });
    }

    // ✅ Validate input
    const { error, value } = updatePortfolioSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Portfolio update validation failed", {
        errors: error.details,
        userId: req.user._id,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const sanitizedData = sanitizeInput(value);

  const worker = await Worker.findOne({ credentialId: req.user.id });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // ✅ Find portfolio item
    const portfolioItem = worker.portfolio.id(sanitizedData.portfolioId);

    if (!portfolioItem) {
      return res.status(404).json({
        success: false,
        message: "Portfolio item not found",
        code: "PORTFOLIO_NOT_FOUND",
      });
    }

    // ✅ Update portfolio item
    portfolioItem.projectTitle = sanitizedData.projectTitle;
    portfolioItem.description = sanitizedData.description;

    // ✅ Update image if provided
    if (req.file) {
      // Delete old image
      if (portfolioItem.image?.public_id) {
        try {
          await cloudinary.uploader.destroy(portfolioItem.image.public_id);
        } catch (deleteError) {
          logger.warn("Failed to delete old portfolio image", {
            publicId: portfolioItem.image.public_id,
            error: deleteError.message,
          });
        }
      }

      // Upload new image
      const uploadResult = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder: "portfolio",
              public_id: `portfolio_${req.user._id}_${Date.now()}`,
              transformation: [
                { width: 800, height: 600, crop: "fill" },
                { quality: "auto", fetch_format: "auto" },
              ],
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          )
          .end(req.file.buffer);
      });

      portfolioItem.image = {
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
      };
    }

    await worker.save();

    const processingTime = Date.now() - startTime;

    logger.info("Portfolio item updated successfully", {
      userId: req.user._id,
      workerId: worker._id,
      portfolioId: sanitizedData.portfolioId,
      updatedFields: req.file
        ? ["projectTitle", "description", "image"]
        : ["projectTitle", "description"],
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Portfolio item updated successfully",
      code: "PORTFOLIO_UPDATED",
      data: {
        portfolioItem: {
          id: portfolioItem._id,
          projectTitle: portfolioItem.projectTitle,
          description: portfolioItem.description,
          image: portfolioItem.image,
        },
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Update portfolio", req);
  }
};

const deletePortfolio = async (req, res) => {
  const startTime = Date.now();

  try {
    if (req.user.userType !== "worker") {
      return res.status(403).json({
        success: false,
        message: "Only workers can delete portfolio items",
        code: "ACCESS_DENIED",
      });
    }

    // ✅ Validate parameters with Joi
    const { error, value } = paramIdSchema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid portfolio ID",
        code: "INVALID_PARAM",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    // ✅ Sanitize input
    const { id: portfolioId } = sanitizeInput(value);

    // ✅ Find worker by credentialId
    const worker = await Worker.findOne({ credentialId: req.user.id });
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // ✅ Find portfolio item
    const portfolioItem = worker.portfolio.id(portfolioId);
    if (!portfolioItem) {
      return res.status(404).json({
        success: false,
        message: "Portfolio item not found",
        code: "PORTFOLIO_NOT_FOUND",
      });
    }

    // ✅ Delete image from Cloudinary
    if (portfolioItem.image?.public_id) {
      try {
        await cloudinary.uploader.destroy(portfolioItem.image.public_id);
      } catch (deleteError) {
        logger.warn("Failed to delete portfolio image from Cloudinary", {
          publicId: portfolioItem.image.public_id,
          error: deleteError.message,
        });
      }
    }

    // ✅ Remove from portfolio array
    portfolioItem.deleteOne();
    await worker.save();

    const processingTime = Date.now() - startTime;

    // ✅ Logging
    logger.info("Portfolio item deleted successfully", {
      userId: req.user.id,
      workerId: worker._id,
      portfolioId,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      message: "Portfolio item deleted successfully",
      code: "PORTFOLIO_DELETED",
      data: { deletedId: portfolioId },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Delete portfolio error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};

// ✅ CERTIFICATE CONTROLLERS
const uploadCertificate = async (req, res) => {
  const startTime = Date.now();

  try {
    if (req.user.userType !== "worker") {
      return res.status(403).json({
        success: false,
        message: "Only workers can upload certificates",
        code: "ACCESS_DENIED",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Certificate file is required",
        code: "NO_FILE",
      });
    }

    // ✅ Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: "certificates",
            public_id: `certificate_${req.user._id}_${Date.now()}`,
            resource_type: "auto", // Support images and PDFs
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        )
        .end(req.file.buffer);
    });

    // ✅ Add to worker certificates
    const certificate = {
      _id: new mongoose.Types.ObjectId(),
      url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
    };

    const worker = await Worker.findOneAndUpdate(
      { credentialId: req.user.id },
      { $push: { certificates: certificate } },
      { new: true, runValidators: true }
    );

    if (!worker) {
      // ✅ Clean up uploaded file if worker not found
      await cloudinary.uploader.destroy(uploadResult.public_id);
      return res.status(404).json({
        success: false,
        message: "Worker profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    const processingTime = Date.now() - startTime;

    logger.info("Certificate uploaded successfully", {
      userId: req.user._id,
      workerId: worker._id,
      certificateId: certificate._id,
      certificateUrl: uploadResult.secure_url,
      fileSize: req.file.size,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      message: "Certificate uploaded successfully",
      code: "CERTIFICATE_UPLOADED",
      data: {
        certificate: {
          id: certificate._id,
          url: certificate.url,
          public_id: certificate.public_id,
        },
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Upload certificate", req);
  }
};

const deleteCertificate = async (req, res) => {
  const startTime = Date.now();

  try {
    // ✅ Only workers can delete certificates
    if (req.user.userType !== "worker") {
      return res.status(403).json({
        success: false,
        message: "Only workers can delete certificates",
        code: "ACCESS_DENIED",
      });
    }

    // ✅ Validate ID param
    const { error, value } = paramIdSchema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid certificate ID",
        code: "INVALID_PARAM",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const { id: certificateId } = sanitizeInput(value);

    // ✅ Find worker by credentialId (same as portfolio)
    const worker = await Worker.findOne({ credentialId: req.user.id });
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // ✅ Find the certificate in subdocument
    const certificate = worker.certificates.id(certificateId);
    if (!certificate) {
      return res.status(404).json({
        success: false,
        message: "Certificate not found",
        code: "CERTIFICATE_NOT_FOUND",
      });
    }

    // ✅ Delete from Cloudinary if available
    if (certificate.image?.public_id) {
      try {
        await cloudinary.uploader.destroy(certificate.image.public_id);
      } catch (deleteError) {
        logger.warn("Failed to delete certificate image from Cloudinary", {
          publicId: certificate.image.public_id,
          error: deleteError.message,
        });
      }
    }

    // ✅ Remove certificate subdoc and save
    certificate.deleteOne();
    await worker.save();

    const processingTime = Date.now() - startTime;

    // ✅ Logging success
    logger.info("Certificate deleted successfully", {
      userId: req.user._id,
      workerId: worker._id,
      certificateId,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      message: "Certificate deleted successfully",
      code: "CERTIFICATE_DELETED",
      data: { deletedId: certificateId },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("Delete certificate error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
};

// ✅ EXPERIENCE CONTROLLERS
const addExperience = async (req, res) => {
  const startTime = Date.now();

  try {
    if (req.user.userType !== "worker") {
      return res.status(403).json({
        success: false,
        message: "Only workers can add experience",
        code: "ACCESS_DENIED",
      });
    }

    // ✅ Validate input
    const { error, value } = addExperienceSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Experience addition validation failed", {
        errors: error.details,
        userId: req.user._id,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const sanitizedData = sanitizeInput(value);

    // ✅ Validate end year if provided
    if (
      sanitizedData.endYear &&
      sanitizedData.endYear < sanitizedData.startYear
    ) {
      return res.status(400).json({
        success: false,
        message: "End year cannot be earlier than start year",
        code: "INVALID_DATE_RANGE",
      });
    }

    const experience = {
      _id: new mongoose.Types.ObjectId(),
      ...sanitizedData,
    };

    const worker = await Worker.findOneAndUpdate(
      { credentialId: req.user.id },
      { $push: { experience: experience } },
      { new: true, runValidators: true }
    );

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    const processingTime = Date.now() - startTime;

    logger.info("Experience added successfully", {
      userId: req.user._id,
      workerId: worker._id,
      experienceId: experience._id,
      companyName: sanitizedData.companyName,
      position: sanitizedData.position,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      message: "Experience added successfully",
      code: "EXPERIENCE_ADDED",
      data: {
        experience: experience,
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Add experience", req);
  }
};

const deleteExperience = async (req, res) => {
  const startTime = Date.now();

  try {
    if (req.user.userType !== "worker") {
      return res.status(403).json({
        success: false,
        message: "Only workers can delete experience",
        code: "ACCESS_DENIED",
      });
    }

    // ✅ Validate parameters
    const { error, value } = paramIdSchema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid experience ID",
        code: "INVALID_PARAM",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const { id: experienceId } = sanitizeInput(value);

    // ✅ Find worker
    const worker = await Worker.findOne({ credentialId: req.user.id });
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // ✅ Find experience
    const experience = worker.experience.id(experienceId);
    if (!experience) {
      return res.status(404).json({
        success: false,
        message: "Experience not found",
        code: "EXPERIENCE_NOT_FOUND",
      });
    }

    // ✅ Remove experience entry
    experience.deleteOne();
    await worker.save();

    const processingTime = Date.now() - startTime;

    logger.info("Experience deleted successfully", {
      userId: req.user._id,
      workerId: worker._id,
      experienceId,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      message: "Experience deleted successfully",
      code: "EXPERIENCE_DELETED",
      data: { deletedId: experienceId },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Delete experience", req);
  }
};

// ✅ SKILL CATEGORY CONTROLLERS
const addSkillCategory = async (req, res) => {
  const startTime = Date.now();

  try {
    if (req.user.userType !== "worker") {
      return res.status(403).json({
        success: false,
        message: "Only workers can add skill categories",
        code: "ACCESS_DENIED",
      });
    }

    // ✅ Validate input
    const { error, value } = addSkillCategorySchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Skill category addition validation failed", {
        errors: error.details,
        userId: req.user._id,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const { skillCategoryId } = sanitizeInput(value);

    // ✅ Check if skill category exists
    const skillCategory = await SkillCategory.findById(skillCategoryId);

    if (!skillCategory) {
      return res.status(404).json({
        success: false,
        message: "Skill category not found",
        code: "SKILL_CATEGORY_NOT_FOUND",
      });
    }

    const worker = await Worker.findOne({ credentialId: req.user.id });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // ✅ Check if skill category already added
    const existingSkill = worker.skillsByCategory.find(
      (skill) => skill.skillCategoryId.toString() === skillCategoryId
    );

    if (existingSkill) {
      return res.status(400).json({
        success: false,
        message: "Skill category already added",
        code: "SKILL_ALREADY_EXISTS",
      });
    }

    // ✅ Add skill category
    worker.skillsByCategory.push({ skillCategoryId });
    await worker.save();

    const processingTime = Date.now() - startTime;

    logger.info("Skill category added successfully", {
      userId: req.user._id,
      workerId: worker._id,
      skillCategoryId: skillCategoryId,
      skillCategoryName: skillCategory.categoryName,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      message: "Skill category added successfully",
      code: "SKILL_CATEGORY_ADDED",
      data: {
        skillCategory: {
          id: skillCategory._id,
          name: skillCategory.categoryName,
        },
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Add skill category", req);
  }
};

const removeSkillCategory = async (req, res) => {
  const startTime = Date.now();

  try {
    if (req.user.userType !== "worker") {
      return res.status(403).json({
        success: false,
        message: "Only workers can remove skill categories",
        code: "ACCESS_DENIED",
      });
    }

    // ✅ Validate parameters
    const { error, value } = paramIdSchema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid skill category ID",
        code: "INVALID_PARAM",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const { id: skillCategoryId } = sanitizeInput(value);

    // ✅ Use req.user.id (consistent with portfolio & certificate)
    const worker = await Worker.findOne({ credentialId: req.user.id });

    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // ✅ Find and remove skill category
    const skillIndex = worker.skillsByCategory.findIndex(
      (skill) => skill.skillCategoryId.toString() === skillCategoryId
    );

    if (skillIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Skill category not found in worker profile",
        code: "SKILL_NOT_FOUND",
      });
    }

    worker.skillsByCategory.splice(skillIndex, 1);
    await worker.save();

    const processingTime = Date.now() - startTime;

    logger.info("Skill category removed successfully", {
      userId: req.user.id, // ✅ updated for consistency
      workerId: worker._id,
      skillCategoryId: skillCategoryId,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Skill category removed successfully",
      code: "SKILL_CATEGORY_REMOVED",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Remove skill category", req);
  }
};

// ✅ EDUCATION CONTROLLERS
const addEducation = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate input
    const { error, value } = addEducationSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Add education validation failed", {
        errors: error.details,
        userId: req.user._id,
        ip: req.ip,
      });

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const sanitizedData = sanitizeInput(value);
    const userId = req.user._id;
    const userType = req.user.userType;

    // Get user model
    const Model = userType === "worker" ? Worker : Client;
    const user = await Model.findOne({ credentialId: req.user.id });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    // Add education entry
    user.education.push(sanitizedData);
    await user.save();

    const processingTime = Date.now() - startTime;

    logger.info("Education added successfully", {
      userId,
      userType,
      schoolName: sanitizedData.schoolName,
      processingTime: `${processingTime}ms`,
    });

    res.status(201).json({
      success: true,
      message: "Education added successfully",
      code: "EDUCATION_ADDED",
      data: user.education[user.education.length - 1],
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Add education", req);
  }
};

const updateEducation = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate input
    const { error, value } = updateEducationSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Update education validation failed", {
        errors: error.details,
        userId: req.user._id,
        ip: req.ip,
      });

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const { educationId, ...updateData } = sanitizeInput(value);
    const userId = req.user._id;
    const userType = req.user.userType;

    // Get user model
    const Model = userType === "worker" ? Worker : Client;
    const user = await Model.findOne({ credentialId: req.user.id });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    // Find education entry
    const educationEntry = user.education.id(educationId);

    if (!educationEntry) {
      return res.status(404).json({
        success: false,
        message: "Education entry not found",
        code: "EDUCATION_NOT_FOUND",
      });
    }

    // Update education entry
    Object.assign(educationEntry, updateData);
    await user.save();

    const processingTime = Date.now() - startTime;

    logger.info("Education updated successfully", {
      userId,
      userType,
      educationId,
      processingTime: `${processingTime}ms`,
    });

    res.status(200).json({
      success: true,
      message: "Education updated successfully",
      code: "EDUCATION_UPDATED",
      data: educationEntry,
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Update education", req);
  }
};

const deleteEducation = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate parameter
    const { error, value } = paramIdSchema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid education ID",
        code: "INVALID_ID",
      });
    }

    const { id: educationId } = value;
    const userId = req.user._id;
    const userType = req.user.userType;

    // Get user model
    const Model = userType === "worker" ? Worker : Client;
    const user = await Model.findOne({ credentialId: req.user.id });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    // Find and remove education entry
    const educationEntry = user.education.id(educationId);

    if (!educationEntry) {
      return res.status(404).json({
        success: false,
        message: "Education entry not found",
        code: "EDUCATION_NOT_FOUND",
      });
    }

    // Remove education entry
    educationEntry.deleteOne();
    await user.save();

    const processingTime = Date.now() - startTime;

    logger.info("Education deleted successfully", {
      userId,
      userType,
      educationId,
      processingTime: `${processingTime}ms`,
    });

    res.status(200).json({
      success: true,
      message: "Education deleted successfully",
      code: "EDUCATION_DELETED",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Delete education", req);
  }
};

// GET PROFILE CONTROLLERS
const getProfile = async (req, res) => {
  const startTime = Date.now();

  try {
    const { id, userType } = req.user;

    const credentialPromise = Credential.findById(id)
      .select("_id userType isAuthenticated")
      .lean();

    let profileQuery;
    if (userType === "client") {
      profileQuery = Client.findOne({ credentialId: id })
        .select("_id firstName lastName address profilePicture isVerified")
        .lean();
    } else if (userType === "worker") {
      profileQuery = Worker.findOne({ credentialId: id })
        .select(
          "_id firstName lastName address profilePicture isVerified " +
            "portfolio skillsByCategory experience certificates " +
            "idPictureId selfiePictureId idPictureUrl verificationStatus biography education"
        )
        .populate("skillsByCategory.skillCategoryId", "categoryName")
        .lean();
    }

    const [credential, profile] = await Promise.all([
      credentialPromise,
      profileQuery,
    ]);

    if (!credential) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // Decrypt name and address safely
    let decryptedFirstName, decryptedLastName, decryptedAddress;
    try {
      decryptedFirstName = decryptAES128(profile.firstName);
      decryptedLastName = decryptAES128(profile.lastName);

      decryptedAddress = null;
      if (profile.address && typeof profile.address === "object") {
        decryptedAddress = {
          region: profile.address.region
            ? decryptAES128(profile.address.region)
            : "",
          province: profile.address.province
            ? decryptAES128(profile.address.province)
            : "",
          city: profile.address.city
            ? decryptAES128(profile.address.city)
            : "",
          barangay: profile.address.barangay
            ? decryptAES128(profile.address.barangay)
            : "",
          street: profile.address.street
            ? decryptAES128(profile.address.street)
            : "",
        };
      }
    } catch (decryptError) {
      logger.error("Decryption error during getProfile", {
        error: decryptError.message,
        userId: id,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({
        success: false,
        message: "Error retrieving user data",
        code: "DECRYPTION_ERROR",
      });
    }

    // Remove sensitive mongoose-internal fields from embedded profile copy
    const sanitizedProfile = { ...profile };
    delete sanitizedProfile.credentialId;
    delete sanitizedProfile.__v;

    const processingTime = Date.now() - startTime;

    logger.info("Profile retrieved successfully", {
      userId: req.user.id,
      userType: req.user.userType,
      profileId: profile._id,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    // Build response aligned with ver.controller checkAuth, with profile included for backward-compat
    return res.status(200).json({
      success: true,
      message: "Profile retrieved successfully",
      code: "PROFILE_RETRIEVED",
      data: {
        id: credential._id,
        profileId: profile._id,
        fname: decryptedFirstName,
        fullName: `${decryptedFirstName} ${decryptedLastName}`,
        userType: credential.userType,
        isAuthenticated: credential.isAuthenticated,
        isVerified: profile.isVerified,
        address: decryptedAddress,
        image: profile.profilePicture?.url || null,
        ...(userType === "worker" && {
          portfolio: profile.portfolio || [],
          skillsByCategory: profile.skillsByCategory || [],
          experience: profile.experience || [],
          certificates: profile.certificates || [],
          idPictureId: profile.idPictureId,
          selfiePictureId: profile.selfiePictureId,
          idPictureUrl: profile.idPictureUrl,
          verified: profile.verificationStatus,
          biography: profile.biography,
          education: profile.education || [],
        }),
        // Backward-compatibility: include the full profile object
        profile: sanitizedProfile,
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return handleProfileError(err, res, "Get profile", req);
  }
};

// ✅ EXPORTS
module.exports = {
  uploadProfilePicture,
  removeProfilePicture,
  updateBasicProfile,
  updateWorkerBiography,
  createPortfolio,
  updatePortfolio,
  deletePortfolio,
  uploadCertificate,
  deleteCertificate,
  addExperience,
  deleteExperience,
  addSkillCategory,
  removeSkillCategory,
  addEducation,
  updateEducation,
  deleteEducation,
  getProfile,
};
