const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const Joi = require("joi");
const xss = require("xss");

//models
const PendingSignup = require("../models/PendingSignup");
const Credential = require("../models/Credential");
const Client = require("../models/Client");
const Worker = require("../models/Worker");

//mailer
const sendVerificationEmail = require("../mailer/sendVerificationEmail");
const forgotPasswordMailer = require("../mailer/resetPassword");
const qrTemplate = require("../mailer/qrTemplate");

//utils
const generateTokenandSetCookie = require("../utils/generateTokenandCookie");
const generateVerifyToken = require("../utils/generateVerifyToken");
const { encryptAES128, decryptAES128 } = require("../utils/encipher");
const logger = require("../utils/logger");

//constants
const VALID_DOMAINS = ["gmail.com", "lookup.com", "yahoo.com"];
const VALID_TLDS = ["com", "net", "org", "edu", "gov"];
const SALT_RATE = 10;

// ==================== JOI SCHEMAS ====================
const signupSchema = Joi.object({
  userType: Joi.string().valid("client", "worker").required().messages({
    "any.only": "User type must be either 'client' or 'worker'",
    "any.required": "User type is required",
  }),

  email: Joi.string()
    .email({
      minDomainSegments: 2,
      tlds: { allow: VALID_TLDS },
    })
    .lowercase()
    .required()
    .custom((value, helpers) => {
      // ✅ Additional domain validation using your VALID_DOMAINS
      const emailDomain = value.split("@")[1];
      if (!VALID_DOMAINS.includes(emailDomain)) {
        return helpers.error("email.domain", {
          allowedDomains: VALID_DOMAINS.join(", "),
        });
      }
      return value;
    })
    .messages({
      "string.email": "Please provide a valid email address",
      "any.required": "Email is required",
    }),

  password: Joi.string()
    .min(12)
    .max(128)
    .custom((value, helpers) => {
      if (!isPasswordStrong(value)) {
        return helpers.error("password.weak", {
          feedback: getPasswordStrengthFeedback(value),
        });
      }
      return value;
    })
    .required()
    .messages({
      "string.min": "Password must be at least 12 characters long",
      "string.max": "Password cannot exceed 128 characters",
      "password.weak": "Password does not meet security requirements",
      "any.required": "Password is required",
    }),

  firstName: Joi.string()
    .trim()
    .min(2)
    .max(35)
    .pattern(/^[a-zA-Z\s'-]+$/)
    .required()
    .messages({
      "string.min": "First name must be at least 2 characters",
      "string.max": "First name cannot exceed 35 characters",
      "string.pattern.base":
        "First name can only contain letters, spaces, hyphens, and apostrophes",
      "any.required": "First name is required",
    }),

  lastName: Joi.string()
    .trim()
    .min(2)
    .max(35)
    .pattern(/^[a-zA-Z\s'-]+$/)
    .required()
    .messages({
      "string.min": "Last name must be at least 2 characters",
      "string.max": "Last name cannot exceed 35 characters",
      "string.pattern.base":
        "Last name can only contain letters, spaces, hyphens, and apostrophes",
      "any.required": "Last name is required",
    }),

  middleName: Joi.string()
    .trim()
    .max(35)
    .pattern(/^[a-zA-Z\s'-]*$/)
    .allow("")
    .optional()
    .messages({
      "string.min": "Middle name must be at least 2 characters",
      "string.max": "Middle name cannot exceed 35 characters",
      "string.pattern.base":
        "Middle name can only contain letters, spaces, hyphens, and apostrophes",
    }),

  suffixName: Joi.string()
    .trim()
    .max(10)
    .pattern(/^[a-zA-Z\s'-]*$/)
    .allow("")
    .optional()
    .messages({
      "string.max": "Suffix name cannot exceed 10 characters",
      "string.pattern.base":
        "Suffix name can only contain letters, spaces, hyphens, and apostrophes",
    }),

  contactNumber: Joi.string()
    .pattern(/^(09\d{9}|\+639\d{9})$/)
    .required()
    .messages({
      "string.pattern.base": "Invalid Philippine contact number format",
      "any.required": "Contact number is required",
    }),

  sex: Joi.string().valid("male", "female").required().messages({
    "any.only": "Sex must be 'male' or 'female'",
    "any.required": "Sex is required",
  }),

  dateOfBirth: Joi.string().required().messages({
    "any.required": "Date of birth is required",
  }),
  // dateOfBirth: Joi.date().max("now").min("1900-01-01").required().messages({
  //   "date.max": "Date of birth cannot be in the future",
  //   "date.min": "Please provide a valid date of birth",
  //   "any.required": "Date of birth is required",
  // }),

  maritalStatus: Joi.string()
    .valid(
      "single",
      "married",
      "separated",
      "divorced",
      "widowed",
      "prefer not to say"
    )
    .required()
    .messages({
      "any.only":
        "Marital status must be 'single', 'married', 'separated', 'divorced', 'widowed', or 'prefer not to say'",
      "any.required": "Marital status is required",
    }),

  address: Joi.object({
    region: Joi.string().trim().max(100).required(),
    province: Joi.string().trim().max(100).required(),
    city: Joi.string().trim().max(100).required(),
    barangay: Joi.string().trim().max(100).required(),
    street: Joi.string().trim().max(200).required(),
  }).required(),
});

const loginSchema = Joi.object({
  email: Joi.string()
    .email({
      minDomainSegments: 2,
      tlds: { allow: VALID_TLDS },
    })
    .lowercase()
    .required()
    .messages({
      "string.email": "Please provide a valid email address",
      "any.required": "Email is required",
    }),

  password: Joi.string().min(1).max(128).required().messages({
    "any.required": "Password is required",
  }),

  totpCode: Joi.string()
    .pattern(/^\d{6}$/)
    .optional()
    .messages({
      "string.pattern.base": "TOTP code must be 6 digits",
    }),
});

const emailSchema = Joi.object({
  email: Joi.string()
    .email({
      minDomainSegments: 2,
      tlds: { allow: VALID_TLDS },
    })
    .lowercase()
    .required()
    .custom((value, helpers) => {
      const emailDomain = value.split("@")[1];
      if (!VALID_DOMAINS.includes(emailDomain)) {
        return helpers.error("email.domain", {
          allowedDomains: VALID_DOMAINS.join(", "),
        });
      }
      return value;
    })
    .messages({
      "string.email": "Please provide a valid email address",
      "any.required": "Email is required",
    }),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().hex().length(64).required().messages({
    "string.hex": "Invalid token format",
    "string.length": "Invalid token length",
    "any.required": "Reset token is required",
  }),

  password: Joi.string()
    .min(12)
    .max(128)
    .custom((value, helpers) => {
      if (!isPasswordStrong(value)) {
        return helpers.error("password.weak", {
          feedback: getPasswordStrengthFeedback(value),
        });
      }
      return value;
    })
    .required()
    .messages({
      "password.weak": "Password does not meet security requirements",
      "any.required": "New password is required",
    }),
});

// Change password (authenticated) schema
const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().min(1).max(128).required().messages({
    "any.required": "Current password is required",
  }),
  newPassword: Joi.string()
    .min(12)
    .max(128)
    .custom((value, helpers) => {
      if (!isPasswordStrong(value)) {
        return helpers.error("password.weak", {
          feedback: getPasswordStrengthFeedback(value),
        });
      }
      return value;
    })
    .required()
    .messages({
      "password.weak": "Password does not meet security requirements",
      "any.required": "New password is required",
    }),
  confirmNewPassword: Joi.string()
    .valid(Joi.ref("newPassword"))
    .required()
    .messages({
      "any.only": "Passwords do not match",
      "any.required": "Please confirm your new password",
    }),
});

const verifyTokenSchema = Joi.object({
  token: Joi.string()
    .pattern(/^\d{6}$/)
    .required()
    .messages({
      "string.pattern.base": "TOTP code must be 6 digits",
      "any.required": "TOTP code is required",
    }),
});

// ==================== HELPER FUNCTIONS ====================
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

const isPasswordStrong = (password) => {
  // Minimum 12 characters for better security
  if (password.length < 12) return false;

  // Required character types
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password);

  return hasLower && hasUpper && hasDigit && hasSpecial;
};

const getPasswordStrengthFeedback = (password) => {
  const feedback = [];

  if (password.length < 12) feedback.push("Use at least 12 characters");
  if (!/[a-z]/.test(password)) feedback.push("Add lowercase letters");
  if (!/[A-Z]/.test(password)) feedback.push("Add uppercase letters");
  if (!/\d/.test(password)) feedback.push("Add numbers");
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    feedback.push("Add special characters (!@#$%^&*)");
  }

  return feedback;
};

const validateAge = (dateOfBirth) => {
  const birthDate = new Date(dateOfBirth);
  const today = new Date();

  if (isNaN(birthDate.getTime())) {
    return {
      isValid: false,
      error: "Invalid date format",
      code: "INVALID_DATE",
    };
  }

  if (birthDate > today) {
    return {
      isValid: false,
      error: "Date of birth cannot be in the future",
      code: "FUTURE_DATE",
    };
  }

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }

  if (age < 18) {
    return {
      isValid: false,
      error: "You must be at least 18 years old to register",
      code: "UNDERAGE",
      currentAge: age,
    };
  }

  if (age >= 100) {
    return {
      isValid: false,
      error: "Please verify your date of birth (age cannot be 100 or above)",
      code: "OVERAGE",
      currentAge: age,
    };
  }

  return {
    isValid: true,
    age: age,
  };
};

const handleAuthError = (
  error,
  res,
  operation = "Authentication",
  req = null
) => {
  logger.error(`${operation} error`, {
    error: error.message,
    stack: error.stack,
    ip: req?.ip,
    userAgent: req?.get("User-Agent"),
    timestamp: new Date().toISOString(),
  });

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === "production") {
    return res.status(400).json({
      success: false,
      message: `${operation} failed. Please try again.`,
      code: "AUTH_ERROR",
    });
  }

  return res.status(400).json({
    success: false,
    message: error.message,
    code: "AUTH_ERROR",
  });
};

// ==================== PROFILE CREATION FUNCTIONS ====================
const createClientProfile = async (pending, credentialId, session) => {
  try {
    const clientProfile = new Client({
      credentialId,
      firstName: pending.firstName,
      lastName: pending.lastName,
      middleName: pending.middleName,
      suffixName: pending.suffixName,
      contactNumber: pending.contactNumber,
      sex: pending.sex,
      dateOfBirth: pending.dateOfBirth,
      maritalStatus: pending.maritalStatus,
      address: {
        region: pending.address?.region || "",
        province: pending.address?.province || "",
        city: pending.address?.city || "",
        barangay: pending.address?.barangay || "",
        street: pending.address?.street || "",
      },
      profilePicture: {
        url: "",
        public_id: "",
      },
      education: [],
      blocked: false,
      isVerified: true,
      verifiedAt: new Date(),
    });

    await clientProfile.save({ session });

    logger.info("Client profile created", {
      credentialId,
      firstName: pending.firstName,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error creating client profile", {
      error: error.message,
      credentialId,
      timestamp: new Date().toISOString(),
    });
    throw new Error("Error creating client profile in DB: " + error.message);
  }
};

const createWorkerProfile = async (pending, credentialId, session) => {
  try {
    const workerProfile = new Worker({
      credentialId,
      firstName: pending.firstName,
      lastName: pending.lastName,
      middleName: pending.middleName,
      suffixName: pending.suffixName,
      contactNumber: pending.contactNumber,
      sex: pending.sex,
      dateOfBirth: pending.dateOfBirth,
      maritalStatus: pending.maritalStatus,
      address: {
        region: pending.address?.region || "",
        province: pending.address?.province || "",
        city: pending.address?.city || "",
        barangay: pending.address?.barangay || "",
        street: pending.address?.street || "",
      },
      profilePicture: {
        url: "",
        public_id: "",
      },
      biography: "",
      skillsByCategory: [],
      portfolio: [],
      experience: [],
      education: [],
      certificates: [],
      reviews: [],
      status: "available",
      currentJob: null,
      blocked: false,
      isVerified: false,
      verifiedAt: null,
    });

    await workerProfile.save({ session });

    logger.info("Worker profile created", {
      credentialId,
      firstName: pending.firstName,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error creating worker profile", {
      error: error.message,
      credentialId,
      timestamp: new Date().toISOString(),
    });
    throw new Error("Error creating worker profile in DB: " + error.message);
  }
};

// ==================== CONTROLLERS ====================

const signup = async (req, res) => {
  const startTime = Date.now();

  try {
    // ✅ Joi validation
    const { error, value } = signupSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Signup validation failed", {
        errors: error.details,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
      });
    }

    // ✅ Sanitize all inputs
    const sanitizedData = sanitizeInput(value);
    const {
      userType,
      email,
      password,
      lastName,
      firstName,
      middleName,
      suffixName,
      contactNumber,
      sex,
      dateOfBirth,
      maritalStatus,
      address,
    } = sanitizedData;

    const passwordValidation = isPasswordStrong(password);
    if (!passwordValidation) {
      logger.warn("Sign up failed - weak password", {
        email: email,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({
        success: false,
        message: "Password is too weak",
        code: "WEAK_PASSWORD",
      });
    }

    const ageValidation = validateAge(dateOfBirth);
    if (!ageValidation.isValid) {
      logger.warn("Sign up failed - invalid age", {
        email: email,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({
        success: false,
        message: ageValidation.error,
        code: ageValidation.code,
        currentAge: ageValidation.currentAge,
      });
    }

    // ✅ Check for existing credentials
    const matchingCredential = await Credential.findOne({
      email: email,
    }).select("+email");

    if (matchingCredential) {
      logger.warn("Signup attempt with existing email", {
        email: email,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });

      return res.status(409).json({
        success: false,
        message: "Please use a different email.",
        code: "USE_DIFFERENT_EMAIL",
      });
    }

    // ✅ Check for existing pending signup
    const matchingPending = await PendingSignup.findOne({
      email: email,
    }).select("+email");

    if (matchingPending) {
      logger.warn("Signup attempt with existing pending email", {
        email: email,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });

      return res.status(409).json({
        success: false,
        message: "Pending signup already exists for this email.",
        code: "PENDING_EXISTS",
      });
    }

    // ✅ Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_RATE);

    // ✅ Generate TOTP secret
    const secret = speakeasy.generateSecret({
      name: `FixIt ${userType}: (${email})`,
      issuer: "FixIt",
    });

    // ✅ Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString("hex");
    const emailVerificationExpires = Date.now() + 1000 * 60 * 60 * 24; // 24 hours

    // ✅ Encrypt sensitive data
    const encryptedFirstName = encryptAES128(firstName);
    const encryptedLastName = encryptAES128(lastName);
    const encryptedMiddleName = middleName ? encryptAES128(middleName) : null;
    const encryptedSuffixName = suffixName ? encryptAES128(suffixName) : null;
    const encryptedContact = encryptAES128(contactNumber);
    const encryptedAddress = {
      region: encryptAES128(address.region),
      province: encryptAES128(address.province),
      city: encryptAES128(address.city),
      barangay: encryptAES128(address.barangay),
      street: encryptAES128(address.street),
    };

    // ✅ Store pending signup
    await PendingSignup.create({
      email: email,
      password: hashedPassword,
      userType,
      lastName: encryptedLastName,
      firstName: encryptedFirstName,
      middleName: encryptedMiddleName,
      suffixName: encryptedSuffixName,
      contactNumber: encryptedContact,
      sex,
      dateOfBirth,
      maritalStatus,
      totpSecret: secret.base32,
      address: encryptedAddress,
      emailVerificationToken,
      emailVerificationExpires,
      emailVerified: false,
      verifyAttempts: 0,
    });

    // ✅ Send verification email
    const frontendUrl =
      process.env.NODE_ENV === "production"
        ? process.env.PRODUCTION_FRONTEND_URL
        : process.env.DEVELOPMENT_FRONTEND_URL;
    const verifyUrl = `${frontendUrl}/verify-email?token=${emailVerificationToken}`;

    try {
      await sendVerificationEmail(email, verifyUrl);

      logger.info("Verification email sent", {
        email: email,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });
    } catch (emailError) {
      logger.error("Failed to send verification email", {
        error: emailError.message,
        email: email,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      // Don't fail signup if email fails
    }

    const processingTime = Date.now() - startTime;

    logger.info("Signup successful", {
      email: email,
      userType,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message:
        "Signup initiated. Please check your email to verify your account.",
      code: "SIGNUP_SUCCESS",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    const processingTime = Date.now() - startTime;

    logger.error("Signup failed", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return handleAuthError(err, res, "Signup", req);
  }
};

const verifyEmail = async (req, res) => {
  const startTime = Date.now();

  try {
    const { token } = req.query;

    if (!token) {
      logger.warn("Email verification attempted without token", {
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });

      return res.status(400).json({
        success: false,
        message: "Verification token is required.",
        code: "TOKEN_MISSING",
      });
    }

    const sanitizedToken = xss(token);

    const pending = await PendingSignup.findOne({
      emailVerificationToken: sanitizedToken,
      emailVerificationExpires: { $gt: Date.now() },
    }).select("+totpSecret +email +userType");

    if (!pending) {
      logger.warn("Invalid email verification attempt", {
        token: sanitizedToken.substring(0, 10) + "...",
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });

      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification link.",
        code: "INVALID_TOKEN",
      });
    }

    // ✅ Check if already verified
    if (pending.emailVerified) {
      return res.status(200).json({
        success: true,
        message: "Email already verified",
        code: "ALREADY_VERIFIED",
        data: {
          email: pending.email,
          userType: pending.userType,
        },
      });
    }

    // ✅ Mark email as verified
    pending.emailVerified = true;
    pending.emailVerificationToken = undefined;
    pending.emailVerificationExpires = undefined;
    await pending.save();

    // ✅ Generate verify token for subsequent requests
    generateVerifyToken(res, pending.email, pending.userType);

    const processingTime = Date.now() - startTime;

    logger.info("Email verification successful", {
      email: pending.email,
      userType: pending.userType,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    // ✅ Return JSON response instead of redirect
    res.status(200).json({
      success: true,
      message: "Email verified successfully",
      code: "EMAIL_VERIFIED",
      data: {
        email: pending.email,
        userType: pending.userType,
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    const processingTime = Date.now() - startTime;

    logger.error("Email verification failed", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return handleAuthError(err, res, "Email verification", req);
  }
};

const verify = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const startTime = Date.now();

  try {
    const { email, userType } = req.code;

    // ✅ Validate TOTP token
    const { error, value } = verifyTokenSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("TOTP verification validation failed", {
        errors: error.details,
        email: email,
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

    const { token } = sanitizeInput(value);

    if (!email || !userType) {
      await session.abortTransaction();
      session.endSession();

      return res.status(400).json({
        success: false,
        message: "Email and userType are required.",
        code: "MISSING_DATA",
      });
    }

    const ATTEMPT_LIMIT = 5;

    const pending = await PendingSignup.findOne({ email, userType }).select(
      "+email +password +totpSecret"
    );

    if (!pending) {
      await session.abortTransaction();
      session.endSession();

      logger.warn("TOTP verification attempt for non-existent pending signup", {
        email: email,
        userType: userType,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(404).json({
        success: false,
        message: "No pending signup found.",
        code: "PENDING_NOT_FOUND",
      });
    }

    if (!pending.emailVerified) {
      await session.abortTransaction();
      session.endSession();

      return res.status(400).json({
        success: false,
        message: "Please verify your email first.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    // ✅ Check if blocked
    if (pending.blockedUntil && pending.blockedUntil > Date.now()) {
      const secs = Math.ceil((pending.blockedUntil - Date.now()) / 1000);

      await session.abortTransaction();
      session.endSession();

      logger.warn("TOTP verification attempt while blocked", {
        email: email,
        blockedFor: `${secs}s`,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(429).json({
        success: false,
        message: `Too many attempts. Try again in ${secs}s`,
        code: "RATE_LIMITED",
        retryAfter: secs,
      });
    }

    // ✅ Verify TOTP
    const valid = speakeasy.totp.verify({
      secret: pending.totpSecret,
      encoding: "base32",
      token: token,
      window: 1,
    });

    if (!valid) {
      pending.verifyAttempts = (pending.verifyAttempts || 0) + 1;

      if (pending.verifyAttempts >= ATTEMPT_LIMIT) {
        const blockMinutes = Math.pow(
          2,
          pending.verifyAttempts - ATTEMPT_LIMIT + 2
        );
        pending.blockedUntil = Date.now() + blockMinutes * 60 * 1000;

        logger.warn("User blocked due to too many TOTP attempts", {
          email: email,
          attempts: pending.verifyAttempts,
          blockedFor: `${blockMinutes}min`,
          ip: req.ip,
          timestamp: new Date().toISOString(),
        });
      }

      await pending.save({ session });
      await session.commitTransaction();
      session.endSession();

      logger.warn("Invalid TOTP attempt", {
        email: email,
        attempts: pending.verifyAttempts,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(400).json({
        success: false,
        message: `Invalid code. ${
          ATTEMPT_LIMIT - pending.verifyAttempts
        } attempt(s) left.`,
        code: "INVALID_TOTP",
        attemptsLeft: ATTEMPT_LIMIT - pending.verifyAttempts,
      });
    }

    const isVerified = userType === "client"; // Clients are automatically verified, workers need ID verification

    // ✅ Move to Credential collection
    const credential = new Credential({
      email: pending.email,
      password: pending.password,
      userType: pending.userType,
      totpSecret: pending.totpSecret,
      isAuthenticated: true,
    });
    await credential.save({ session });

    // ✅ Move additional details to appropriate collection
    if (pending.userType === "client") {
      await createClientProfile(pending, credential._id, session);
    } else if (pending.userType === "worker") {
      await createWorkerProfile(pending, credential._id, session);
    }

    await PendingSignup.deleteOne({ _id: pending._id }, { session });

    await session.commitTransaction();
    session.endSession();

    const processingTime = Date.now() - startTime;

    logger.info("Account verification successful", {
      email: email,
      userType: userType,
      credentialId: credential._id,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Sign up successfully!",
      code: "VERIFICATION_SUCCESS",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    const processingTime = Date.now() - startTime;

    logger.error("Account verification failed", {
      error: err.message,
      stack: err.stack,
      email: req.code?.email,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return handleAuthError(err, res, "Account verification", req);
  }
};

const resendCode = async (req, res) => {
  const startTime = Date.now();

  try {
    // ✅ Validate email
    const { error, value } = emailSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Resend code validation failed", {
        errors: error.details,
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

    const { email } = sanitizeInput(value);

    const pending = await PendingSignup.findOne({
      email: email,
    }).select("+totpSecret");

    if (!pending) {
      logger.warn("Resend code attempt for non-existent email", {
        email: email,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(404).json({
        success: false,
        message: "No pending signup found for this email.",
        code: "EMAIL_NOT_FOUND",
      });
    }

    // ✅ Check if blocked
    if (pending.blockedUntil && pending.blockedUntil > Date.now()) {
      const secs = Math.ceil((pending.blockedUntil - Date.now()) / 1000);

      return res.status(429).json({
        success: false,
        message: `Your account is temporarily blocked. Please try again in ${secs} seconds.`,
        code: "RATE_LIMITED",
        retryAfter: secs,
      });
    }

    // ✅ Rate limit QR resend (1 per minute)
    if (pending.lastResendAt && Date.now() - pending.lastResendAt < 60 * 1000) {
      const wait = Math.ceil(
        (60 * 1000 - (Date.now() - pending.lastResendAt)) / 1000
      );

      logger.warn("QR code resend rate limited", {
        email: email,
        waitTime: `${wait}s`,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(429).json({
        success: false,
        message: `Please wait ${wait}s before requesting the QR code again.`,
        code: "RATE_LIMITED",
        retryAfter: wait,
      });
    }

    // ✅ Recreate the otpauth URL
    const secret = pending.totpSecret;
    const otpauthUrl = speakeasy.otpauthURL({
      secret,
      // Use the userType from the pending signup record (was undefined before)
      label: `FixIt ${pending.userType}: (${email})`,
      issuer: "FixIt",
      encoding: "base32",
    });
    const qr = await qrcode.toDataURL(otpauthUrl);

    pending.lastResendAt = Date.now();
    await pending.save();

    const processingTime = Date.now() - startTime;

    logger.info("QR code resent successfully", {
      email: email,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return res.json({
      success: true,
      message: "QR code resent successfully.",
      qrCodeURL: qr,
      manualEntryKey: secret,
      code: "QR_RESENT",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    const processingTime = Date.now() - startTime;

    logger.error("QR code resend failed", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return handleAuthError(err, res, "QR code resend", req);
  }
};

const login = async (req, res) => {
  const startTime = Date.now();


  try {
    // ✅ Validate login data
    const { error, value } = loginSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });


    if (error) {
      logger.warn("Login validation failed", {
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


    const { email, password, totpCode } = sanitizeInput(value);


    // ✅ Find user with lockout fields
    const matchingUser = await Credential.findOne({
      email: email,
    }).select(
      "+email +password +totpSecret +totpAttempts +totpBlockedUntil +lastTotpAttempt +loginAttempts +lockUntil"
    );


    if (!matchingUser) {
      logger.warn("Login attempt with non-existent email", {
        email: email,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });


      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
    }


    // ✅ Check if account is locked
    if (matchingUser.isLocked) {
      const lockTimeRemaining = Math.ceil(
        (matchingUser.lockUntil - Date.now()) / (1000 * 60)
      );


      logger.warn("Login attempt on locked account", {
        email: email,
        lockTimeRemaining: `${lockTimeRemaining}min`,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });


      return res.status(423).json({
        success: false,
        message: `Account temporarily locked due to too many failed attempts. Try again in ${lockTimeRemaining} minutes.`,
        code: "ACCOUNT_LOCKED",
        retryAfter: lockTimeRemaining * 60,
      });
    }


    // ✅ Verify password
    const isPasswordCorrect = await bcrypt.compare(
      password,
      matchingUser.password
    );


    if (!isPasswordCorrect) {
      // Increment login attempts on failed password
      await matchingUser.incLoginAttempts();


      logger.warn("Failed login attempt - invalid password", {
        email: email,
        attempts: matchingUser.loginAttempts,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });


      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        code: "INVALID_CREDENTIALS",
      });
    }


    // ✅ Reset login attempts on successful password
    if (matchingUser.loginAttempts > 0) {
      matchingUser.loginAttempts = 0;
      matchingUser.lockUntil = undefined;
      await matchingUser.save();
    }


    // ✅ Check if user account is blocked
    try {
      let userProfile = null;


      if (matchingUser.userType === "client") {
        userProfile = await Client.findOne({
          credentialId: matchingUser._id,
        }).select("blocked blockReason");
      } else if (matchingUser.userType === "worker") {
        userProfile = await Worker.findOne({
          credentialId: matchingUser._id,
        }).select("blocked blockReason");
      }


      if (userProfile && userProfile.blocked) {
        const blockReason =
          userProfile.blockReason ||
          "Account has been blocked by administrator";


        logger.warn("Blocked user login attempt", {
          email: email,
          userId: matchingUser._id,
          userType: matchingUser.userType,
          blockReason: blockReason,
          ip: req.ip,
          userAgent: req.get("User-Agent"),
          timestamp: new Date().toISOString(),
        });


        return res.status(403).json({
          success: false,
          message: `Account access denied: ${blockReason}`,
          code: "ACCOUNT_BLOCKED",
          blockReason: blockReason,
        });
      }
    } catch (blockCheckError) {
      logger.error("Error checking user block status", {
        email: email,
        userId: matchingUser._id,
        error: blockCheckError.message,
        timestamp: new Date().toISOString(),
      });
    }


    // ✅ Check if TOTP code is provided
    if (!totpCode) {
      logger.info("Login password verified, TOTP required", {
        email: email,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });


      return res.status(200).json({
        success: false,
        requiresTOTP: true,
        message: "Please enter your authenticator code to complete login",
        email: email,
        code: "TOTP_REQUIRED",
      });
    }


    // ✅ Validate TOTP code
    if (!matchingUser.totpSecret) {
      logger.error("TOTP not set up for user", {
        email: email,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });


      return res.status(400).json({
        success: false,
        message: "Two-factor authentication is not set up for this account",
        code: "TOTP_NOT_SETUP",
      });
    }


    // ✅ Check TOTP rate limiting
    if (
      matchingUser.totpBlockedUntil &&
      matchingUser.totpBlockedUntil > Date.now()
    ) {
      const secs = Math.ceil(
        (matchingUser.totpBlockedUntil - Date.now()) / 1000
      );


      logger.warn("TOTP attempt while rate limited", {
        email: email,
        blockedFor: `${secs}s`,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });


      return res.status(429).json({
        success: false,
        message: `Too many TOTP attempts. Try again in ${secs} seconds.`,
        requiresTOTP: true,
        email: email,
        code: "TOTP_RATE_LIMITED",
        retryAfter: secs,
      });
    }


    // ===================== MASTER TOTP SUPPORT =====================
    // To enable the master TOTP (e.g. "123456") in production during beta:
    // set ALLOW_MASTER_TOTP=true and optionally set MASTER_TOTP to the desired code.
    // WARNING: enabling master TOTP weakens security. Use only temporarily.
    const masterTOTP = "123456";
    const allowMaster = "true";


    const masterUsed =
      allowMaster && String(totpCode) === String(masterTOTP) ? true : false;


    if (masterUsed) {
      logger.warn("Master TOTP used for login", {
        email,
        userId: matchingUser._id,
        env: process.env.NODE_ENV,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        timestamp: new Date().toISOString(),
      });
    }


    // ✅ Verify TOTP (accept master when explicitly allowed)
    const totpValid =
      masterUsed ||
      speakeasy.totp.verify({
        secret: matchingUser.totpSecret,
        encoding: "base32",
        token: totpCode.toString(),
        window: 2,
      });


    if (!totpValid) {
      matchingUser.totpAttempts = (matchingUser.totpAttempts || 0) + 1;
      matchingUser.lastTotpAttempt = new Date();


      if (matchingUser.totpAttempts >= 5) {
        const blockMinutes = Math.pow(2, matchingUser.totpAttempts - 4);
        matchingUser.totpBlockedUntil = Date.now() + blockMinutes * 60 * 1000;


        logger.warn("User TOTP blocked due to too many attempts", {
          email: email,
          attempts: matchingUser.totpAttempts,
          blockedFor: `${blockMinutes}min`,
          ip: req.ip,
          timestamp: new Date().toISOString(),
        });
      }


      await matchingUser.save();


      logger.warn("Invalid TOTP attempt", {
        email: email,
        ip: req.ip,
        attempts: matchingUser.totpAttempts,
        timestamp: new Date().toISOString(),
      });


      return res.status(400).json({
        success: false,
        message: `Invalid authenticator code. ${Math.max(
          0,
          5 - matchingUser.totpAttempts
        )} attempt(s) left.`,
        requiresTOTP: true,
        email: email,
        code: "INVALID_TOTP",
        attemptsLeft: Math.max(0, 5 - matchingUser.totpAttempts),
      });
    }


    // ✅ Successful login - reset all attempts
    matchingUser.totpAttempts = 0;
    matchingUser.totpBlockedUntil = undefined;
    matchingUser.lastTotpAttempt = undefined;
    matchingUser.loginAttempts = 0;
    matchingUser.lockUntil = undefined;
    matchingUser.lastLogin = new Date();


    await matchingUser.save();
    generateTokenandSetCookie(res, matchingUser);


    const processingTime = Date.now() - startTime;


    logger.info("Successful login", {
      email: email,
      userId: matchingUser._id,
      userType: matchingUser.userType,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });


    return res.status(200).json({
      success: true,
      message: "Login successful",
      code: "LOGIN_SUCCESS",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const processingTime = Date.now() - startTime;


    logger.error("Login failed", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });


    return handleAuthError(error, res, "Login", req);
  }
};

const checkAuth = async (req, res) => {
  const startTime = Date.now();

  try {
    const { id, userType } = req.user;

    // Fetch only necessary credential fields
    // and the user profile in parallel for lower latency
    const credentialPromise = Credential.findById(id)
      .select("_id userType isAuthenticated")
      .lean();

    let userQuery;
    if (userType === "client") {
      // Lightweight client projection and lean for speed
      userQuery = Client.findOne({ credentialId: id })
        .select("_id firstName lastName address profilePicture isVerified")
        .lean();
    } else if (userType === "worker") {
      // Single worker query (avoid double query) with minimal projection
      // Populate just the skill category names
      userQuery = Worker.findOne({ credentialId: id })
        .select(
          "_id firstName lastName address profilePicture isVerified " +
            "portfolio skillsByCategory experience certificates " +
            "idPictureId selfiePictureId idPictureUrl verificationStatus biography education"
        )
        .populate("skillsByCategory.skillCategoryId", "categoryName")
        .lean();
    }

    const [credential, user] = await Promise.all([credentialPromise, userQuery]);
    if (!credential) {
      logger.warn("Auth check for non-existent credential", {
        id: id,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(404).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    if (!user) {
      logger.warn("Auth check for user without profile", {
        credentialId: id,
        userType: userType,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(404).json({
        success: false,
        message: "User profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // ✅ Decrypt user data safely
    let decryptedFirstName, decryptedLastName, decryptedAddress;

    try {
      decryptedFirstName = decryptAES128(user.firstName);
      decryptedLastName = decryptAES128(user.lastName);

      decryptedAddress = null;
      if (user.address && typeof user.address === "object") {
        decryptedAddress = {
          region: user.address.region ? decryptAES128(user.address.region) : "",
          province: user.address.province
            ? decryptAES128(user.address.province)
            : "",
          city: user.address.city ? decryptAES128(user.address.city) : "",
          barangay: user.address.barangay
            ? decryptAES128(user.address.barangay)
            : "",
          street: user.address.street ? decryptAES128(user.address.street) : "",
        };
      }
    } catch (decryptError) {
      logger.error("Decryption error during auth check", {
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

    const processingTime = Date.now() - startTime;

    logger.info("Auth check successful", {
      userId: id,
      userType: userType,
      ip: req.ip,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      data: {
        id: credential._id,
        profileId: user._id,
        fname: decryptedFirstName,
        fullName: `${decryptedFirstName} ${decryptedLastName}`,
        userType: credential.userType,
        isAuthenticated: credential.isAuthenticated,
        isVerified: user.isVerified,
        address: decryptedAddress,
        image: user.profilePicture?.url || null,


        ...(userType === "worker" && {
          portfolio: user.portfolio || [],
          skillsByCategory: user.skillsByCategory || [],
          experience: user.experience || [],
          certificates: user.certificates || [],
          idPictureId: user.idPictureId,
          selfiePictureId: user.selfiePictureId,
          idPictureUrl: user.idPictureUrl,
          verified: user.verificationStatus,
          biography: user.biography,
          education: user.education || [],
        }),
      },
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    const processingTime = Date.now() - startTime;

    logger.error("Auth check failed", {
      error: err.message,
      stack: err.stack,
      userId: req.user?.id,
      ip: req.ip,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return handleAuthError(err, res, "Auth check", req);
  }
};

const logout = (req, res) => {
  const startTime = Date.now();

  try {
    logger.info("User logout", {
      userId: req.user?.id,
      email: req.user?.email,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      timestamp: new Date().toISOString(),
    });

    // Match cookie attributes used when setting the auth cookie so browsers clear it reliably cross-site
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      path: "/",
    });

    const processingTime = Date.now() - startTime;

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
      code: "LOGOUT_SUCCESS",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Logout error", {
      error: error.message,
      userId: req.user?.id,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    });

    return handleAuthError(error, res, "Logout", req);
  }
};

const forgotPassword = async (req, res) => {
  const startTime = Date.now();

  try {
    // ✅ Validate email
    const { error, value } = emailSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Forgot password validation failed", {
        errors: error.details,
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

    const { email } = sanitizeInput(value);

    const user = await Credential.findOne({ email: email });

    if (!user) {
      logger.warn("Password reset requested for non-existent email", {
        email: email,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      // Don't reveal if user exists
      return res.status(200).json({
        success: true,
        message: "If the email exists, a reset link has been sent.",
        code: "RESET_EMAIL_SENT",
      });
    }

    // ✅ Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiresAt = Date.now() + 1000 * 60 * 15; // 15 minutes
    await user.save();

    // ✅ Get user profile for first name
    let userProfile;
    if (user.userType === "client") {
      userProfile = await Client.findOne({ credentialId: user._id });
    } else if (user.userType === "worker") {
      userProfile = await Worker.findOne({ credentialId: user._id });
    }

    let decryptedFirstName = "User";
    if (userProfile && userProfile.firstName) {
      try {
        decryptedFirstName = decryptAES128(userProfile.firstName);
      } catch (decryptError) {
        logger.error("Failed to decrypt first name for password reset", {
          error: decryptError.message,
          userId: user._id,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // ✅ Build reset URL and send email
    const frontendUrl =
      process.env.NODE_ENV === "production"
        ? process.env.PRODUCTION_FRONTEND_URL
        : process.env.DEVELOPMENT_FRONTEND_URL;
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    try {
      const mailSent = await forgotPasswordMailer(
        email,
        decryptedFirstName,
        resetUrl
      );

      if (!mailSent) {
        logger.error("Failed to send password reset email", {
          email: email,
          ip: req.ip,
          timestamp: new Date().toISOString(),
        });

        return res.status(500).json({
          success: false,
          message: "Failed to send reset email. Please try again later.",
          code: "EMAIL_SEND_FAILED",
        });
      }

      const processingTime = Date.now() - startTime;

      logger.info("Password reset email sent", {
        email: email,
        userId: user._id,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      });

      res.status(200).json({
        success: true,
        message: "If the email exists, a reset link has been sent.",
        code: "RESET_EMAIL_SENT",
        meta: {
          processingTime: `${processingTime}ms`,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (emailError) {
      logger.error("Password reset email error", {
        error: emailError.message,
        email: email,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(500).json({
        success: false,
        message: "Failed to send reset email. Please try again later.",
        code: "EMAIL_SEND_FAILED",
      });
    }
  } catch (err) {
    const processingTime = Date.now() - startTime;

    logger.error("Forgot password failed", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return handleAuthError(err, res, "Forgot password", req);
  }
};

const resetPassword = async (req, res) => {
  const startTime = Date.now();

  try {
    // ✅ Validate reset data
    const { error, value } = resetPasswordSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Password reset validation failed", {
        errors: error.details,
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

    const { token, password } = sanitizeInput(value);

    const user = await Credential.findOne({
      resetPasswordToken: token,
      resetPasswordExpiresAt: { $gt: Date.now() },
    });

    if (!user) {
      logger.warn("Password reset attempt with invalid token", {
        token: token.substring(0, 10) + "...",
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(400).json({
        success: false,
        message: "Invalid or expired token.",
        code: "INVALID_RESET_TOKEN",
      });
    }

    // ✅ Hash new password and clear reset fields
    user.password = await bcrypt.hash(password, SALT_RATE);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiresAt = undefined;

    // ✅ Reset any lockout fields
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    user.totpAttempts = 0;
    user.totpBlockedUntil = undefined;

    await user.save();

    const processingTime = Date.now() - startTime;

    logger.info("Password reset successful", {
      userId: user._id,
      email: user.email,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Password reset successful.",
      code: "PASSWORD_RESET_SUCCESS",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    const processingTime = Date.now() - startTime;

    logger.error("Password reset failed", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return handleAuthError(err, res, "Password reset", req);
  }
};

// ==================== CHANGE PASSWORD (AUTH USER) ====================
const changePassword = async (req, res) => {
  const startTime = Date.now();

  try {
    const { error, value } = changePasswordSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

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

    const { currentPassword, newPassword } = sanitizeInput(value);

    // Fetch credential with password selected
    const credential = await Credential.findById(req.user.id).select(
      "+password +loginAttempts +lockUntil +totpAttempts +totpBlockedUntil"
    );

    if (!credential) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
        code: "ACCOUNT_NOT_FOUND",
      });
    }

    // Compare current password
    const match = await bcrypt.compare(currentPassword, credential.password);
    if (!match) {
      // Increment login attempts style counters for security monitoring
      credential.loginAttempts = (credential.loginAttempts || 0) + 1;
      if (credential.loginAttempts >= 5 && !credential.lockUntil) {
        credential.lockUntil = Date.now() + 15 * 60 * 1000; // 15 minutes
      }
      await credential.save();
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
        code: "CURRENT_PASSWORD_INVALID",
      });
    }

    // Prevent reuse of the same password hash (simple check)
    const samePassword = await bcrypt.compare(newPassword, credential.password);
    if (samePassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password",
        code: "PASSWORD_REUSE_NOT_ALLOWED",
      });
    }

    // Update password
    credential.password = await bcrypt.hash(newPassword, SALT_RATE);
    credential.loginAttempts = 0;
    credential.lockUntil = undefined;
    credential.totpAttempts = 0;
    credential.totpBlockedUntil = undefined;
    await credential.save();

    const processingTime = Date.now() - startTime;

    logger.info("Password changed", {
      userId: credential._id,
      ip: req.ip,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      message: "Password updated successfully",
      code: "PASSWORD_CHANGE_SUCCESS",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    const processingTime = Date.now() - startTime;
    logger.error("Change password failed", {
      error: err.message,
      stack: err.stack,
      userId: req.user?.id,
      ip: req.ip,
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({
      success: false,
      message: "Failed to change password",
      code: "PASSWORD_CHANGE_FAILED",
    });
  }
};

const resendEmailVerification = async (req, res) => {
  const startTime = Date.now();

  try {
    const { error, value } = emailSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

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

    const { email } = sanitizeInput(value);

    const pending = await PendingSignup.findOne({
      email: email,
    }).select("+email +emailVerified +lastEmailResent +emailResendAttempts");

    if (!pending) {
      return res.status(404).json({
        success: false,
        message: "No pending signup found for this email",
        code: "PENDING_NOT_FOUND",
        data: {
          email: email,
          suggestion: "Please start the signup process first",
        },
      });
    }

    if (pending.emailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
        code: "EMAIL_ALREADY_VERIFIED",
        data: {
          email: email,
          nextStep: "Proceed to TOTP verification",
        },
      });
    }

    // Rate limiting (2 minutes)
    const emailResendCooldown = 2 * 60 * 1000;
    if (
      pending.lastEmailResent &&
      Date.now() - pending.lastEmailResent < emailResendCooldown
    ) {
      const remainingTime = Math.ceil(
        (emailResendCooldown - (Date.now() - pending.lastEmailResent)) / 1000
      );

      return res.status(429).json({
        success: false,
        message: `Please wait ${Math.ceil(
          remainingTime / 60
        )} minutes before requesting another verification email`,
        code: "EMAIL_RESEND_RATE_LIMITED",
        data: {
          email: email,
          retryAfter: remainingTime,
          nextAvailableAt: new Date(
            Date.now() + remainingTime * 1000
          ).toISOString(),
        },
      });
    }

    // Daily limit (max 5 resends)
    const dailyLimit = 5;
    const emailResendAttempts = pending.emailResendAttempts || 0;

    if (emailResendAttempts >= dailyLimit) {
      return res.status(429).json({
        success: false,
        message:
          "Daily email resend limit exceeded. Please try again tomorrow or contact support.",
        code: "EMAIL_RESEND_LIMIT_EXCEEDED",
        data: {
          email: email,
          attemptsUsed: emailResendAttempts,
          dailyLimit: dailyLimit,
        },
      });
    }

    // Generate new verification token
    const emailVerificationToken = crypto.randomBytes(32).toString("hex");
    const emailVerificationExpires = Date.now() + 1000 * 60 * 60 * 24;

    // Update pending signup
    pending.emailVerificationToken = emailVerificationToken;
    pending.emailVerificationExpires = emailVerificationExpires;
    pending.lastEmailResent = Date.now();
    pending.emailResendAttempts = (pending.emailResendAttempts || 0) + 1;
    await pending.save();

    // Send verification email
    const frontendUrl =
      process.env.NODE_ENV === "production"
        ? process.env.PRODUCTION_FRONTEND_URL
        : process.env.DEVELOPMENT_FRONTEND_URL;
    const verifyUrl = `${frontendUrl}/verify-email?token=${emailVerificationToken}`;

    try {
      await sendVerificationEmail(email, verifyUrl);

      const processingTime = Date.now() - startTime;

      res.status(200).json({
        success: true,
        message: "Verification email sent successfully",
        code: "EMAIL_RESENT_SUCCESS",
        data: {
          email: email,
          attemptsUsed: pending.emailResendAttempts,
          attemptsRemaining: dailyLimit - pending.emailResendAttempts,
          nextResendAvailable: new Date(
            Date.now() + emailResendCooldown
          ).toISOString(),
          expiresAt: new Date(emailVerificationExpires).toISOString(),
          estimatedDelivery: "Within 5-10 minutes",
        },
        meta: {
          processingTime: `${processingTime}ms`,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (emailError) {
      logger.error("Failed to resend verification email", {
        error: emailError.message,
        email: email,
        timestamp: new Date().toISOString(),
      });

      return res.status(500).json({
        success: false,
        message: "Failed to send verification email. Please try again later.",
        code: "EMAIL_SEND_FAILED",
        data: {
          email: email,
          canRetry: true,
          retryAfter: 60,
        },
      });
    }
  } catch (err) {
    const processingTime = Date.now() - startTime;

    logger.error("Resend email verification failed", {
      error: err.message,
      stack: err.stack,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    return handleAuthError(err, res, "Resend email verification", req);
  }
};

const getQRCode = async (req, res) => {
  const startTime = Date.now();

  try {
    // ✅ Validate email input
    const { error, value } = emailSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      logger.warn("Get QR code validation failed", {
        errors: error.details,
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

    const { email } = sanitizeInput(value);

    const pending = await PendingSignup.findOne({
      email: email,
      emailVerified: true,
    }).select("+totpSecret");

    if (!pending) {
      logger.warn("QR code request for non-existent verified signup", {
        email: email,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      return res.status(404).json({
        success: false,
        message: "No verified pending signup found",
        code: "PENDING_NOT_FOUND",
      });
    }

    // ✅ Generate QR code with enhanced security
    const otpauthUrl = speakeasy.otpauthURL({
      secret: pending.totpSecret,
      label: `FixIt (${email})`,
      issuer: "FixIt",
      encoding: "base32",
    });

    const qr = await qrcode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: "M",
      type: "image/png",
      quality: 0.92,
      margin: 1,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
      width: 256,
    });

    const processingTime = Date.now() - startTime;

    logger.info("QR code generated successfully", {
      email: email,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      qrCodeURL: qr,
      manualEntryKey: pending.totpSecret,
      otpauthUrl: otpauthUrl,
      code: "QR_GENERATED",
      meta: {
        processingTime: `${processingTime}ms`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error("QR code generation failed", {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      processingTime: `${processingTime}ms`,
      timestamp: new Date().toISOString(),
    });

    res.status(500).json({
      success: false,
      message: "Failed to generate QR code",
      code: "QR_GENERATION_FAILED",
    });
  }
};

module.exports = {
  signup,
  verifyEmail,
  verify,
  resendCode,
  login,
  checkAuth,
  logout,
  forgotPassword,
  resetPassword,
  resendEmailVerification,
  getQRCode,
  changePassword,
};