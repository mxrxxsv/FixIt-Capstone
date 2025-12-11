import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  MapPin,
  Briefcase,
  X,
  Pencil,
  ShieldCheck,
  ShieldAlert,
  FileWarning,
} from "lucide-react";
import { getProfile } from "../api/profile";
import {
  uploadProfilePicture,
  removeProfilePicture,
  deletePortfolio,
  deleteCertificate,
  deleteExperience,
  removeSkillCategory,
  updateWorkerBiography,
} from "../api/profile";
import { deleteEducation } from "../api/education";
import { getAllJobs, updateJob, deleteJob } from "../api/jobs";
import AddPortfolio from "../components/AddPortfolio";
import AddSkill from "../components/AddSkill";
import AddCertificate from "../components/AddCertificate";
import AddExperience from "../components/AddExperience";
import AddEducation from "../components/AddEducation";
import BiographyModal from "../components/BiographyModal";
import DeleteConfirmModal from "../components/DeleteConfirmModal";
import AddressInput from "../components/AddressInput";
import IDSetup from "../components/IDSetup";

const formatAddress = (address) => {
  if (!address || typeof address !== "object") return "Unknown";
  const parts = [address.barangay, address.city, address.province].filter(
    Boolean
  );
  return parts.length ? parts.join(", ") : "Unknown";
};

const normalizeStatus = (status) =>
  String(status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

const formatStatusText = (status) => {
  if (!status) return "Not provided";
  return String(status)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const hasIdentityDocuments = (entity = {}) =>
  Boolean(
    entity.hasIdDocuments || (entity.idPictureId && entity.selfiePictureId)
  );

const deriveVerificationMeta = (entity = {}) => {
  const normalizedStatus = normalizeStatus(entity.verificationStatus);
  const hasDocs = hasIdentityDocuments(entity);
  const manualApproval = Boolean(entity.isVerified ?? entity.profile?.isVerified);
  const ApprovedStatuses = new Set(["approved", "verified", "auto_verified"]);
  const PendingStatuses = new Set([
    "pending",
    "submitted",
    "processing",
    "in_review",
    "under_review",
    "review",
  ]);
  const RejectedStatuses = new Set([
    "rejected",
    "declined",
    "failed",
    "needs_resubmission",
  ]);

  if (manualApproval || (hasDocs && ApprovedStatuses.has(normalizedStatus))) {
    return {
      label: "Verified",
      badgeClass:
        "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
      helperText: formatStatusText(entity.verificationStatus),
      icon: ShieldCheck,
    };
  }

  if (!hasDocs) {
    return {
      label: "Upload required",
      badgeClass: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
      helperText: "Submit a valid ID and selfie to begin verification",
      icon: FileWarning,
    };
  }

  if (PendingStatuses.has(normalizedStatus)) {
    return {
      label: "Pending review",
      badgeClass: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
      helperText: formatStatusText(entity.verificationStatus),
      icon: ShieldAlert,
    };
  }

  if (RejectedStatuses.has(normalizedStatus)) {
    return {
      label: "Action required",
      badgeClass: "bg-red-50 text-red-700 ring-1 ring-red-200",
      helperText: formatStatusText(entity.verificationStatus),
      icon: ShieldAlert,
    };
  }

  return {
    label: "Unverified",
    badgeClass: "bg-gray-50 text-gray-600 ring-1 ring-gray-200",
    helperText: formatStatusText(entity.verificationStatus),
    icon: ShieldAlert,
  };
};

const ProfilePage = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);

  // User posts state
  const [userPosts, setUserPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);

  const [isAddPortfolioOpen, setIsAddPortfolioOpen] = useState(false);
  const [isAddSkillOpen, setIsAddSkillOpen] = useState(false);
  const [isAddCertificateOpen, setIsAddCertificateOpen] = useState(false);
  const [isAddExperienceOpen, setIsAddExperienceOpen] = useState(false);
  const [isAddEducationOpen, setIsAddEducationOpen] = useState(false);

  const [isEditMode, setIsEditMode] = useState(false);

  const [isBioModalOpen, setIsBioModalOpen] = useState(false);
  const [showIdSetup, setShowIdSetup] = useState(false);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteAction, setDeleteAction] = useState(null);
  const [deleteItemName, setDeleteItemName] = useState("");

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobToDelete, setJobToDelete] = useState(null);
  const [isUpdateConfirmOpen, setIsUpdateConfirmOpen] = useState(false);
  const [isJobUpdating, setIsJobUpdating] = useState(false);
  const [isJobDeleting, setIsJobDeleting] = useState(false);
  const [editJob, setEditJob] = useState({
    title: "",
    description: "",
    location: "",
    price: "",
  });

  // Helper: lock editing for hired/in_progress/completed
  const isJobLocked = (job) =>
    ["hired", "in_progress", "completed"].includes(
      (job?.status || "").toLowerCase()
    );

  // Load user
  useEffect(() => {
    getProfile()
      .then((res) => {
        setCurrentUser(res.data.data);
        setLoading(false);
      })
      .catch(() => {
        setCurrentUser(null);
        setLoading(false);
      });
  }, []);

  // Load jobs (if client) or portfolio (if freelancer)
  useEffect(() => {
    if (!currentUser) return;

    if (currentUser.userType === "client") {
      setPostsLoading(true);
      getAllJobs({ clientId: currentUser.profileId })
        .then((res) => {
          const jobs = res.data?.data?.jobs || [];

          setUserPosts(jobs);
        })
        .catch((err) => {
          setUserPosts([]);
        })
        .finally(() => setPostsLoading(false));
    } else {
      setUserPosts(currentUser.portfolio || []);
    }
  }, [currentUser]);

  const fetchPortfolios = async () => {
    try {
      const res = await getProfile();
      setCurrentUser(res.data.data);
    } catch (err) {
      console.error("Failed to refresh portfolios:", err);
    }
  };

  const fetchSkills = async () => {
    try {
      const res = await getProfile();
      setCurrentUser(res.data.data);
    } catch (err) {
      console.error("Failed to refresh skills:", err);
    }
  };

  const fetchCertificates = async () => {
    try {
      const res = await getProfile();
      setCurrentUser(res.data.data);
    } catch (err) {
      console.error("Failed to refresh certificates:", err);
    }
  };

  const fetchExperiences = async () => {
    try {
      const res = await getProfile();
      setCurrentUser(res.data.data);
    } catch (err) {
      console.error("Failed to refresh experiences:", err);
    }
  };

  const handleSaveBiography = async (newBio) => {
    try {
      await updateWorkerBiography({ biography: newBio });
      const res = await getProfile();
      setCurrentUser(res.data.data); // refresh state from server
      setIsBioModalOpen(false);
    } catch (err) {
      console.error("Failed to update biography:", err);
    }
  };

  const handleVerificationStatusChange = async () => {
    try {
      const res = await getProfile();
      setCurrentUser(res.data.data);
    } catch (err) {
      console.error("Failed to refresh verification status:", err);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setPreview(URL.createObjectURL(file));
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("image", selectedFile);
      const res = await uploadProfilePicture(formData);
      setCurrentUser((prev) => ({
        ...prev,
        image: res.data.data.image,
      }));
      setIsModalOpen(false);
      setSelectedFile(null);
      setPreview(null);
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    try {
      setUploading(true);
      await removeProfilePicture();
      setCurrentUser((prev) => ({
        ...prev,
        image: null,
      }));
      setIsModalOpen(false);
    } catch (err) {
      console.error("Remove failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePortfolio = async (id) => {
    try {
      await deletePortfolio(id);
      setCurrentUser((prev) => ({
        ...prev,
        portfolio: prev.portfolio.filter((p) => p._id !== id),
      }));
    } catch (err) {
      console.error(
        "Failed to delete portfolio:",
        err.response?.data || err.message
      );
    }
  };

  const handleDeleteCertificate = async (id) => {
    try {
      await deleteCertificate(id);
      setCurrentUser((prev) => ({
        ...prev,
        certificates: prev.certificates.filter((c) => c._id !== id),
      }));
    } catch (err) {
      console.error(
        "Failed to delete certificate:",
        err.response?.data || err.message
      );
    }
  };

  const handleDeleteExperience = async (id) => {
    try {
      await deleteExperience(id);
      setCurrentUser((prev) => ({
        ...prev,
        experience: prev.experience.filter((e) => e._id !== id),
      }));
    } catch (err) {
      console.error(
        "Failed to delete experience:",
        err.response?.data || err.message
      );
    }
  };

  const fetchEducation = async () => {
    try {
      const res = await getProfile();
      setCurrentUser(res.data.data);
    } catch (err) {
      console.error("Failed to refresh education:", err);
    }
  };

  const handleDeleteEducation = async (id) => {
    try {
      await deleteEducation(id);
      setCurrentUser((prev) => ({
        ...prev,
        education: prev.education.filter((e) => e._id !== id),
      }));
    } catch (err) {
      console.error(
        "Failed to delete education:",
        err.response?.data || err.message
      );
    }
  };

  const handleDeleteSkillCategory = async (id) => {
    try {
      await removeSkillCategory(id);
      setCurrentUser((prev) => ({
        ...prev,
        skillsByCategory: prev.skillsByCategory.filter(
          (s) => s.skillCategoryId._id !== id
        ),
      }));
    } catch (err) {
      console.error(
        "Failed to delete skill category:",
        err.response?.data || err.message
      );
    }
  };

  // Edit button
  const handleEditJob = (job) => {
    if (isJobLocked(job)) return;
    setSelectedJob(job);
    setEditJob({
      title: job.title || "",
      description: job.description || "",
      location: job.location || "",
      // keep as string for the input, convert on save
      price:
        job.price !== undefined && job.price !== null ? String(job.price) : "",
    });
    setIsEditModalOpen(true);
  };

  // Save updated job
  const handleUpdateJob = async () => {
    try {
      if (!selectedJob?.id) return;

      // Build payload with only allowed fields for backend (no title on schema)
      const payload = {
        description: editJob.description?.trim() || undefined,
        location: editJob.location?.trim() || undefined,
        price:
          editJob.price === "" ||
            editJob.price === null ||
            editJob.price === undefined
            ? undefined
            : Number(editJob.price),
      };

      // Remove undefined fields
      Object.keys(payload).forEach(
        (k) => payload[k] === undefined && delete payload[k]
      );

      setIsJobUpdating(true);
      await updateJob(selectedJob.id, payload);

      setUserPosts((prev) =>
        prev.map((job) =>
          job.id === selectedJob.id
            ? {
              ...job,
              ...payload,
            }
            : job
        )
      );
      setIsUpdateConfirmOpen(false);
      setIsEditModalOpen(false);
    } catch (err) {
      console.error("Failed to update job:", err);
    } finally {
      setIsJobUpdating(false);
    }
  };

  // Open delete confirm
  const handleConfirmDelete = (job) => {
    if (isJobLocked(job)) return;
    setJobToDelete(job);
    setIsDeleteConfirmOpen(true);
  };

  // Delete job
  const handleDeleteJob = async () => {
    if (!jobToDelete?.id) return;
    try {
      setIsJobDeleting(true);
      await deleteJob(jobToDelete.id);
      setUserPosts((prev) => prev.filter((job) => job.id !== jobToDelete.id));
      setIsDeleteConfirmOpen(false);
    } catch (err) {
      console.error("Failed to delete job:", err);
    } finally {
      setIsJobDeleting(false);
    }
  };

  const confirmDelete = (action, name = "this") => {
    setDeleteAction(() => action);
    setDeleteItemName(name);
    setIsDeleteModalOpen(true);
  };

  if (loading) {
    return (
      <p className="text-center mt-40 text-gray-500">Loading user profile...</p>
    );
  }

  if (!currentUser) {
    return (
      <p className="text-center mt-40 text-red-500">User not authenticated.</p>
    );
  }

  const { userType, fullName, image, address, biography } = currentUser;
  const verificationMeta = deriveVerificationMeta(currentUser);
  const VerificationIcon = verificationMeta.icon;
  const isClient = userType === "client";
  const needsClientVerification =
    isClient && verificationMeta.label !== "Verified";

  return (
    <div className="max-w-6xl mx-auto p-6 mt-[100px]">
      {/* Profile Header */}
      <div className="relative flex flex-col md:flex-row items-center gap-4 md:gap-8 bg-white shadow rounded-[20px] p-6 mb-10">
        {/* 3-dot menu */}
        <div className="absolute top-4 right-4 text-sm">
          <ThreeDotMenu />
        </div>
        <div className="relative w-24 h-24 shrink-0">
          <img
            src={
              image ||
              "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png"
            }
            alt="Profile"
            className="w-full h-full rounded-full object-cover cursor-pointer hover:opacity-80 transition"
            onClick={() => setIsModalOpen(true)}
          />
          <button
            type="button"
            aria-label="Edit profile photo"
            className="absolute top-0 right-0 z-0 p-1 rounded-full shadow hover:bg-gray-50 cursor-pointer"
            onClick={() => setIsModalOpen(true)}
          >
            <Pencil size={14} className="text-gray-400" />
          </button>
        </div>
        <div className="text-center md:text-left">
          <h2 className="text-2xl font-bold text-[#252525]">{fullName}</h2>
          <p className="text-sm text-gray-500 flex items-center justify-center md:justify-start gap-1">
            <MapPin size={16} /> {formatAddress(address)}
          </p>
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mt-2">
            <span className="text-xs px-2 py-1 rounded-md bg-[#55B2F3]/90 text-white inline-flex items-center gap-1">
              {userType === "client" ? "Client" : "Worker"}
            </span>
            {VerificationIcon && (
              needsClientVerification ? (
                <button
                  type="button"
                  onClick={() => setShowIdSetup(true)}
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${verificationMeta.badgeClass} border border-transparent hover:ring-2 hover:ring-blue-100 transition-colors cursor-pointer`}
                >
                  <VerificationIcon className="w-3 h-3" />
                  Verify identity
                </button>
              ) : (
                <span
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${verificationMeta.badgeClass}`}
                >
                  <VerificationIcon className="w-3 h-3" />
                  {verificationMeta.label}
                </span>
              )
            )}
          </div>
          {needsClientVerification && (
            <p className="text-xs text-amber-600 mt-1">
              {verificationMeta.helperText}
            </p>
          )}

          {userType === "worker" && (
            <div className="relative mt-4">
              <p
                className="text-gray-700 text-sm leading-relaxed text-left cursor-pointer"
                onClick={() => setIsBioModalOpen(true)}
              >
                {biography || "No biography provided."}
              </p>
              <button
                type="button"
                aria-label="Edit biography"
                className="absolute bottom-2 right-2 z-0 p-1 rounded-full bg-white cursor-pointer shadow hover:bg-gray-50"
                onClick={() => setIsBioModalOpen(true)}
              >
                <Pencil size={14} className="text-gray-400" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content Based on Role */}
      {userType === "client" ? (
        <>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-gray-700">
              Your Job Posts
            </h3>
            <button
              onClick={() => setIsEditMode((prev) => !prev)}
              className="px-3 py-0.5 bg-[#55b3f3] text-white text-sm rounded-lg hover:bg-blue-400 cursor-pointer"
            >
              {isEditMode ? "Done" : "Edit"}
            </button>
          </div>

          {postsLoading ? (
            <p className="text-gray-500 text-center">Loading jobs...</p>
          ) : userPosts.length > 0 ? (
            <div className="space-y-4">
              {userPosts.map((post) => (
                <div
                  key={post.id}
                  className="rounded-[20px] p-2 bg-white shadow-sm transition-all"
                >
                  <div className="rounded-xl p-4 bg-white transition-all">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-md font-bold text-[#252525]">
                        {post.client?.name || "Client Name"}
                      </span>
                      <span className="flex items-center gap-1 text-sm font-medium text-[#252525] opacity-80">
                        {new Date(post.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>

                    <p className="text-gray-700 mt-1 text-left flex items-center gap-2">
                      <Briefcase size={20} className="text-[#55B2F3]" />
                      {post.description}
                    </p>

                    <div className="flex flex-wrap gap-2 mt-3 items-center">
                      <span className="bg-[#55B2F3]/90 text-white font-medium backdrop-blur-sm px-2.5 py-1 rounded-md text-sm">
                        {post.category?.name || "Uncategorized"}
                      </span>
                    </div>

                    <div className="flex justify-between items-center mt-4 text-sm text-gray-600">
                      <span className="flex items-center gap-1">
                        <MapPin size={16} /> {post.location}
                      </span>

                      <span className="font-bold text-green-400">
                        ₱{post.price?.toLocaleString() || 0}
                      </span>
                    </div>
                    <div className="flex justify-start mt-2">
                      {post.status && (
                        <span
                          className={`px-3 py-1 rounded-full text-xs shadow-sm ${((post.status || "").toLowerCase() === "open" &&
                            "bg-green-100 text-green-600") ||
                            ((post.status || "").toLowerCase() === "hired" &&
                              "bg-yellow-100 text-yellow-700") ||
                            ((post.status || "").toLowerCase() ===
                              "in_progress" &&
                              "bg-blue-100 text-blue-700") ||
                            ((post.status || "").toLowerCase() ===
                              "completed" &&
                              "bg-gray-200 text-gray-600") ||
                            ((post.status || "").toLowerCase() ===
                              "cancelled" &&
                              "bg-red-100 text-red-600") ||
                            "bg-gray-100 text-gray-600"
                            }`}
                        >
                          {(post.status || "").replace("_", " ")}
                        </span>
                      )}
                    </div>

                    {/* ✅ Action buttons (visible only in Edit mode) */}
                    {isEditMode && !isJobLocked(post) && (
                      <div className="flex justify-end gap-2 mt-4">
                        <button
                          onClick={() => handleEditJob(post)}
                          className="px-3 py-1 bg-[#5eb6f3] text-white rounded-lg hover:bg-sky-500 cursor-pointer text-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleConfirmDelete(post)}
                          className="px-3 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 cursor-pointer text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center">
              You have not posted any jobs yet.
            </p>
          )}

          {/* Edit Job Modal */}
          {isEditModalOpen && selectedJob && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000]">
              <div className="bg-white p-6 rounded-2xl shadow-xl w-[90%] max-w-lg">
                <h3 className="text-lg font-semibold mb-4 text-gray-700">
                  Edit Job
                </h3>

                <textarea
                  placeholder="Description"
                  value={editJob.description}
                  onChange={(e) =>
                    setEditJob({ ...editJob, description: e.target.value })
                  }
                  className="w-full border rounded-lg px-3 py-2 mb-3 text-sm resize-none"
                />
                <label className="block text-sm font-medium text-gray-500 mb-1 text-left">
                  Address
                </label>
                <AddressInput
                  value={editJob.location}
                  onChange={(address) =>
                    setEditJob({ ...editJob, location: address })
                  }
                />
                <input
                  type="number"
                  placeholder="Price (₱)"
                  value={editJob.price}
                  onChange={(e) =>
                    setEditJob({ ...editJob, price: e.target.value })
                  }
                  className="w-full border rounded-lg px-3 py-2 mb-3 text-sm mt-4"
                />

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-3 py-1 text-gray-500 hover:text-gray-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setIsUpdateConfirmOpen(true)}
                    className="px-4 py-1 bg-[#55b3f3] text-white rounded-lg hover:bg-sky-600 cursor-pointer text-sm"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ✅ Delete Confirmation */}
          {isDeleteConfirmOpen && jobToDelete && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000]">
              <div className="bg-white p-6 rounded-2xl shadow-xl w-[90%] max-w-md text-center">
                <h3 className="text-lg font-semibold mb-2 text-gray-700">
                  Confirm Delete
                </h3>
                <p className="text-gray-600 mb-4">
                  Are you sure you want to delete this job post?
                </p>

                <div className="flex justify-center gap-3">
                  <button
                    onClick={() => setIsDeleteConfirmOpen(false)}
                    disabled={isJobDeleting}
                    className={`px-4 py-2 ${isJobDeleting
                      ? "text-gray-300 cursor-not-allowed"
                      : "text-gray-500 hover:text-gray-700"
                      }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteJob}
                    disabled={isJobDeleting}
                    className={`px-4 py-2 rounded-lg ${isJobDeleting
                      ? "bg-red-300 cursor-not-allowed"
                      : "bg-red-500 hover:bg-red-600"
                      } text-white`}
                  >
                    {isJobDeleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ✅ Update Confirmation */}
          {isUpdateConfirmOpen && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000]">
              <div className="bg-white p-6 rounded-2xl shadow-xl w-[90%] max-w-md text-center">
                <h3 className="text-lg font-semibold mb-2 text-gray-700">
                  Confirm Update
                </h3>
                <p className="text-gray-600 mb-4">
                  Are you sure you want to save these changes to your job post?
                </p>

                <div className="flex justify-center gap-3">
                  <button
                    onClick={() => setIsUpdateConfirmOpen(false)}
                    disabled={isJobUpdating}
                    className={`px-4 py-2 ${isJobUpdating
                      ? "text-gray-300 cursor-not-allowed"
                      : "text-gray-500 hover:text-gray-700"
                      }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateJob}
                    disabled={isJobUpdating}
                    className={`px-4 py-2 rounded-lg ${isJobUpdating
                      ? "bg-blue-300 cursor-not-allowed"
                      : "bg-blue-500 hover:bg-blue-600"
                      } text-white`}
                  >
                    {isJobUpdating ? "Saving..." : "Confirm"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showIdSetup && (
            <IDSetup
              onClose={() => setShowIdSetup(false)}
              onStatusChange={handleVerificationStatusChange}
            />
          )}
        </>
      ) : (
        <>
          {/* Credential Section */}

          <div className="bg-white shadow-md rounded-[20px] p-8 mb-4">
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setIsEditMode((prev) => !prev)}
                className="px-3 py-0.5 bg-[#55b3f3] text-white text-sm rounded-lg hover:bg-blue-400 cursor-pointer"
              >
                {isEditMode ? "Done" : "Edit"}
              </button>
            </div>

            {/* ================= SKILLS ================= */}

            <h3 className="text-xl font-semibold mb-3 text-gray-700 text-left flex justify-between items-center">
              Skills
              {isEditMode && (
                <button
                  onClick={() => setIsAddSkillOpen(true)}
                  className="px-3 py-1 bg-[#55b3f3] text-white text-sm rounded-lg hover:bg-blue-400 cursor-pointer"
                >
                  + Add
                </button>
              )}
            </h3>
            {currentUser.skillsByCategory &&
              currentUser.skillsByCategory.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {currentUser.skillsByCategory.map((skill, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 bg-[#55b3f3] text-white text-sm rounded-full shadow-sm px-3 py-1"
                  >
                    <span>
                      {skill.skillCategoryId?.categoryName ||
                        "Unnamed Skill Category"}
                    </span>
                    {isEditMode && (
                      <button
                        onClick={() =>
                          confirmDelete(() =>
                            handleDeleteSkillCategory(skill.skillCategoryId._id)
                          )
                        }
                        className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded hover:bg-red-200 hover:text-red-800 transition cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-left">No skills added yet.</p>
            )}

            {/* AddSkill Modal */}
            {isAddSkillOpen && (
              <AddSkill
                onClose={() => setIsAddSkillOpen(false)}
                onAdd={(newSkills) =>
                  setCurrentUser((prev) => ({
                    ...prev,
                    skills: [...(prev.skills || []), ...newSkills],
                  }))
                }
                onRefresh={fetchSkills}
              />
            )}

            {/* Experience + Education side-by-side on large screens */}
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* ================= EXPERIENCE ================= */}
              <div className="mb-8">
                <h3 className="text-xl font-semibold mb-4 text-gray-700 text-left flex justify-between items-center">
                  Work Experience
                  {isEditMode && (
                    <button
                      onClick={() => setIsAddExperienceOpen(true)}
                      className="px-3 py-1 bg-[#55b3f3] text-white text-sm rounded-lg hover:bg-blue-400 cursor-pointer"
                    >
                      + Add
                    </button>
                  )}
                </h3>
                {currentUser.experience && currentUser.experience.length > 0 ? (
                  <div className="space-y-4">
                    {currentUser.experience.map((exp) => (
                      <div
                        key={exp._id}
                        className="shadow-sm p-4 rounded-md text-left bg-white flex flex-col justify-between"
                      >
                        <div>
                          <h4 className="text-lg font-semibold text-gray-800">
                            {exp.position || "Unknown Position"}
                          </h4>
                          <p className="text-sm text-gray-600">
                            {exp.companyName || "Unknown Company"}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {exp.startYear} – {exp.endYear || "Present"}
                          </p>
                          <p className="text-gray-700 mt-2 text-sm">
                            {exp.responsibilities || "No details provided."}
                          </p>
                        </div>

                        {/* Delete button at bottom */}
                        {isEditMode && (
                          <div className="mt-3 flex justify-end">
                            <button
                              onClick={() =>
                                confirmDelete(
                                  () => handleDeleteExperience(exp._id),
                                  exp.position
                                )
                              }
                              className="px-3 py-1 text-sm rounded-lg bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-800 transition cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-left">No work experience added yet.</p>
                )}
              </div>

              {/* ================= EDUCATION ================= */}
              <div className="mb-8">
                <h3 className="text-xl font-semibold mb-4 text-gray-700 text-left flex justify-between items-center">
                  Education
                  {isEditMode && (
                    <button
                      onClick={() => setIsAddEducationOpen(true)}
                      className="px-3 py-1 bg-[#55b3f3] text-white text-sm rounded-lg hover:bg-blue-400 cursor-pointer"
                    >
                      + Add
                    </button>
                  )}
                </h3>
                {currentUser.education && currentUser.education.length > 0 ? (
                  <div className="space-y-4">
                    {currentUser.education.map((edu) => (
                      <div
                        key={edu._id}
                        className="shadow-sm p-4 rounded-md text-left bg-white flex flex-col justify-between"
                      >
                        <div>
                          <h4 className="text-lg font-semibold text-gray-800">
                            {edu.schoolName || "Unknown School"}
                          </h4>
                          <p className="text-sm text-gray-600">
                            {edu.educationLevel || "Unknown Level"}
                            {edu.degree && ` - ${edu.degree}`}
                          </p>
                          <p className="text-sm text-gray-500 mt-1">
                            {edu.startDate
                              ? new Date(edu.startDate).toLocaleDateString()
                              : "Unknown"}{" "}
                            –{" "}
                            {edu.endDate
                              ? new Date(edu.endDate).toLocaleDateString()
                              : "Present"}
                          </p>
                          <p className="text-sm text-gray-600 mt-1">
                            Status: {edu.educationStatus || "Unknown"}
                          </p>
                        </div>

                        {/* ✅ Delete button at bottom */}
                        {isEditMode && (
                          <div className="mt-3 flex justify-end">
                            <button
                              onClick={() =>
                                confirmDelete(
                                  () => handleDeleteEducation(edu._id),
                                  edu.schoolName
                                )
                              }
                              className="px-3 py-1 text-sm rounded-lg bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-800 transition cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-left">No education added yet.</p>
                )}
              </div>
            </div>

            {/* Modals kept outside the grid */}
            {isAddExperienceOpen && (
              <AddExperience
                onClose={() => setIsAddExperienceOpen(false)}
                onAdd={(newExperience) =>
                  setCurrentUser((prev) => ({
                    ...prev,
                    experience: [...(prev.experience || []), newExperience],
                  }))
                }
                onRefresh={fetchExperiences}
              />
            )}

            {isAddEducationOpen && (
              <AddEducation
                onClose={() => setIsAddEducationOpen(false)}
                onAdd={(newEducation) =>
                  setCurrentUser((prev) => ({
                    ...prev,
                    education: [...(prev.education || []), newEducation],
                  }))
                }
                onRefresh={fetchEducation}
              />
            )}

            {/* ================= PORTFOLIO ================= */}
            <div className="mb-8 mt-4">
              <h3 className="text-xl font-semibold mb-4 text-gray-700 text-left flex justify-between items-center">
                Portfolio
                {isEditMode && (
                  <button
                    onClick={() => setIsAddPortfolioOpen(true)}
                    className="px-3 py-1 bg-[#55b3f3] text-white text-sm rounded-lg hover:bg-blue-400 cursor-pointer"
                  >
                    + Add
                  </button>
                )}
              </h3>

              {currentUser.portfolio && currentUser.portfolio.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                  {currentUser.portfolio.map((item) => (
                    <div
                      key={item._id}
                      className="shadow p-4 rounded-xl text-left bg-white hover:shadow-lg transition flex flex-col justify-between"
                    >
                      {/* Image Section */}
                      <div className="w-full h-40 rounded-md overflow-hidden bg-gray-100 flex items-center justify-center">
                        <img
                          src={
                            item.image?.url
                              ? item.image.url
                              : "https://via.placeholder.com/300x200?text=No+Image"
                          }
                          alt={item.projectTitle || "Portfolio Project"}
                          className="w-full h-full object-cover rounded-md"
                        />
                      </div>

                      {/* Content Section */}
                      <div className="mt-3 flex-1">
                        <h4 className="text-lg font-semibold text-gray-800">
                          {item.projectTitle || "Untitled Project"}
                        </h4>
                        <p className="text-sm text-gray-600 mt-1">
                          {item.description || "No description provided."}
                        </p>
                      </div>

                      {/* Delete Button at Bottom */}
                      {isEditMode && (
                        <div className="mt-4 flex justify-end">
                          <button
                            onClick={() =>
                              confirmDelete(
                                () => handleDeletePortfolio(item._id),
                                item.projectTitle
                              )
                            }
                            className="px-3 py-1 text-sm rounded-lg bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-800 transition cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-left">
                  You have not added any portfolio projects yet.
                </p>
              )}
            </div>

            {/* Show AddPortfolio modal */}
            {isAddPortfolioOpen && (
              <AddPortfolio
                onClose={() => setIsAddPortfolioOpen(false)}
                onAdd={(newPortfolio) =>
                  setCurrentUser((prev) => ({
                    ...prev,
                    portfolio: [...(prev.portfolio || []), newPortfolio],
                  }))
                }
                onRefresh={fetchPortfolios}
              />
            )}

            {/* ================= CERTIFICATES ================= */}
            <div className="mb-8 mt-4">
              <h3 className="text-xl font-semibold mb-4 text-gray-700 text-left flex justify-between items-center">
                Certificates
                {isEditMode && (
                  <button
                    onClick={() => setIsAddCertificateOpen(true)}
                    className="px-3 py-1 bg-[#55b3f3] text-white text-sm rounded-lg hover:bg-blue-400 cursor-pointer"
                  >
                    + Add
                  </button>
                )}
              </h3>
              {currentUser.certificates &&
                currentUser.certificates.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {currentUser.certificates.map((cert, index) => (
                    <div
                      key={index}
                      className="shadow-sm p-3 rounded-md bg-white text-left flex flex-col justify-between"
                    >
                      <img
                        src={
                          cert.url
                            ? cert.url
                            : "https://via.placeholder.com/300x200?text=No+Certificate"
                        }
                        alt="Certificate"
                        className="w-full h-40 object-cover rounded-md"
                      />

                      {/* Delete Button */}
                      {isEditMode && (
                        <div className="mt-3 flex justify-end">
                          <button
                            onClick={() =>
                              confirmDelete(
                                () => handleDeleteCertificate(cert._id),
                                cert.title
                              )
                            }
                            className="px-3 py-1 text-sm rounded-lg bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-800 transition cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-left">No certificates uploaded yet.</p>
              )}
            </div>

            {isAddCertificateOpen && (
              <AddCertificate
                onClose={() => setIsAddCertificateOpen(false)}
                onAdd={(newCertificate) =>
                  setCurrentUser((prev) => ({
                    ...prev,
                    certificates: [
                      ...(prev.certificates || []),
                      newCertificate,
                    ],
                  }))
                }
                onRefresh={fetchCertificates}
              />
            )}
          </div>
        </>
      )}

      {/* Modal for editing biography */}
      {isBioModalOpen && (
        <BiographyModal
          biography={biography}
          onClose={() => setIsBioModalOpen(false)}
          onSave={handleSaveBiography}
        />
      )}

      {/* Modal for confirming deletions */}
      {isDeleteModalOpen && (
        <DeleteConfirmModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          onConfirm={() => {
            if (deleteAction) deleteAction();
            setIsDeleteModalOpen(false);
          }}
          itemName={deleteItemName}
        />
      )}

      {/* Modal for profile picture */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000]">
          <div className="bg-white rounded-2xl p-6 w-96 relative shadow-lg">
            <button
              className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 cursor-pointer"
              onClick={() => setIsModalOpen(false)}
            >
              <X size={20} />
            </button>

            <div>
              <p className="text-left font-semibold">Upload Profile</p>
            </div>

            <div className="flex flex-col items-center mt-5">
              <img
                src={
                  preview ||
                  image ||
                  "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png"
                }
                alt="Preview"
                className="w-32 h-32 rounded-full object-cover mb-4 border"
              />

              <input
                type="file"
                id="fileInput"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />

              <label
                htmlFor="fileInput"
                className="cursor-pointer px-4 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm hover:bg-gray-100 transition"
              >
                Choose Picture
              </label>

              {selectedFile && (
                <p className="mt-2 text-xs text-gray-500">
                  Selected: {selectedFile.name}
                </p>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleUpload}
                  disabled={!selectedFile || uploading}
                  className="px-4 py-2 bg-[#55b3f3] text-white rounded-lg hover:bg-blue-400 cursor-pointer"
                >
                  {uploading ? "Uploading..." : "Upload"}
                </button>
                <button
                  onClick={handleRemove}
                  disabled={uploading}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-700 cursor-pointer transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfilePage;

// Inline 3-dot menu component (kept simple, could be extracted later)
const ThreeDotMenu = () => {
  const [open, setOpen] = React.useState(false);
  const toggle = () => setOpen((o) => !o);
  const close = () => setOpen(false);

  React.useEffect(() => {
    const handler = (e) => {
      // Close if clicking outside
      if (!e.target.closest(".three-dot-wrapper")) {
        setOpen(false);
      }
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  return (
    <div className="three-dot-wrapper relative select-none">
      <button
        type="button"
        aria-label="Menu"
        onClick={toggle}
        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition cursor-pointer border border-gray-200"
      >
        <span className="text-gray-600 text-xl leading-none">⋮</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-2">
          <Link
            to="/change-password"
            onClick={close}
            className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900"
          >
            Change Password
          </Link>
        </div>
      )}
    </div>
  );
};