const Joi = require("joi");
const multer = require("multer");
const mongoose = require("mongoose");
const cloudinary = require("../utils/cloudinary");
const IDPicture = require("../models/IdPicture");
const Selfie = require("../models/Selfie");
const Credential = require("../models/Credential");
const Worker = require("../models/Worker");
const Client = require("../models/Client");
const logger = require("../utils/logger");
const { decryptAES128 } = require("../utils/encipher");

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// ==================== JOI SCHEMAS ====================
const uploadSchema = Joi.object({
  userId: Joi.string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "Invalid user ID format",
    }),
});

// Approve schema: tolerate unknown fields so stray keys don't fail validation
const approveSchema = Joi.object({
  requireResubmission: Joi.boolean().default(true),
}).unknown(true);

// Separate schema for rejection to capture a human-readable reason
const rejectSchema = Joi.object({
  requireResubmission: Joi.boolean().default(true),
  reason: Joi.string().trim().min(1).max(500).required().messages({
    "any.required": "Rejection reason is required",
    "string.empty": "Rejection reason cannot be empty",
  }),
});

const getPendingSchema = Joi.object({
  page: Joi.number().integer().min(1).max(1000).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  userType: Joi.string().valid("worker", "client", "all").default("worker"),
  sortBy: Joi.string()
    .valid("submittedAt", "firstName", "lastName", "createdAt")
    .default("submittedAt"),
  order: Joi.string().valid("asc", "desc").default("desc"),
});

const SUPPORTED_USER_TYPES = new Set(["worker", "client"]);

const resolveUserContext = async (userId, existingCredential = null) => {
  const credential = existingCredential || (await Credential.findById(userId));
  if (!credential || !SUPPORTED_USER_TYPES.has(credential.userType)) {
    return null;
  }

  const ProfileModel = credential.userType === "worker" ? Worker : Client;
  const profile = await ProfileModel.findOne({ credentialId: userId });
  if (!profile) {
    return null;
  }

  return { credential, profile, ProfileModel };
};

const hasBothDocuments = (profile, newIdPictureId, newSelfieId) => {
  const hasIdPicture = profile.idPictureId || newIdPictureId;
  const hasSelfie = profile.selfiePictureId || newSelfieId;
  return Boolean(hasIdPicture && hasSelfie);
};

// ==================== HELPER FUNCTIONS ====================

const checkBothDocumentsUploaded = async (
  userId,
  newIdPictureId,
  newSelfieId,
  userContext = null
) => {
  try {
    const context = userContext || (await resolveUserContext(userId));
    if (!context) return false;
    return hasBothDocuments(context.profile, newIdPictureId, newSelfieId);
  } catch (error) {
    console.error("Error checking documents:", error);
    return false;
  }
};

const updateUserVerificationStatus = async (
  userId,
  idPictureId,
  selfiePictureId,
  userContext = null
) => {
  try {
    const context = userContext || (await resolveUserContext(userId));
    if (!context) return;

    const { credential, profile, ProfileModel } = context;
    const updateData = {};
    if (idPictureId) updateData.idPictureId = idPictureId;
    if (selfiePictureId) updateData.selfiePictureId = selfiePictureId;

    const bothUploaded = hasBothDocuments(
      profile,
      idPictureId,
      selfiePictureId
    );
    const hasAnyDocument = Boolean(
      profile.idPictureId ||
        profile.selfiePictureId ||
        idPictureId ||
        selfiePictureId
    );
    const now = new Date();

    if (bothUploaded) {
      updateData.idVerificationSubmittedAt = now;
      updateData.verificationStatus = "pending";
      updateData.idVerificationApprovedAt = null;
      updateData.idVerificationRejectedAt = null;
      updateData.approvedByAdminId = null;
      updateData.rejectedByAdminId = null;
      updateData.isVerified = false;
      updateData.verifiedAt = null;
    } else if (hasAnyDocument) {
      updateData.verificationStatus = "pending";
      updateData.idVerificationSubmittedAt =
        profile.idVerificationSubmittedAt || now;
    }

    await ProfileModel.findOneAndUpdate({ credentialId: userId }, updateData, {
      new: true,
    });
  } catch (error) {
    console.error("Error updating user verification status:", error);
  }
};

// ==================== USER CONTROLLERS ====================

// Upload ID Picture
const uploadIDPicture = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = uploadSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      });
    }

    const { userId } = value;

    // Check if user exists and get user type
    const credential = await Credential.findById(userId);
    if (!credential) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!SUPPORTED_USER_TYPES.has(credential.userType)) {
      return res.status(403).json({
        success: false,
        message: "ID verification is only available for workers and clients",
        code: "UNSUPPORTED_USER_TYPE",
      });
    }

    const userContext = await resolveUserContext(userId, credential);

    if (!userContext) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    // Check if file is provided
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    console.log(
      `🆔 Uploading ID picture for ${credential.userType}: ${credential.email}`
    );

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `id_verification/${credential.userType}s/id_pictures`,
          resource_type: "image",
          format: "jpg",
          quality: "auto:good",
          transformation: [
            {
              width: 1200,
              height: 800,
              crop: "limit",
              quality: "auto:good",
            },
          ],
        },
        (error, result) => {
          if (error) {
            console.error("❌ Cloudinary upload error:", error);
            reject(error);
          } else {
            console.log("✅ Cloudinary upload successful:", result.public_id);
            resolve(result);
          }
        }
      );

      uploadStream.end(req.file.buffer);
    });

    // Save to database
    const newIDPicture = new IDPicture({
      url: uploadResult.url,
      public_id: uploadResult.public_id,
      bytes: uploadResult.bytes,
      format: uploadResult.format,
      width: uploadResult.width,
      height: uploadResult.height,
      uploadedBy: userId,
    });

    await newIDPicture.save();
    console.log("✅ ID Picture saved to database:", newIDPicture._id);

    // Update user's verification status
    await updateUserVerificationStatus(
      userId,
      newIDPicture._id,
      null,
      userContext
    );

    // Check if both documents are now complete
    const bothComplete = await checkBothDocumentsUploaded(
      userId,
      newIDPicture._id,
      null,
      userContext
    );

    const completionMessage = bothComplete
      ? credential.userType === "client"
        ? "Both ID and selfie uploaded. Your account is now verified."
        : "Both ID and selfie uploaded. Your documents are now under review."
      : "ID picture uploaded. Please upload your selfie to complete verification.";

    res.status(201).json({
      success: true,
      message: "ID picture uploaded successfully",
      data: {
        idPicture: {
          id: newIDPicture._id,
          url: newIDPicture.url,
          public_id: newIDPicture.public_id,
          bytes: newIDPicture.bytes,
          format: newIDPicture.format,
          dimensions: `${newIDPicture.width}x${newIDPicture.height}`,
          uploadedAt: newIDPicture.createdAt,
        },
        verificationComplete: bothComplete,
        message: completionMessage,
      },
    });
  } catch (error) {
    console.error("💥 Error uploading ID picture:", error);

    // Clean up Cloudinary upload if database save failed
    if (error.uploadResult?.public_id) {
      try {
        await cloudinary.uploader.destroy(error.uploadResult.public_id);
        console.log("🧹 Cleaned up failed Cloudinary upload");
      } catch (cleanupError) {
        console.error("❌ Failed to cleanup Cloudinary upload:", cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      message: "Failed to upload ID picture",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Upload Selfie
const uploadSelfie = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = uploadSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      });
    }

    const { userId } = value;

    // Check if user exists and get user type
    const credential = await Credential.findById(userId);
    if (!credential) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!SUPPORTED_USER_TYPES.has(credential.userType)) {
      return res.status(403).json({
        success: false,
        message: "ID verification is only available for workers and clients",
        code: "UNSUPPORTED_USER_TYPE",
      });
    }

    const userContext = await resolveUserContext(userId, credential);
    if (!userContext) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    // Check if file is provided
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    console.log(
      `🤳 Uploading selfie for ${credential.userType}: ${credential.email}`
    );

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `id_verification/${credential.userType}s/selfies`,
          resource_type: "image",
          format: "jpg",
          quality: "auto:good",
          transformation: [
            {
              width: 800,
              height: 800,
              crop: "limit",
              quality: "auto:good",
            },
          ],
        },
        (error, result) => {
          if (error) {
            console.error("❌ Cloudinary upload error:", error);
            reject(error);
          } else {
            console.log("✅ Cloudinary upload successful:", result.public_id);
            resolve(result);
          }
        }
      );

      uploadStream.end(req.file.buffer);
    });

    // Save to database
    const newSelfie = new Selfie({
      url: uploadResult.url,
      public_id: uploadResult.public_id,
      bytes: uploadResult.bytes,
      format: uploadResult.format,
      width: uploadResult.width,
      height: uploadResult.height,
      uploadedBy: userId,
    });

    await newSelfie.save();
    console.log("✅ Selfie saved to database:", newSelfie._id);

    // Update user's verification status
    await updateUserVerificationStatus(
      userId,
      null,
      newSelfie._id,
      userContext
    );

    // Check if both documents are now complete
    const bothComplete = await checkBothDocumentsUploaded(
      userId,
      null,
      newSelfie._id,
      userContext
    );

    const completionMessage = bothComplete
      ? credential.userType === "client"
        ? "Both ID and selfie uploaded. Your account is now verified."
        : "Both ID and selfie uploaded. Your documents are now under review."
      : "Selfie uploaded. Please upload your ID picture to complete verification.";

    res.status(201).json({
      success: true,
      message: "Selfie uploaded successfully",
      data: {
        selfie: {
          id: newSelfie._id,
          url: newSelfie.url,
          public_id: newSelfie.public_id,
          bytes: newSelfie.bytes,
          format: newSelfie.format,
          dimensions: `${newSelfie.width}x${newSelfie.height}`,
          uploadedAt: newSelfie.createdAt,
        },
        verificationComplete: bothComplete,
        message: completionMessage,
      },
    });
  } catch (error) {
    console.error("💥 Error uploading selfie:", error);

    // Clean up Cloudinary upload if database save failed
    if (error.uploadResult?.public_id) {
      try {
        await cloudinary.uploader.destroy(error.uploadResult.public_id);
        console.log("🧹 Cleaned up failed Cloudinary upload");
      } catch (cleanupError) {
        console.error("❌ Failed to cleanup Cloudinary upload:", cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      message: "Failed to upload selfie",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get user's verification status
const getVerificationStatus = async (req, res) => {
  try {
    const requestedUserId = req.params.userId || req.user?.id;

    if (!requestedUserId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const { error } = uploadSchema.validate({ userId: requestedUserId });
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const context = await resolveUserContext(requestedUserId);

    if (!context) {
      const credential = await Credential.findById(requestedUserId);
      if (credential && !SUPPORTED_USER_TYPES.has(credential.userType)) {
        return res.status(403).json({
          success: false,
          message: "ID verification is not enabled for this user type",
          code: "UNSUPPORTED_USER_TYPE",
        });
      }

      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const { credential, profile } = context;
    await profile.populate(["idPictureId", "selfiePictureId"]);

    res.status(200).json({
      success: true,
      message: "Verification status retrieved successfully",
      data: {
        userType: credential.userType,
        verificationStatus: profile.verificationStatus,
        verificationStatusText: profile.verificationStatusText,
        hasIdPicture: !!profile.idPictureId,
        hasSelfie: !!profile.selfiePictureId,
        hasCompleteVerification: profile.hasCompleteIdVerification,
        canResubmit: profile.canResubmit,
        submittedAt: profile.idVerificationSubmittedAt,
        approvedAt: profile.idVerificationApprovedAt,
        rejectedAt: profile.idVerificationRejectedAt,
        isVerified: profile.isVerified,
        verifiedAt: profile.verifiedAt,
        documents: {
          idPicture: profile.idPictureId
            ? {
                id: profile.idPictureId._id,
                url: profile.idPictureId.url,
                uploadedAt: profile.idPictureId.createdAt,
                status: profile.idPictureId.verificationStatus,
              }
            : null,
          selfie: profile.selfiePictureId
            ? {
                id: profile.selfiePictureId._id,
                url: profile.selfiePictureId.url,
                uploadedAt: profile.selfiePictureId.createdAt,
                status: profile.selfiePictureId.verificationStatus,
              }
            : null,
        },
      },
    });
  } catch (error) {
    console.error("💥 Error getting verification status:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get verification status",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ==================== ADMIN CONTROLLERS ====================

// Get pending verifications for admin review
const getPendingVerifications = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate query parameters
    const { error, value } = getPendingSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      });
    }

    const { page, limit, userType, sortBy, order } = value;
    const skip = (page - 1) * limit;

    // Build aggregation pipeline for both workers and clients
    const buildPipeline = (type) => {
      const matchStage = {
        idPictureId: { $ne: null },
        selfiePictureId: { $ne: null },
      };

      if (type === "worker") {
        matchStage.verificationStatus = "pending";
      } else if (type === "client") {
        matchStage.verificationStatus = { $in: ["pending", "approved"] };
      }

      return [
        {
          $match: matchStage,
        },
      // Join with credentials
      {
        $lookup: {
          from: "credentials",
          localField: "credentialId",
          foreignField: "_id",
          as: "credential",
        },
      },
      { $unwind: "$credential" },
      // Join with ID pictures
      {
        $lookup: {
          from: "idpictures",
          localField: "idPictureId",
          foreignField: "_id",
          as: "idPicture",
        },
      },
      { $unwind: "$idPicture" },
      // Join with selfies
      {
        $lookup: {
          from: "selfies",
          localField: "selfiePictureId",
          foreignField: "_id",
          as: "selfie",
        },
      },
      { $unwind: "$selfie" },
      // Add user type and format fields
      {
        $addFields: {
          userType: type,
          email: "$credential.email",
        },
      },
      // Project needed fields
      {
        $project: {
          _id: 1,
          credentialId: 1,
          firstName: 1,
          lastName: 1,
          middleName: 1,
          suffixName: 1,
          email: 1,
          userType: 1,
          verificationStatus: 1,
          idVerificationSubmittedAt: 1,
          idPicture: {
            _id: "$idPicture._id",
            url: "$idPicture.url",
            uploadedAt: "$idPicture.createdAt",
            bytes: "$idPicture.bytes",
            format: "$idPicture.format",
            dimensions: {
              $concat: [
                { $toString: "$idPicture.width" },
                "x",
                { $toString: "$idPicture.height" },
              ],
            },
          },
          selfie: {
            _id: "$selfie._id",
            url: "$selfie.url",
            uploadedAt: "$selfie.createdAt",
            bytes: "$selfie.bytes",
            format: "$selfie.format",
            dimensions: {
              $concat: [
                { $toString: "$selfie.width" },
                "x",
                { $toString: "$selfie.height" },
              ],
            },
          },
          createdAt: 1,
          isVerified: 1,
        },
      },
    ];
    };

    // Get pending verifications
    let aggregationPromises = [];

    const includeWorkers = userType === "worker" || userType === "all";
    const includeClients = userType === "client" || userType === "all";

    if (includeWorkers) {
      aggregationPromises.push(Worker.aggregate(buildPipeline("worker")));
    }

    if (includeClients) {
      aggregationPromises.push(Client.aggregate(buildPipeline("client")));
    }

    const results = await Promise.all(aggregationPromises);
    let allPendingVerifications = [];

    // Combine results
    results.forEach((result) => {
      allPendingVerifications = allPendingVerifications.concat(result);
    });

    // Decrypt personal data
    const decryptedVerifications = [];
    for (const verification of allPendingVerifications) {
      try {
        if (verification.firstName) {
          verification.firstName = decryptAES128(verification.firstName);
        }
        if (verification.lastName) {
          verification.lastName = decryptAES128(verification.lastName);
        }
        if (verification.middleName) {
          verification.middleName = decryptAES128(verification.middleName);
        }
        if (verification.suffixName) {
          verification.suffixName = decryptAES128(verification.suffixName);
        }

        // Add formatted full name
        verification.fullName = `${verification.firstName} ${
          verification.middleName ? verification.middleName + " " : ""
        }${verification.lastName}${
          verification.suffixName ? " " + verification.suffixName : ""
        }`;

        decryptedVerifications.push(verification);
      } catch (decryptError) {
        logger.error("Decryption error for verification", {
          error: decryptError.message,
          verificationId: verification._id,
        });
      }
    }

    // Sort the combined results
    const sortField =
      sortBy === "submittedAt" ? "idVerificationSubmittedAt" : sortBy;
    decryptedVerifications.sort((a, b) => {
      let aValue = a[sortField];
      let bValue = b[sortField];

      if (sortField === "idVerificationSubmittedAt") {
        aValue = new Date(aValue);
        bValue = new Date(bValue);
      }

      if (order === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    // Apply pagination
    const totalItems = decryptedVerifications.length;
    const paginatedVerifications = decryptedVerifications.slice(
      skip,
      skip + limit
    );
    const totalPages = Math.ceil(totalItems / limit);

    // Get statistics
    const workerCount = decryptedVerifications.filter(
      (item) => item.userType === "worker"
    ).length;
    const clientCount = decryptedVerifications.filter(
      (item) => item.userType === "client"
    ).length;

    const stats = {
      total: totalItems,
      workers: workerCount,
      clients: clientCount,
    };

    const processingTime = Date.now() - startTime;

    logger.info("Pending verifications retrieved", {
      totalRetrieved: paginatedVerifications.length,
      totalPending: totalItems,
      userTypeFilter: userType,
      page,
      limit,
      processingTime: `${processingTime}ms`,
      adminId: req.admin?._id,
    });

    res.status(200).json({
      success: true,
      message: "Pending verifications retrieved successfully",
      code: "PENDING_VERIFICATIONS_RETRIEVED",
      data: {
        verifications: paginatedVerifications,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          itemsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          nextPage: page < totalPages ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null,
        },
        statistics: stats,
        filters: {
          userType,
          sortBy,
          order,
        },
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error("Error retrieving pending verifications", {
      error: error.message,
      stack: error.stack,
      processingTime: `${processingTime}ms`,
      adminId: req.admin?._id,
    });

    res.status(500).json({
      success: false,
      message: "Failed to retrieve pending verifications",
      code: "PENDING_VERIFICATIONS_ERROR",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  }
};

// Approve user's ID verification
const approveVerification = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId } = req.params;
    const { error } = approveSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
        code: "INVALID_USER_ID",
      });
    }

    const credential = await Credential.findById(userId).session(session);
    if (!credential) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    if (!SUPPORTED_USER_TYPES.has(credential.userType)) {
      return res.status(403).json({
        success: false,
        message: "ID verification is only available for workers and clients",
        code: "UNSUPPORTED_USER_TYPE",
      });
    }

    const ProfileModel =
      credential.userType === "worker" ? Worker : Client;

    const userProfile = await ProfileModel.findOne({
      credentialId: userId,
    }).session(session);

    if (!userProfile) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    if (userProfile.verificationStatus !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Cannot approve verification with status: ${userProfile.verificationStatus}`,
        code: "INVALID_VERIFICATION_STATUS",
        currentStatus: userProfile.verificationStatus,
      });
    }

    if (!userProfile.idPictureId || !userProfile.selfiePictureId) {
      return res.status(400).json({
        success: false,
        message: "Incomplete verification documents",
        code: "INCOMPLETE_DOCUMENTS",
        hasIdPicture: !!userProfile.idPictureId,
        hasSelfie: !!userProfile.selfiePictureId,
      });
    }

    const now = new Date();
    userProfile.verificationStatus = "approved";
    userProfile.idVerificationApprovedAt = now;
    userProfile.idVerificationRejectedAt = null;
    userProfile.approvedByAdminId = req.admin?._id || null;
    userProfile.rejectedByAdminId = null;
    userProfile.isVerified = true;
    userProfile.verifiedAt = now;

    await userProfile.save({ session });

    if (userProfile.idPictureId) {
      await IDPicture.findByIdAndUpdate(
        userProfile.idPictureId,
        { verificationStatus: "approved" },
        { session }
      );
    }

    if (userProfile.selfiePictureId) {
      await Selfie.findByIdAndUpdate(
        userProfile.selfiePictureId,
        { verificationStatus: "approved" },
        { session }
      );
    }

    await session.commitTransaction();

    const successMessage =
      credential.userType === "worker"
        ? "ID verification approved successfully - Worker is now verified"
        : "ID verification approved successfully - Client is now verified";

    logger.info("ID verification approved", {
      userId,
      userType: credential.userType,
      email: credential.email,
      approvedBy: req.admin?.userName || req.admin?._id,
    });

    res.status(200).json({
      success: true,
      message: successMessage,
      code: "VERIFICATION_APPROVED",
      data: {
        userId,
        userType: credential.userType,
        email: credential.email,
        verificationStatus: "approved",
        approvedAt: userProfile.idVerificationApprovedAt,
        approvedBy: req.admin?.userName || "Admin",
        isVerified: userProfile.isVerified,
        verifiedAt: userProfile.verifiedAt,
      },
    });
  } catch (error) {
    await session.abortTransaction();

    logger.error("Error approving verification", {
      error: error.message,
      stack: error.stack,
      userId: req.params.userId,
      adminId: req.admin?._id,
    });

    res.status(500).json({
      success: false,
      message: "Failed to approve verification",
      code: "APPROVAL_ERROR",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    session.endSession();
  }
};

// Reject user's ID verification
const rejectVerification = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId } = req.params;
    // Use dedicated rejectSchema so we can reliably capture the rejection reason
    const { error, value } = rejectSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors: error.details.map((detail) => detail.message),
      });
    }

    const { requireResubmission, reason } = value;

    // Validate user ID format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
        code: "INVALID_USER_ID",
      });
    }

    const credential = await Credential.findById(userId).session(session);
    if (!credential) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    if (!SUPPORTED_USER_TYPES.has(credential.userType)) {
      return res.status(403).json({
        success: false,
        message: "ID verification is only available for workers and clients",
        code: "UNSUPPORTED_USER_TYPE",
      });
    }

    const ProfileModel =
      credential.userType === "worker" ? Worker : Client;

    const userProfile = await ProfileModel.findOne({
      credentialId: userId,
    }).session(session);

    if (!userProfile) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // Check if verification is pending
    if (userProfile.verificationStatus !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Cannot reject verification with status: ${userProfile.verificationStatus}`,
        code: "INVALID_VERIFICATION_STATUS",
        currentStatus: userProfile.verificationStatus,
      });
    }

    userProfile.verificationStatus = "rejected";
    userProfile.idVerificationRejectedAt = new Date();
    userProfile.idVerificationApprovedAt = null;
    userProfile.rejectedByAdminId = req.admin?._id || null;
    userProfile.approvedByAdminId = null;
    userProfile.isVerified = false;
    userProfile.verifiedAt = null;

    await userProfile.save({ session });

    if (userProfile.idPictureId) {
      await IDPicture.findByIdAndUpdate(
        userProfile.idPictureId,
        {
          verificationStatus: "rejected",
        },
        { session }
      );
    }

    if (userProfile.selfiePictureId) {
      await Selfie.findByIdAndUpdate(
        userProfile.selfiePictureId,
        {
          verificationStatus: "rejected",
        },
        { session }
      );
    }

    await session.commitTransaction();

    const rejectionMessage =
      credential.userType === "worker"
        ? "ID verification rejected - worker can resubmit documents"
        : "ID verification rejected - client can resubmit documents";

    logger.info("ID verification rejected", {
      userId,
      userType: credential.userType,
      email: credential.email,
      rejectedBy: req.admin?.userName || req.admin?._id,
      reason,
    });

    res.status(200).json({
      success: true,
      message: rejectionMessage,
      code: "VERIFICATION_REJECTED",
      data: {
        userId,
        userType: credential.userType,
        email: credential.email,
        verificationStatus: userProfile.verificationStatus,
        rejectedAt: userProfile.idVerificationRejectedAt,
        rejectedBy: req.admin?.userName || "Admin",
        canResubmit: true,
        isVerified: userProfile.isVerified,
        verifiedAt: userProfile.verifiedAt,
        reason,
      },
    });
  } catch (error) {
    await session.abortTransaction();

    logger.error("Error rejecting verification", {
      error: error.message,
      stack: error.stack,
      userId: req.params.userId,
      adminId: req.admin?._id,
    });

    res.status(500).json({
      success: false,
      message: "Failed to reject verification",
      code: "REJECTION_ERROR",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    session.endSession();
  }
};

module.exports = {
  upload: upload.single("image"),
  uploadIDPicture,
  uploadSelfie,
  getVerificationStatus,
  getPendingVerifications,
  approveVerification,
  rejectVerification,
};
