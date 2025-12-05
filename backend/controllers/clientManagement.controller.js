const mongoose = require("mongoose");
const Joi = require("joi");
const xss = require("xss");
const Client = require("../models/Client");
const Credential = require("../models/Credential");
const { decryptAES128 } = require("../utils/encipher");
const logger = require("../utils/logger");

// ==================== JOI SCHEMAS ====================
const blockClientSchema = Joi.object({
  reason: Joi.string().trim().min(5).max(200).required().messages({
    "string.min": "Block reason must be at least 5 characters",
    "string.max": "Block reason cannot exceed 200 characters",
    "any.required": "Block reason is required",
  }),
});

// ==================== HELPERS ====================
const sanitizeInput = (obj) => {
  if (typeof obj === "string") return xss(obj.trim());
  if (Array.isArray(obj)) return obj.map(sanitizeInput);
  if (typeof obj === "object" && obj !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  return obj;
};

// ==================== CONTROLLERS ====================

// Get all clients (decrypted) with pagination
const getClients = async (req, res) => {
  const startTime = Date.now();

  try {
    // ✅ Validate query parameters for pagination
    const { error, value } = Joi.object({
      page: Joi.number().integer().min(1).max(1000).default(1),
      sortBy: Joi.string()
        .valid("createdAt", "firstName", "lastName", "email")
        .default("createdAt"),
      order: Joi.string().valid("asc", "desc").default("desc"),
      search: Joi.string().trim().min(2).max(100).optional().messages({
        "string.min": "Search term must be at least 2 characters",
        "string.max": "Search term cannot exceed 100 characters",
      }),
      status: Joi.string()
        .valid("blocked", "active", "all")
        .default("all")
        .messages({
          "any.only": "Status must be one of: blocked, active, all",
        }),
    }).validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Get clients validation failed", {
        errors: error.details,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
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

    // ✅ Sanitize query parameters
    const sanitizedQuery = sanitizeInput(value);
    const { page, sortBy, order, search, status } = sanitizedQuery;

    // ✅ Fixed limit to 30 clients per page
    const limit = 30;
    const skip = (page - 1) * limit;
    const sortOrder = order === "asc" ? 1 : -1;

    // ✅ Build match conditions for aggregation
    const matchConditions = {
      "cred.userType": "client",
    };

    // Add status filter
    if (status !== "all") {
      if (status === "blocked") {
        matchConditions["blocked"] = true;
      } else if (status === "active") {
        matchConditions["blocked"] = { $ne: true };
      }
    }

    // ✅ Build aggregation pipeline
    const pipeline = [
      {
        $lookup: {
          from: "credentials",
          localField: "credentialId",
          foreignField: "_id",
          as: "cred",
        },
      },
      { $unwind: "$cred" },
      { $match: matchConditions },
      {
        $project: {
          firstName: 1,
          middleName: 1,
          lastName: 1,
          suffixName: 1,
          profilePicture: 1,
          sex: 1,
          address: 1,
          contactNumber: 1,
          dateOfBirth: 1,
          maritalStatus: 1,
          blocked: 1,
          blockReason: 1,
          isVerified: 1,
          idPictureId: 1,
          selfiePictureId: 1,
          verificationStatus: 1,
          idVerificationSubmittedAt: 1,
          idVerificationApprovedAt: 1,
          verifiedAt: 1,
          createdAt: 1,
          credentialId: "$cred._id",
          email: "$cred.email",
          userType: "$cred.userType",
        },
      },
      {
        $addFields: {
          hasIdDocuments: {
            $and: [
              { $ne: [{ $ifNull: ["$idPictureId", null] }, null] },
              { $ne: [{ $ifNull: ["$selfiePictureId", null] }, null] },
            ],
          },
        },
      },
      {
        $addFields: {
          effectiveIsVerified: {
            $cond: [
              {
                $or: [
                  { $eq: ["$isVerified", true] },
                  {
                    $and: [
                      "$hasIdDocuments",
                      {
                        $in: [
                          {
                            $toLower: {
                              $ifNull: ["$verificationStatus", ""],
                            },
                          },
                          ["approved", "verified", "auto_verified"],
                        ],
                      },
                    ],
                  },
                ],
              },
              true,
              false,
            ],
          },
        },
      },
    ];

    // ✅ Add search functionality if search term provided
    if (search) {
      pipeline.push({
        $match: {
          $or: [
            { email: { $regex: search, $options: "i" } },
            // Note: We can't search encrypted fields directly
            // Search will only work on email for now
          ],
        },
      });
    }

    // ✅ Get total count for pagination
    const totalCountPipeline = [...pipeline, { $count: "total" }];
    const totalCountResult = await Client.aggregate(totalCountPipeline);
    const totalCount =
      totalCountResult.length > 0 ? totalCountResult[0].total : 0;

    // ✅ Add sorting, skip, and limit
    pipeline.push(
      { $sort: { [sortBy]: sortOrder } },
      { $skip: skip },
      { $limit: limit }
    );

    // ✅ Execute aggregation
    const docs = await Client.aggregate(pipeline);

    // ✅ Decrypt sensitive data
    let successfulDecryptions = 0;
    let failedDecryptions = 0;

    for (let i = 0; i < docs.length; i++) {
      const client = docs[i];
      try {
        if (client.firstName)
          client.firstName = decryptAES128(client.firstName);
        if (client.lastName) client.lastName = decryptAES128(client.lastName);
        if (client.middleName)
          client.middleName = decryptAES128(client.middleName);
        if (client.suffixName)
          client.suffixName = decryptAES128(client.suffixName);
        if (client.contactNumber)
          client.contactNumber = decryptAES128(client.contactNumber);
        if (client.address) {
          if (client.address.street)
            client.address.street = decryptAES128(client.address.street);
          if (client.address.barangay)
            client.address.barangay = decryptAES128(client.address.barangay);
          if (client.address.city)
            client.address.city = decryptAES128(client.address.city);
          if (client.address.province)
            client.address.province = decryptAES128(client.address.province);
          if (client.address.region)
            client.address.region = decryptAES128(client.address.region);
        }
        successfulDecryptions++;
      } catch (decryptError) {
        logger.error("Decryption error", {
          error: decryptError.message,
          clientId: client._id,
          timestamp: new Date().toISOString(),
        });
        failedDecryptions++;
      }
    }

    // ✅ Calculate pagination data
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    // ✅ Get statistics
    const statsAggregation = await Client.aggregate([
      {
        $lookup: {
          from: "credentials",
          localField: "credentialId",
          foreignField: "_id",
          as: "cred",
        },
      },
      { $unwind: "$cred" },
      { $match: { "cred.userType": "client" } },
      {
        $project: {
          blocked: 1,
          isVerified: 1,
          idPictureId: 1,
          selfiePictureId: 1,
          verificationStatus: 1,
        },
      },
      {
        $addFields: {
          hasIdDocuments: {
            $and: [
              { $ne: [{ $ifNull: ["$idPictureId", null] }, null] },
              { $ne: [{ $ifNull: ["$selfiePictureId", null] }, null] },
            ],
          },
        },
      },
      {
        $addFields: {
          effectiveIsVerified: {
            $cond: [
              {
                $or: [
                  { $eq: ["$isVerified", true] },
                  {
                    $and: [
                      "$hasIdDocuments",
                      {
                        $in: [
                          {
                            $toLower: {
                              $ifNull: ["$verificationStatus", ""],
                            },
                          },
                          ["approved", "verified", "auto_verified"],
                        ],
                      },
                    ],
                  },
                ],
              },
              true,
              false,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          blocked: { $sum: { $cond: [{ $eq: ["$blocked", true] }, 1, 0] } },
          active: { $sum: { $cond: [{ $ne: ["$blocked", true] }, 1, 0] } },
          verified: {
            $sum: { $cond: [{ $eq: ["$effectiveIsVerified", true] }, 1, 0] },
          },
          unverified: {
            $sum: {
              $cond: [{ $eq: ["$effectiveIsVerified", true] }, 0, 1],
            },
          },
        },
      },
    ]);


    const statistics =
      statsAggregation.length > 0
        ? {
          total: statsAggregation[0].total,
          blocked: statsAggregation[0].blocked,
          active: statsAggregation[0].active,
          verified: statsAggregation[0].verified,
          unverified: statsAggregation[0].unverified,
        }
        : { total: 0, blocked: 0, active: 0, verified: 0, unverified: 0 };

    const processingTime = Date.now() - startTime;

    logger.info("Clients retrieved with pagination", {
      page,
      limit,
      totalCount,
      totalPages,
      clientsReturned: docs.length,
      successfulDecryptions,
      failedDecryptions,
      sortBy,
      order,
      search: search || "none",
      status,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Clients retrieved successfully",
      code: "CLIENTS_RETRIEVED",
      data: {
        clients: docs,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: totalCount,
          itemsPerPage: limit,
          hasNextPage,
          hasPrevPage,
          nextPage: hasNextPage ? page + 1 : null,
          prevPage: hasPrevPage ? page - 1 : null,
        },
        statistics,
        filters: {
          search: search || null,
          status,
          sortBy,
          order,
        },
      },
      meta: {
        successfulDecryptions,
        failedDecryptions,
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error("Error fetching clients", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(500).json({
      success: false,
      message: "Failed to retrieve clients due to server error",
      code: "CLIENTS_RETRIEVAL_ERROR",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  }
};

// Block a client (update Credential)
const blockClient = async (req, res) => {
  const startTime = Date.now();
  try {
    const { id } = req.params;
    const { error, value } = blockClientSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Block client validation failed", {
        errors: error.details,
        clientId: id,
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

    const sanitizedReason = sanitizeInput(value.reason);

    // Find client and block
    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
        code: "CLIENT_NOT_FOUND",
      });
    }

    client.blocked = true;
    client.blockReason = sanitizedReason;
    await client.save();

    logger.info("Client blocked", {
      clientId: id,
      reason: sanitizedReason,
      processingTime: `${Date.now() - startTime}ms`,
    });

    res.status(200).json({
      success: true,
      message: "Client blocked successfully",
      data: {
        clientId: id,
        blocked: true,
        blockReason: sanitizedReason,
      },
      meta: {
        processingTime: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error blocking client", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error blocking client",
      error: error.message,
    });
  }
};

// Unblock a client (update client model)
const unblockClient = async (req, res) => {
  const startTime = Date.now();
  try {
    const { id } = req.params;

    // Find client and unblock
    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
        code: "CLIENT_NOT_FOUND",
      });
    }

    client.blocked = false;
    client.blockReason = null;
    await client.save();

    logger.info("Client unblocked", {
      clientId: id,
      processingTime: `${Date.now() - startTime}ms`,
    });

    res.status(200).json({
      success: true,
      message: "Client unblocked successfully",
      data: {
        clientId: id,
        blocked: false,
        blockReason: null,
      },
      meta: {
        processingTime: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error unblocking client", { error: error.message });
    res.status(500).json({
      success: false,
      message: "Error unblocking client",
      error: error.message,
    });
  }
};

module.exports = {
  getClients,
  blockClient,
  unblockClient,
};
