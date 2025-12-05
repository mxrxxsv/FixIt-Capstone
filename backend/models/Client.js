const mongoose = require("mongoose");

const ClientSchema = new mongoose.Schema(
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

    blocked: {
      type: Boolean,
      default: false,
    },
    blockReason: {
      type: String,
      required: false,
      default: "",
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    totalJobsPosted: {
      type: Number,
      default: 0,
      min: [0, "Total jobs posted cannot be negative"],
    },
  },
  {
    timestamps: true,
    indexes: [
      { credentialId: 1 },
      { isVerified: 1 },
      { verifiedAt: 1 },
      { blocked: 1 },
      { "address.city": 1, "address.province": 1 },
    ],
  }
);

// ==================== VIRTUALS ====================
ClientSchema.virtual("hasCompleteIdVerification").get(function () {
  return !!(this.idPictureId && this.selfiePictureId);
});

ClientSchema.virtual("canResubmit").get(function () {
  return this.verificationStatus === "rejected";
});

ClientSchema.virtual("verificationStatusText").get(function () {
  const statusMap = {
    not_submitted: "Not Submitted",
    pending: "Under Review",
    approved: "Approved",
    rejected: "Rejected",
  };
  return statusMap[this.verificationStatus] || "Unknown";
});

// ==================== INDEXES ====================
ClientSchema.index({ credentialId: 1 }, { unique: true });
ClientSchema.index({ verificationStatus: 1 });
ClientSchema.index({ idVerificationSubmittedAt: 1 });
ClientSchema.index({ isVerified: 1 });
ClientSchema.index({ verifiedAt: 1 });
ClientSchema.index({ blocked: 1 });
ClientSchema.index({ "address.city": 1, "address.province": 1 });

module.exports = mongoose.model("Client", ClientSchema);
