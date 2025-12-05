const Joi = require("joi");
const xss = require("xss");
const mongoose = require("mongoose");

// Models
const WorkContract = require("../models/WorkContract");
const Job = require("../models/Job");
const Worker = require("../models/Worker");
const Client = require("../models/Client");
const Conversation = require("../models/Conversation");
const Review = require("../models/Review");

// Utils
const logger = require("../utils/logger");
const { emitToUsers } = require("../socket");
const { decryptAES128 } = require("../utils/encipher");

// Helper to emit to both parties using their credentialIds
async function emitToContractParties(contract, event, payload) {
  try {
    const [client, worker] = await Promise.all([
      Client.findById(contract.clientId).select("credentialId"),
      Worker.findById(contract.workerId).select("credentialId"),
    ]);
    const ids = [client?.credentialId, worker?.credentialId].filter(Boolean);
    if (ids.length) emitToUsers(ids, event, payload);
  } catch (e) {
    logger.warn("Socket emit helper failed", { error: e.message, event });
  }
}

// ==================== JOI SCHEMAS ====================
const contractUpdateSchema = Joi.object({
  status: Joi.string()
    .valid("active", "in_progress", "completed", "cancelled", "disputed")
    .optional()
    .messages({
      "any.only":
        "Status must be one of: active, in_progress, completed, cancelled, disputed",
    }),
});

const feedbackSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required().messages({
    "number.min": "Rating must be between 1 and 5",
    "number.max": "Rating must be between 1 and 5",
    "any.required": "Rating is required",
  }),
  feedback: Joi.string().trim().min(5).max(1000).required().messages({
    "string.min": "Feedback must be at least 5 characters",
    "string.max": "Feedback cannot exceed 1000 characters",
    "any.required": "Feedback is required",
  }),
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).max(1000).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  status: Joi.string()
    .valid("active", "in_progress", "completed", "cancelled", "disputed")
    .optional(),
  contractType: Joi.string()
    .valid("job_application", "direct_invitation")
    .optional(),
  sortBy: Joi.string()
    .valid("createdAt", "agreedRate", "contractStatus", "completedAt")
    .default("createdAt"),
  order: Joi.string().valid("asc", "desc").default("desc"),
});

const paramIdSchema = Joi.object({
  id: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      "string.pattern.base": "Invalid ID format",
      "any.required": "ID is required",
    }),
});

// ==================== HELPER FUNCTIONS ====================
// Helper function for safe decryption
const safeDecrypt = (encryptedData, fieldName = "field") => {
  if (!encryptedData || typeof encryptedData !== "string") {
    return "";
  }

  // Skip decryption for obviously corrupted/invalid data (too short for AES)
  if (encryptedData.length < 16) {
    return encryptedData; // Return original if too short
  }

  try {
    return decryptAES128(encryptedData);
  } catch (error) {
    // Only log if it looks like it should be encrypted (longer strings)
    if (encryptedData.length >= 32) {
      logger.warn(`Decryption failed for ${fieldName}`, {
        error: error.message,
        fieldName,
        dataLength: encryptedData.length,
      });
    }
    return encryptedData; // Return original if decryption fails
  }
};

const sanitizeInput = (input) => {
  if (typeof input === "string") {
    return xss(input.trim(), {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ["script"],
    });
  }
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  return input;
};

const handleContractError = (
  error,
  res,
  operation = "Contract operation",
  req = null
) => {
  logger.error(`${operation} error`, {
    error: error.message,
    stack: error.stack,
    userId: req?.user?.id,
    ip: req?.ip,
    userAgent: req?.get("User-Agent"),
    timestamp: new Date().toISOString(),
  });

  if (error.name === "ValidationError") {
    const mongooseErrors = Object.values(error.errors).map((e) => ({
      field: e.path,
      message: e.message,
      value: e.value,
    }));

    return res.status(400).json({
      success: false,
      message: "Validation error",
      code: "VALIDATION_ERROR",
      errors: mongooseErrors,
    });
  }

  if (process.env.NODE_ENV === "production") {
    return res.status(500).json({
      success: false,
      message: `${operation} failed. Please try again.`,
      code: "CONTRACT_ERROR",
    });
  }

  return res.status(500).json({
    success: false,
    message: error.message,
    code: "CONTRACT_ERROR",
  });
};

// ==================== CONTROLLERS ====================

// Get contracts for client
const getClientContracts = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate query
    const { error, value } = querySchema.validate(req.query);
    if (error) {
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

    const { page, limit, status, contractType, sortBy, order } =
      sanitizeInput(value);

    // Build filter
    const filter = {
      clientId: req.clientProfile._id,
      isDeleted: false,
    };

    if (status) filter.contractStatus = status;
    if (contractType) filter.contractType = contractType;

    const sortOrder = order === "asc" ? 1 : -1;

    // Get contracts with pagination
    const contracts = await WorkContract.find(filter)
      .populate({
        path: "workerId",
        select:
          "firstName lastName profilePicture skills averageRating totalJobsCompleted",
      })
      .populate({
        path: "jobId",
        select: "description price location category",
        populate: {
          path: "category",
          select: "categoryName",
        },
      })
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Get reviews for all contracts in this batch
    const contractIds = contracts.map((c) => c._id);
    const rawReviews = await Review.find({
      contractId: { $in: contractIds },
      isDeleted: false,
    })
      .populate({
        path: "reviewerId",
        select: "firstName lastName profilePicture",
        refPath: "reviewerModel",
      })
      .populate({
        path: "revieweeId",
        select: "firstName lastName profilePicture",
        refPath: "revieweeModel",
      })
      .lean();

    // Map of contractId -> array of reviews
    const reviewMap = {};
    for (const r of rawReviews) {
      const key = String(r.contractId);
      if (!reviewMap[key]) reviewMap[key] = [];

      // Decrypt reviewer/reviewee names and add profile URLs if present
      if (r.reviewerId) {
        r.reviewerId.firstName = safeDecrypt(
          r.reviewerId.firstName,
          "reviewer firstName"
        );
        r.reviewerId.lastName = safeDecrypt(
          r.reviewerId.lastName,
          "reviewer lastName"
        );
        if (r.reviewerId.profilePicture) {
          r.reviewerId.profilePictureUrl =
            r.reviewerId.profilePicture.url || null;
          r.reviewerId.profilePicturePublicId =
            r.reviewerId.profilePicture.public_id || null;
        }
      }
      if (r.revieweeId) {
        r.revieweeId.firstName = safeDecrypt(
          r.revieweeId.firstName,
          "reviewee firstName"
        );
        r.revieweeId.lastName = safeDecrypt(
          r.revieweeId.lastName,
          "reviewee lastName"
        );
        if (r.revieweeId.profilePicture) {
          r.revieweeId.profilePictureUrl =
            r.revieweeId.profilePicture.url || null;
          r.revieweeId.profilePicturePublicId =
            r.revieweeId.profilePicture.public_id || null;
        }
      }

      reviewMap[key].push(r);
    }

    const totalCount = await WorkContract.countDocuments(filter);

    // Get contract statistics
    const stats = await WorkContract.aggregate([
      {
        $match: {
          clientId: new mongoose.Types.ObjectId(req.clientProfile._id),
        },
      },
      {
        $group: {
          _id: null,
          totalContracts: { $sum: 1 },
          activeContracts: {
            $sum: {
              $cond: [
                { $in: ["$contractStatus", ["active", "in_progress"]] },
                1,
                0,
              ],
            },
          },
          completedContracts: {
            $sum: { $cond: [{ $eq: ["$contractStatus", "completed"] }, 1, 0] },
          },
          averageRating: { $avg: "$clientRating" },
        },
      },
    ]);

    const processingTime = Date.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Client contracts retrieved successfully",
      code: "CLIENT_CONTRACTS_RETRIEVED",
      data: {
        contracts: contracts.map((contract) => {
          const { createdIP, ...safeContract } = contract;
          return safeContract;
        }).map((contract) => ({
          ...contract,
          reviews: reviewMap[contract._id.toString()] || [],
        })),
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalItems: totalCount,
          itemsPerPage: limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
        statistics: stats[0] || {
          totalContracts: 0,
          activeContracts: 0,
          completedContracts: 0,
          averageRating: 0,
        },
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
    // No socket emits for list endpoint
  } catch (error) {
    return handleContractError(error, res, "Get client contracts", req);
  }
};

// Get contracts for worker
const getWorkerContracts = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate query
    const { error, value } = querySchema.validate(req.query);
    if (error) {
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

    const { page, limit, status, contractType, sortBy, order } =
      sanitizeInput(value);

    // Build filter
    const filter = {
      workerId: req.workerProfile._id,
      isDeleted: false,
    };

    if (status) filter.contractStatus = status;
    if (contractType) filter.contractType = contractType;

    const sortOrder = order === "asc" ? 1 : -1;

    // Get contracts with pagination
    const contracts = await WorkContract.find(filter)
      .populate({
        path: "clientId",
        select:
          "firstName lastName profilePicture averageRating totalJobsPosted",
      })
      .populate({
        path: "jobId",
        select: "description price location category title",
        populate: {
          path: "category",
          select: "categoryName",
        },
      })
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Get reviews for all contracts in this batch
    const contractIds = contracts.map((contract) => contract._id);
    const rawReviews = await Review.find({
      contractId: { $in: contractIds },
      isDeleted: false,
    })
      .populate({
        path: "reviewerId",
        select: "firstName lastName profilePicture",
        refPath: "reviewerModel",
      })
      .populate({
        path: "revieweeId",
        select: "firstName lastName profilePicture",
        refPath: "revieweeModel",
      })
      .lean();

    // Create a map of reviews by contract ID -> array
    const reviewMap = {};
    rawReviews.forEach((r) => {
      const key = r.contractId.toString();
      if (!reviewMap[key]) reviewMap[key] = [];

      // Decrypt names and add profile URLs
      if (r.reviewerId) {
        r.reviewerId.firstName = safeDecrypt(
          r.reviewerId.firstName,
          "reviewer firstName"
        );
        r.reviewerId.lastName = safeDecrypt(
          r.reviewerId.lastName,
          "reviewer lastName"
        );
        if (r.reviewerId.profilePicture) {
          r.reviewerId.profilePictureUrl =
            r.reviewerId.profilePicture.url || null;
          r.reviewerId.profilePicturePublicId =
            r.reviewerId.profilePicture.public_id || null;
        }
      }
      if (r.revieweeId) {
        r.revieweeId.firstName = safeDecrypt(
          r.revieweeId.firstName,
          "reviewee firstName"
        );
        r.revieweeId.lastName = safeDecrypt(
          r.revieweeId.lastName,
          "reviewee lastName"
        );
        if (r.revieweeId.profilePicture) {
          r.revieweeId.profilePictureUrl =
            r.revieweeId.profilePicture.url || null;
          r.revieweeId.profilePicturePublicId =
            r.revieweeId.profilePicture.public_id || null;
        }
      }

      reviewMap[key].push(r);
    });

    const totalCount = await WorkContract.countDocuments(filter);

    // Get contract statistics
    const stats = await WorkContract.aggregate([
      {
        $match: {
          workerId: new mongoose.Types.ObjectId(req.workerProfile._id),
        },
      },
      {
        $group: {
          _id: null,
          totalContracts: { $sum: 1 },
          activeContracts: {
            $sum: {
              $cond: [
                { $in: ["$contractStatus", ["active", "in_progress"]] },
                1,
                0,
              ],
            },
          },
          completedContracts: {
            $sum: { $cond: [{ $eq: ["$contractStatus", "completed"] }, 1, 0] },
          },
          averageRating: { $avg: "$workerRating" },
        },
      },
    ]);

    const processingTime = Date.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Worker contracts retrieved successfully",
      code: "WORKER_CONTRACTS_RETRIEVED",
      data: {
        contracts: contracts.map((contract) => {
          const { createdIP, ...safeContract } = contract;

          // Decrypt client names and enhance profile info
          if (safeContract.clientId) {
            safeContract.clientId.firstName = safeDecrypt(
              safeContract.clientId.firstName,
              "client firstName"
            );
            safeContract.clientId.lastName = safeDecrypt(
              safeContract.clientId.lastName,
              "client lastName"
            );

            // Add profile picture URL and public_id if available
            if (safeContract.clientId.profilePicture) {
              safeContract.clientId.profilePictureUrl =
                safeContract.clientId.profilePicture.url || null;
              safeContract.clientId.profilePicturePublicId =
                safeContract.clientId.profilePicture.public_id || null;
            } else {
              safeContract.clientId.profilePictureUrl = null;
              safeContract.clientId.profilePicturePublicId = null;
            }
          }

          // Attach all reviews for this contract (array)
          const reviewsForContract = reviewMap[safeContract._id.toString()] || [];
          return {
            ...safeContract,
            reviews: reviewsForContract,
            // Backward compatibility fields
            review: reviewsForContract[0] || null,
            hasReview: reviewsForContract.length > 0,
          };
        }),
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalItems: totalCount,
          itemsPerPage: limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
        statistics: stats[0] || {
          totalContracts: 0,
          activeContracts: 0,
          completedContracts: 0,
          averageRating: 0,
        },
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
    // No socket emits for list endpoint
  } catch (error) {
    return handleContractError(error, res, "Get worker contracts", req);
  }
};

// Get single contract details
const getContractDetails = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate parameters
    const { error, value } = paramIdSchema.validate(req.params);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid contract ID",
        code: "INVALID_PARAM",
      });
    }

    const { id: contractId } = sanitizeInput(value);

    // Build filter based on user type
    const filter = { _id: contractId, isDeleted: false };
    if (req.user.userType === "client") {
      filter.clientId = req.clientProfile._id;
    } else {
      filter.workerId = req.workerProfile._id;
    }

    const contract = await WorkContract.findOne(filter)
      .populate({
        path: "clientId",
        select:
          "firstName lastName profilePicture averageRating totalJobsPosted",
      })
      .populate({
        path: "workerId",
        select:
          "firstName lastName profilePicture skills averageRating totalJobsCompleted",
      })
      .populate({
        path: "jobId",
        select: "description price location category title",
        populate: {
          path: "category",
          select: "categoryName",
        },
      })
      .lean();

    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Contract not found",
        code: "CONTRACT_NOT_FOUND",
      });
    }

    // Get reviews for this contract
    const review = await Review.find({
      contractId: contract._id,
      isDeleted: false,
    })
      .populate({
        path: "reviewerId",
        select: "firstName lastName profilePicture",
        refPath: "reviewerModel",
      })
      .populate({
        path: "revieweeId",
        select: "firstName lastName profilePicture",
        refPath: "revieweeModel",
      })
      .lean();

    // Decrypt client names and enhance profile info
    if (contract.clientId) {
      contract.clientId.firstName = safeDecrypt(
        contract.clientId.firstName,
        "client firstName"
      );
      contract.clientId.lastName = safeDecrypt(
        contract.clientId.lastName,
        "client lastName"
      );

      // Add profile picture URL and public_id if available
      if (contract.clientId.profilePicture) {
        contract.clientId.profilePictureUrl =
          contract.clientId.profilePicture.url || null;
        contract.clientId.profilePicturePublicId =
          contract.clientId.profilePicture.public_id || null;
      } else {
        contract.clientId.profilePictureUrl = null;
        contract.clientId.profilePicturePublicId = null;
      }
    }

    // Decrypt worker names and enhance profile info
    if (contract.workerId) {
      contract.workerId.firstName = safeDecrypt(
        contract.workerId.firstName,
        "worker firstName"
      );
      contract.workerId.lastName = safeDecrypt(
        contract.workerId.lastName,
        "worker lastName"
      );

      // Add profile picture URL and public_id if available
      if (contract.workerId.profilePicture) {
        contract.workerId.profilePictureUrl =
          contract.workerId.profilePicture.url || null;
        contract.workerId.profilePicturePublicId =
          contract.workerId.profilePicture.public_id || null;
      } else {
        contract.workerId.profilePictureUrl = null;
        contract.workerId.profilePicturePublicId = null;
      }
    }

    // Decrypt review names if reviews exist
    if (review && review.length > 0) {
      review.forEach((singleReview) => {
        if (singleReview.reviewerId) {
          singleReview.reviewerId.firstName = safeDecrypt(
            singleReview.reviewerId.firstName,
            "reviewer firstName"
          );
          singleReview.reviewerId.lastName = safeDecrypt(
            singleReview.reviewerId.lastName,
            "reviewer lastName"
          );

          // Add reviewer profile picture info
          if (singleReview.reviewerId.profilePicture) {
            singleReview.reviewerId.profilePictureUrl =
              singleReview.reviewerId.profilePicture.url || null;
            singleReview.reviewerId.profilePicturePublicId =
              singleReview.reviewerId.profilePicture.public_id || null;
          }
        }

        if (singleReview.revieweeId) {
          singleReview.revieweeId.firstName = safeDecrypt(
            singleReview.revieweeId.firstName,
            "reviewee firstName"
          );
          singleReview.revieweeId.lastName = safeDecrypt(
            singleReview.revieweeId.lastName,
            "reviewee lastName"
          );

          // Add reviewee profile picture info
          if (singleReview.revieweeId.profilePicture) {
            singleReview.revieweeId.profilePictureUrl =
              singleReview.revieweeId.profilePicture.url || null;
            singleReview.revieweeId.profilePicturePublicId =
              singleReview.revieweeId.profilePicture.public_id || null;
          }
        }
      });
    }

    const processingTime = Date.now() - startTime;

    logger.info("Contract details retrieved successfully", {
      contractId,
      userId: req.user.id,
      userType: req.user.userType,
      hasReview: review && review.length > 0,
      reviewCount: review ? review.length : 0,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Contract details retrieved successfully",
      code: "CONTRACT_DETAILS_RETRIEVED",
      data: {
        contract: {
          ...contract,
          createdIP: undefined, // Remove sensitive data
        },
        review: review || [],
        reviews: review || [],
        hasReview: review && review.length > 0,
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
    // No socket emits for details endpoint
  } catch (error) {
    return handleContractError(error, res, "Get contract details", req);
  }
};

// Worker starts work
const startWork = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate parameters
    const { error, value } = paramIdSchema.validate(req.params);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid contract ID",
        code: "INVALID_PARAM",
      });
    }

    const { id: contractId } = sanitizeInput(value);

    // Find contract
    const contract = await WorkContract.findOne({
      _id: contractId,
      workerId: req.workerProfile._id,
      contractStatus: "active",
      isDeleted: false,
    });

    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Contract not found or cannot be started",
        code: "CONTRACT_NOT_FOUND",
      });
    }

    // Check if worker is available to start work
    const worker = await Worker.findById(req.workerProfile._id);
    if (!worker || !worker.canAcceptNewContract()) {
      return res.status(409).json({
        success: false,
        message:
          "You are already working on another job. Please complete your current work before starting a new one.",
        code: "WORKER_NOT_AVAILABLE",
      });
    }

    // Update contract
    contract.contractStatus = "in_progress";
    contract.startDate = new Date();
    await contract.save();

    // Update worker status to "working" and set current job using helper method
    if (worker) {
      worker.startWorking(contract.jobId);
      await worker.save();
    }

    const processingTime = Date.now() - startTime;

    logger.info("Work started successfully", {
      contractId,
      workerId: req.workerProfile._id,
      jobId: contract.jobId,
      userId: req.user.id,
      ip: req.ip,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Work started successfully",
      code: "WORK_STARTED",
      data: contract.toSafeObject(),
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
    // Notify both parties: work status changed
    emitToContractParties(contract, "contract:updated", {
      contractId: contract._id,
      status: contract.contractStatus, // in_progress
    });
  } catch (error) {
    return handleContractError(error, res, "Start work", req);
  }
};

// Worker completes work
const completeWork = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate parameters
    const { error, value } = paramIdSchema.validate(req.params);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid contract ID",
        code: "INVALID_PARAM",
      });
    }

    const { id: contractId } = sanitizeInput(value);

    // Find contract
    const contract = await WorkContract.findOne({
      _id: contractId,
      workerId: req.workerProfile._id,
      contractStatus: "in_progress",
      isDeleted: false,
    });

    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Contract not found or cannot be completed",
        code: "CONTRACT_NOT_FOUND",
      });
    }

    // Update contract - mark as awaiting client confirmation
    contract.contractStatus = "awaiting_client_confirmation";
    contract.workerCompletedAt = new Date();
    await contract.save();

    // Update worker status back to "available" and clear current job using helper method
    const worker = await Worker.findById(req.workerProfile._id);
    if (worker) {
      worker.becomeAvailable();
      await worker.save();
    }

    // Update job status if linked to a job
    if (contract.jobId) {
      await Job.findByIdAndUpdate(contract.jobId, {
        status: "completed",
      });
    }

    const processingTime = Date.now() - startTime;

    logger.info("Work completed successfully", {
      contractId,
      workerId: req.workerProfile._id,
      userId: req.user.id,
      ip: req.ip,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Work marked as completed. Awaiting client confirmation.",
      code: "WORK_COMPLETION_SUBMITTED",
      data: contract.toSafeObject(),
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
    // Notify both parties: awaiting client confirmation
    emitToContractParties(contract, "contract:updated", {
      contractId: contract._id,
      status: contract.contractStatus, // awaiting_client_confirmation
    });
  } catch (error) {
    return handleContractError(error, res, "Complete work", req);
  }
};

// Client confirms work completion
const confirmWorkCompletion = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate parameters
    const { error, value } = paramIdSchema.validate(req.params);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid contract ID",
        code: "INVALID_PARAM",
      });
    }

    const { id: contractId } = sanitizeInput(value);

    // Find contract
    const contract = await WorkContract.findOne({
      _id: contractId,
      clientId: req.clientProfile._id,
      contractStatus: "awaiting_client_confirmation",
      isDeleted: false,
    });

    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Contract not found or not awaiting confirmation",
        code: "CONTRACT_NOT_FOUND",
      });
    }

    // Update contract to completed
    contract.contractStatus = "completed";
    contract.completedAt = new Date();
    contract.actualEndDate = new Date();
    contract.clientConfirmedAt = new Date();
    await contract.save();

    // Update job status if linked to a job
    if (contract.jobId) {
      await Job.findByIdAndUpdate(contract.jobId, {
        status: "completed",
      });
    }

    // Increment worker's completed jobs count to reflect actual completions
    try {
      await Worker.findByIdAndUpdate(contract.workerId, {
        $inc: { totalJobsCompleted: 1 },
      });
    } catch (_) {}

    const processingTime = Date.now() - startTime;

    logger.info("Work completion confirmed by client", {
      contractId,
      clientId: req.clientProfile._id,
      userId: req.user.id,
      ip: req.ip,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Work completion confirmed successfully",
      code: "WORK_COMPLETION_CONFIRMED",
      data: contract.toSafeObject(),
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
    // Notify both parties: work completed
    emitToContractParties(contract, "contract:updated", {
      contractId: contract._id,
      status: contract.contractStatus, // completed
    });
  } catch (error) {
    return handleContractError(error, res, "Confirm work completion", req);
  }
};

// Submit feedback and rating
const submitFeedback = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate parameters
    const { error: paramError, value: paramValue } = paramIdSchema.validate(
      req.params
    );
    if (paramError) {
      return res.status(400).json({
        success: false,
        message: "Invalid contract ID",
        code: "INVALID_PARAM",
      });
    }

    // Validate body
    const { error: bodyError, value: bodyValue } = feedbackSchema.validate(
      req.body
    );
    if (bodyError) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: bodyError.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const { id: contractId } = sanitizeInput(paramValue);
    const { rating, feedback } = sanitizeInput(bodyValue);

    // Build filter based on user type
    const filter = {
      _id: contractId,
      contractStatus: "completed",
      isDeleted: false,
    };

    if (req.user.userType === "client") {
      filter.clientId = req.clientProfile._id;
    } else {
      filter.workerId = req.workerProfile._id;
    }

    const contract = await WorkContract.findOne(filter);

    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Contract not found or not completed",
        code: "CONTRACT_NOT_FOUND",
      });
    }

    // Check if review already exists for this contract and user
    const existingReview = await Review.findOne({
      contractId: contract._id,
      reviewerType: req.user.userType,
      isDeleted: false,
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "You have already submitted a review for this contract",
        code: "REVIEW_ALREADY_EXISTS",
      });
    }

    // Determine reviewer and reviewee details
    let reviewerData, revieweeData;

    if (req.user.userType === "client") {
      // Client reviewing worker
      reviewerData = {
        reviewerId: req.clientProfile._id,
        reviewerModel: "Client",
        reviewerType: "client",
      };
      revieweeData = {
        revieweeId: contract.workerId,
        revieweeModel: "Worker",
        revieweeType: "worker",
      };
    } else {
      // Worker reviewing client
      reviewerData = {
        reviewerId: req.workerProfile._id,
        reviewerModel: "Worker",
        reviewerType: "worker",
      };
      revieweeData = {
        revieweeId: contract.clientId,
        revieweeModel: "Client",
        revieweeType: "client",
      };
    }

    // Create the review
    const review = new Review({
      contractId: contract._id,
      workerId: contract.workerId,
      clientId: contract.clientId,
      jobId: contract.jobId,
      rating,
      feedback,
      ...reviewerData,
      ...revieweeData,
    });

    await review.save();

    // Populate the review for response
    const populatedReview = await Review.findById(review._id)
      .populate("reviewerId", "firstName lastName profilePicture")
      .populate("revieweeId", "firstName lastName profilePicture")
      .populate("jobId", "title description")
      .lean();

    const processingTime = Date.now() - startTime;

    logger.info("Review submitted successfully", {
      contractId,
      reviewId: review._id,
      userType: req.user.userType,
      rating,
      userId: req.user.id,
      ip: req.ip,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      message: "Review submitted successfully",
      code: "REVIEW_SUBMITTED",
      data: {
        review: populatedReview,
        contractId: contract._id,
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });

    // Notify both parties: review submitted
    emitToContractParties(contract, "contract:review_submitted", {
      contractId: contract._id,
      reviewId: review._id,
      reviewerType: req.user.userType,
    });
  } catch (error) {
    return handleContractError(error, res, "Submit feedback", req);
  }
};

// Cancel contract (by either party)
const cancelContract = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate parameters
    const { error, value } = paramIdSchema.validate(req.params);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid contract ID",
        code: "INVALID_PARAM",
      });
    }

    const { id: contractId } = sanitizeInput(value);

    // Build filter based on user type
    const filter = {
      _id: contractId,
      contractStatus: { $in: ["active", "in_progress"] },
      isDeleted: false,
    };

    if (req.user.userType === "client") {
      filter.clientId = req.clientProfile._id;
    } else {
      filter.workerId = req.workerProfile._id;
    }

    const contract = await WorkContract.findOne(filter);

    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Contract not found or cannot be cancelled",
        code: "CONTRACT_NOT_FOUND",
      });
    }

    // Update contract
    contract.contractStatus = "cancelled";
    await contract.save();

    // Update worker status back to "available" and clear current job using helper method
    const worker = await Worker.findById(contract.workerId);
    if (worker) {
      worker.becomeAvailable();
      await worker.save();
    } // Update job status if linked to a job
    if (contract.jobId) {
      await Job.findByIdAndUpdate(contract.jobId, {
        status: "open",
        hiredWorker: null,
      });
    }

    const processingTime = Date.now() - startTime;

    logger.info("Contract cancelled successfully", {
      contractId,
      cancelledBy: req.user.userType,
      userId: req.user.id,
      ip: req.ip,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Contract cancelled successfully",
      code: "CONTRACT_CANCELLED",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
    // Notify both parties: contract cancelled
    emitToContractParties(contract, "contract:updated", {
      contractId: contract._id,
      status: "cancelled",
    });
  } catch (error) {
    return handleContractError(error, res, "Cancel contract", req);
  }
};

// Get reviews for a worker
const getWorkerReviews = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate parameters
    const { error: paramError, value: paramValue } = paramIdSchema.validate(
      req.params
    );
    if (paramError) {
      return res.status(400).json({
        success: false,
        message: "Invalid worker ID",
        code: "INVALID_PARAM",
      });
    }

    // Validate query parameters
    const queryValidation = Joi.object({
      page: Joi.number().integer().min(1).max(1000).default(1),
      limit: Joi.number().integer().min(1).max(50).default(10),
      rating: Joi.number().integer().min(1).max(5).optional(),
    });

    const { error: queryError, value: queryValue } = queryValidation.validate(
      req.query
    );
    if (queryError) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        code: "VALIDATION_ERROR",
        errors: queryError.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const { id: workerId } = sanitizeInput(paramValue);
    const { page, limit, rating } = sanitizeInput(queryValue);

    // Check if worker exists
    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: "Worker not found",
        code: "WORKER_NOT_FOUND",
      });
    }

    // Build filter
    const filter = {
      workerId: new mongoose.Types.ObjectId(workerId),
      revieweeType: "worker",
      isDeleted: false,
    };

    if (rating) {
      filter.rating = rating;
    }

    // Get reviews with pagination
    const reviews = await Review.find(filter)
      .populate("reviewerId", "firstName lastName profilePicture")
      .populate("jobId", "title description")
      .populate("contractId", "agreedRate contractStatus")
      .sort({ reviewDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Decrypt reviewer names (reviewer is a Client when reviewing a worker)
    const decryptedReviews = reviews.map((rev) => {
      const r = { ...rev };
      if (r.reviewerId) {
        try {
          if (r.reviewerId.firstName)
            r.reviewerId.firstName = decryptAES128(r.reviewerId.firstName);
        } catch {}
        try {
          if (r.reviewerId.lastName)
            r.reviewerId.lastName = decryptAES128(r.reviewerId.lastName);
        } catch {}
      }
      return r;
    });

    const totalCount = await Review.countDocuments(filter);

    // Get rating statistics
    const ratingStats = await Review.getRatingStats(workerId, "worker");

    const processingTime = Date.now() - startTime;

    // Decrypt worker name summary
    let workerFirst = worker.firstName;
    let workerLast = worker.lastName;
    try { if (workerFirst) workerFirst = decryptAES128(workerFirst); } catch {}
    try { if (workerLast) workerLast = decryptAES128(workerLast); } catch {}

    res.status(200).json({
      success: true,
      message: "Worker reviews retrieved successfully",
      code: "WORKER_REVIEWS_RETRIEVED",
      data: {
        reviews: decryptedReviews,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalItems: totalCount,
          itemsPerPage: limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
        statistics: ratingStats,
        worker: {
          id: worker._id,
          firstName: workerFirst,
          lastName: workerLast,
          averageRating: worker.averageRating,
          totalJobsCompleted: worker.totalJobsCompleted,
        },
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleContractError(error, res, "Get worker reviews", req);
  }
};

// Get reviews for a client
const getClientReviews = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate parameters
    const { error: paramError, value: paramValue } = paramIdSchema.validate(
      req.params
    );
    if (paramError) {
      return res.status(400).json({
        success: false,
        message: "Invalid client ID",
        code: "INVALID_PARAM",
      });
    }

    // Validate query parameters
    const queryValidation = Joi.object({
      page: Joi.number().integer().min(1).max(1000).default(1),
      limit: Joi.number().integer().min(1).max(50).default(10),
      rating: Joi.number().integer().min(1).max(5).optional(),
    });

    const { error: queryError, value: queryValue } = queryValidation.validate(
      req.query
    );
    if (queryError) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        code: "VALIDATION_ERROR",
        errors: queryError.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
        })),
      });
    }

    const { id: clientId } = sanitizeInput(paramValue);
    const { page, limit, rating } = sanitizeInput(queryValue);

    // Check if client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
        code: "CLIENT_NOT_FOUND",
      });
    }

    // Build filter
    const filter = {
      clientId: new mongoose.Types.ObjectId(clientId),
      revieweeType: "client",
      isDeleted: false,
    };

    if (rating) {
      filter.rating = rating;
    }

    // Get reviews with pagination
    const reviews = await Review.find(filter)
      .populate("reviewerId", "firstName lastName profilePicture")
      .populate("jobId", "title description")
      .populate("contractId", "agreedRate contractStatus")
      .sort({ reviewDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Decrypt reviewer names (reviewer is a Worker when reviewing a client)
    const decryptedReviews = reviews.map((rev) => {
      const r = { ...rev };
      if (r.reviewerId) {
        try {
          if (r.reviewerId.firstName)
            r.reviewerId.firstName = decryptAES128(r.reviewerId.firstName);
        } catch {}
        try {
          if (r.reviewerId.lastName)
            r.reviewerId.lastName = decryptAES128(r.reviewerId.lastName);
        } catch {}
      }
      return r;
    });

    const totalCount = await Review.countDocuments(filter);

    // Get rating statistics
    const ratingStats = await Review.getRatingStats(clientId, "client");

    const processingTime = Date.now() - startTime;

    // Decrypt client name summary
    let clientFirst = client.firstName;
    let clientLast = client.lastName;
    try { if (clientFirst) clientFirst = decryptAES128(clientFirst); } catch {}
    try { if (clientLast) clientLast = decryptAES128(clientLast); } catch {}

    res.status(200).json({
      success: true,
      message: "Client reviews retrieved successfully",
      code: "CLIENT_REVIEWS_RETRIEVED",
      data: {
        reviews: decryptedReviews,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalItems: totalCount,
          itemsPerPage: limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
        statistics: ratingStats,
        client: {
          id: client._id,
          firstName: clientFirst,
          lastName: clientLast,
          averageRating: client.averageRating,
          totalJobsPosted: client.totalJobsPosted,
          profilePicture: client.profilePicture?.url || null,
          verificationStatus: client.verificationStatus,
          isVerified: client.isVerified,
          hasIdDocuments: Boolean(client.idPictureId && client.selfiePictureId),
          idPictureId: client.idPictureId,
          selfiePictureId: client.selfiePictureId,
        },
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleContractError(error, res, "Get client reviews", req);
  }
};

// Get review details for a specific contract
const getContractReview = async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate parameters
    const { error: paramError, value: paramValue } = paramIdSchema.validate(
      req.params
    );
    if (paramError) {
      return res.status(400).json({
        success: false,
        message: "Invalid contract ID",
        code: "INVALID_PARAM",
      });
    }

    const { id: contractId } = sanitizeInput(paramValue);

    // Build filter based on user type to ensure user can only access their contracts
    const contractFilter = {
      _id: contractId,
      isDeleted: false,
    };

    if (req.user.userType === "client") {
      contractFilter.clientId = req.clientProfile._id;
    } else {
      contractFilter.workerId = req.workerProfile._id;
    }

    // Check if contract exists and user has access
    const contract = await WorkContract.findOne(contractFilter);
    if (!contract) {
      return res.status(404).json({
        success: false,
        message: "Contract not found",
        code: "CONTRACT_NOT_FOUND",
      });
    }

    // Get all reviews for this contract
    const reviews = await Review.find({
      contractId: contractId,
      isDeleted: false,
    })
      .populate("reviewerId", "firstName lastName profilePicture")
      .populate("revieweeId", "firstName lastName profilePicture")
      .populate("jobId", "title description")
      .sort({ reviewDate: -1 })
      .lean();

    const processingTime = Date.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Contract reviews retrieved successfully",
      code: "CONTRACT_REVIEWS_RETRIEVED",
      data: {
        contractId: contract._id,
        reviews,
        contractStatus: contract.contractStatus,
        canSubmitReview: contract.contractStatus === "completed",
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return handleContractError(error, res, "Get contract reviews", req);
  }
};

module.exports = {
  getClientContracts,
  getWorkerContracts,
  getContractDetails,
  startWork,
  completeWork,
  confirmWorkCompletion,
  submitFeedback,
  cancelContract,
  getWorkerReviews,
  getClientReviews,
  getContractReview,
};
