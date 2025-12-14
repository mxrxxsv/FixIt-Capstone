const mongoose = require("mongoose");

const WorkerSchema = new mongoose.Schema(
  {
    credentialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Credential",
      unique: true,
    },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: true,
    },
    middleName: {
      type: String,
      default: null,
    },
    suffixName: {
      type: String,
      default: null,
    },
    contactNumber: {
      type: String,
      required: true,
    },
    sex: {
      type: String,
      enum: ["male", "female"],
      required: true,
    },
    dateOfBirth: {
      type: String,
      required: true,
    },
    maritalStatus: {
      type: String,
      enum: [
        "single",
        "married",
        "separated",
        "divorced",
        "widowed",
        "prefer not to say",
      ],
      required: true,
    },
    address: {
      region: {
        type: String,
        required: true,
      },
      province: {
        type: String,
        required: true,
      },
      city: {
        type: String,
        required: true,
      },
      barangay: {
        type: String,
        required: true,
      },
      street: {
        type: String,
        required: true,
      },
    },
    profilePicture: {
      url: {
        type: String,
        required: false,
      },
      public_id: {
        type: String,
        required: false,
      },
    },
    biography: {
      type: String,
      default: "",
    },
    skillsByCategory: [
      {
        skillCategoryId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "SkillCategory",
          required: true,
        },
      },
    ],
    portfolio: [
      {
        projectTitle: {
          type: String,
          default: "",
        },
        description: {
          type: String,
          default: "",
        },
        image: {
          url: {
            type: String,
            required: true,
          },
          public_id: {
            type: String,
            required: true,
          },
        },
      },
    ],
    education: [
      {
        schoolName: {
          type: String,
          required: true,
          trim: true,
        },
        educationLevel: {
          type: String,
          required: true,
          enum: [
            "Elementary",
            "Junior High",
            "Senior High",
            "Vocational",
            "College",
            "Master’s",
            "Doctorate",
          ],
        },
        degree: {
          type: String,
          trim: true,
        },
        startDate: {
          type: Date,
          required: true,
        },
        endDate: {
          type: String,
          default: null,
        },
        educationStatus: {
          type: String,
          enum: ["Graduated", "Undergraduate", "Currently Studying"],
          required: true,
        },
      },
    ],
    experience: [
      {
        companyName: {
          type: String,
          required: true,
        },
        position: {
          type: String,
          required: true,
        },
        startYear: {
          type: Number,
          required: true,
        },
        endYear: {
          type: Number,
          default: null,
        },
        responsibilities: {
          type: String,
          default: "",
        },
      },
    ],
    certificates: [
      {
        url: {
          type: String,
          required: true,
        },
        public_id: {
          type: String,
          required: true,
        },
      },
    ],

    // ==================== ID VERIFICATION FIELDS ====================
    idPictureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IDPicture",
      default: null,
    },
    selfiePictureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Selfie",
      default: null,
    },
    verificationStatus: {
      type: String,
      enum: ["not_submitted", "pending", "approved", "rejected"],
      default: "not_submitted",
    },
    idVerificationSubmittedAt: {
      type: Date,
      default: null,
    },
    idVerificationApprovedAt: {
      type: Date,
      default: null,
    },
    approvedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    idVerificationRejectedAt: {
      type: Date,
      default: null,
    },
    rejectedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },

    // ==================== EXISTING WORKER FIELDS ====================
    status: {
      type: String,
      enum: ["available", "working", "not available"],
      default: "available",
    },
    currentJob: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
    },
    blocked: {
      type: Boolean,
      default: false,
    },
    blockReason: {
      type: String,
      required: false,
      default: "",
    },
    totalJobsCompleted: {
      type: Number,
      default: 0,
      min: [0, "Total jobs completed cannot be negative"],
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ==================== VIRTUAL FIELDS ====================

// Check if both ID documents are uploaded
WorkerSchema.virtual("hasCompleteIdVerification").get(function () {
  return !!(this.idPictureId && this.selfiePictureId);
});

// Check if can resubmit documents
WorkerSchema.virtual("canResubmit").get(function () {
  return this.verificationStatus === "rejected";
});

// Get verification status display text
WorkerSchema.virtual("verificationStatusText").get(function () {
  const statusMap = {
    not_submitted: "Not Submitted",
    pending: "Under Review",
    approved: "Approved",
    rejected: "Rejected",
  };
  return statusMap[this.verificationStatus] || "Unknown";
});

// ==================== METHODS ====================

// Method to submit ID verification
WorkerSchema.methods.submitIdVerification = function (
  idPictureId,
  selfiePictureId
) {
  this.idPictureId = idPictureId;
  this.selfiePictureId = selfiePictureId;
  this.verificationStatus = "pending";
  this.idVerificationSubmittedAt = new Date();
  return this;
};

// Method to approve ID verification
WorkerSchema.methods.approveIdVerification = function () {
  this.verificationStatus = "approved";
  this.idVerificationApprovedAt = new Date();
  return this;
};

// Method to reject ID verification
WorkerSchema.methods.rejectIdVerification = function () {
  this.verificationStatus = "rejected";
  this.idVerificationRejectedAt = new Date();
  return this;
};

// ==================== WORK STATUS METHODS ====================

// Check if worker is available for new work
WorkerSchema.methods.isAvailableForWork = function () {
  return (
    this.status === "available" &&
    !this.blocked &&
    this.isVerified &&
    !this.currentJob
  );
};

// Check if worker can accept new contracts (stricter check)
WorkerSchema.methods.canAcceptNewContract = function () {
  // Worker must be available and not already working on another job
  return this.isAvailableForWork() && this.status !== "working";
};

// Start working on a job
WorkerSchema.methods.startWorking = function (jobId) {
  this.status = "working";
  this.currentJob = jobId;
  return this;
};

// Mark worker as available (when work is completed/cancelled)
WorkerSchema.methods.becomeAvailable = function () {
  this.status = "available";
  this.currentJob = null;
  return this;
};

// Set worker as not available
WorkerSchema.methods.setNotAvailable = function () {
  this.status = "not available";
  this.currentJob = null;
  return this;
};

// Get status display text
WorkerSchema.virtual("statusText").get(function () {
  const statusMap = {
    available: "Available",
    working: "Working",
    "not available": "Not Available",
  };
  return statusMap[this.status] || "Unknown";
});

// ==================== INDEXES ====================
WorkerSchema.index({ verificationStatus: 1 });
WorkerSchema.index({ isVerified: 1 });
WorkerSchema.index({ verifiedAt: 1 });
WorkerSchema.index({ blocked: 1 });
WorkerSchema.index({ status: 1 });
WorkerSchema.index({ idVerificationSubmittedAt: 1 });
WorkerSchema.index({ "address.city": 1, "address.province": 1 });

module.exports = mongoose.model("Worker", WorkerSchema);
