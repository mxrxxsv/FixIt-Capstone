import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import {
  Loader,
  CheckCircle,
  Clock,
  AlertCircle,
  Star,
  Users,
  DollarSign,
  Calendar,
  MessageSquare,
  Eye,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import ContractDetailsModal from "../components/ContractDetailsModal";
import NotificationModal from "../components/NotificationModal";
import {
  getWorkerContracts,
  getClientContracts,
  startWork,
  completeWork,
  confirmWorkCompletion,
  submitFeedback,
} from "../api/feedback.jsx";
import { createOrGetConversation } from "../api/message.jsx";
import worker from "../assets/worker.png";
import client from "../assets/client.png";
import { baseURL } from "../utils/appMode";
import { getProfile } from "../api/profile";

const ContractManagement = () => {
  const navigate = useNavigate();
  const [contracts, setContracts] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef(null);
  // Per-contract action loading flags: { [contractId]: { starting?: bool, completing?: bool } }
  const [actionLoading, setActionLoading] = useState({});
  const [feedbackModal, setFeedbackModal] = useState({
    show: false,
    contract: null,
  });
  const [feedback, setFeedback] = useState({ rating: 5, comment: "" });
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [contractDetailsModal, setContractDetailsModal] = useState({
    show: false,
    contractId: null,
  });
  const [notification, setNotification] = useState({
    show: false,
    type: "info",
    title: "",
    message: "",
  });

  const showNotification = (type, title, message) => {
    setNotification({
      show: true,
      type,
      title,
      message,
    });
  };

  // Helper: check if current user already submitted feedback for a contract
  const hasSubmittedFeedback = (contract, user) => {
    try {
      if (!contract || !user) return false;
      const role = (user.userType || "").toLowerCase();

      // Legacy flags on contract
      if (
        role === "worker" &&
        contract.workerFeedback !== undefined &&
        contract.workerFeedback !== null &&
        String(contract.workerFeedback).trim().length > 0
      )
        return true;
      if (
        role === "client" &&
        contract.clientFeedback !== undefined &&
        contract.clientFeedback !== null &&
        String(contract.clientFeedback).trim().length > 0
      )
        return true;

      // Reviews array/object from API
      const raw = contract.reviews ?? contract.review ?? [];
      const reviews = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object"
          ? [raw]
          : [];
      return reviews.some(
        (r) => (r?.reviewerType || "").toLowerCase() === role
      );
    } catch (_) {
      return false;
    }
  };

  // const closeNotification = () => {
  //   setNotification({
  //     show: false,
  //     type: "info",
  //     title: "",
  //     message: "",
  //   });
  // };

  useEffect(() => {
    loadUserAndContracts();
  }, []);

  const loadUserAndContracts = async () => {
    try {
      const authRes = await getProfile();
      if (!authRes?.data?.success) {
        return;
      }

      const user = authRes.data.data;
      setCurrentUser(user);

      if (!socketRef.current) {
        socketRef.current = io(baseURL, {
          withCredentials: true,
        });

        const credId = user?.credentialId || user?._id || user?.id;
        if (credId) socketRef.current.emit("registerUser", String(credId));

        const refreshContracts = async () => {
          try {
            const list =
              user.userType === "worker"
                ? await getWorkerContracts()
                : await getClientContracts();
            setContracts(list || []);
          } catch (error) {
            console.error("Failed to refresh contracts:", error);
          }
        };
        // Map statuses to friendly notifications
        const notifyForStatus = (status) => {
          const role = (user?.userType || "").toLowerCase();
          const s = String(status || "").toLowerCase();
          switch (s) {
            case "active":
              return {
                type: "info",
                title: "Contract Active",
                message: "A contract is now active.",
              };
            case "in_progress":
              return role === "client"
                ? {
                  type: "info",
                  title: "Work Started",
                  message:
                    "The worker has started working on your contract.",
                }
                : {
                  type: "info",
                  title: "Work Started",
                  message:
                    "You can now continue working on this contract.",
                };
            case "awaiting_client_confirmation":
              return role === "client"
                ? {
                  type: "info",
                  title: "Review Required",
                  message:
                    "The worker marked work as completed. Please confirm completion.",
                }
                : {
                  type: "info",
                  title: "Waiting for Confirmation",
                  message:
                    "Work marked as completed. Waiting for client confirmation.",
                };
            case "completed":
              return {
                type: "success",
                title: "Contract Completed",
                message: "Work completion confirmed.",
              };
            case "cancelled":
              return {
                type: "warning",
                title: "Contract Cancelled",
                message: "This contract has been cancelled.",
              };
            default:
              return {
                type: "info",
                title: "Contract Updated",
                message: "A contract was updated.",
              };
          }
        };

        // Listen for contract lifecycle events; only refresh the list
        socketRef.current.on("contract:created", async () => {
          try { await refreshContracts(); } catch (_) { }
        });

        socketRef.current.on("contract:updated", async () => {
          try { await refreshContracts(); } catch (_) { }
        });

        // Note: backend emits `contract:review_submitted` when a review is added
        socketRef.current.on("contract:review_submitted", async () => {
          try { await refreshContracts(); } catch (_) { }
        });
      }

      // Load contracts based on user type
      const contractsRes =
        user.userType === "worker"
          ? await getWorkerContracts()
          : await getClientContracts();

      // Debug logs removed
      setContracts(contractsRes || []);
    } catch (error) {
      console.error("Failed to load contracts:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      try {
        socketRef.current?.disconnect();
      } catch (error) {
        console.error("Socket disconnect error:", error);
      }
    };
  }, []);

  const handleStartWork = async (contractId) => {
    try {
      // Debug logs removed
      setActionLoading((prev) => ({
        ...prev,
        [contractId]: { ...(prev[contractId] || {}), starting: true },
      }));
      const result = await startWork(contractId);
      // Debug logs removed
      showNotification(
        "success",
        "Work Started",
        "Work started successfully! You can now begin working on this contract."
      );
      loadUserAndContracts();
    } catch (error) {
      console.error("Start work error:", error);
      showNotification(
        "error",
        "Start Work Failed",
        `Failed to start work: ${error.message}`
      );
    } finally {
      setActionLoading((prev) => ({
        ...prev,
        [contractId]: { ...(prev[contractId] || {}), starting: false },
      }));
    }
  };

  const handleCompleteWork = async (contractId) => {
    try {
      // Debug logs removed
      setActionLoading((prev) => ({
        ...prev,
        [contractId]: { ...(prev[contractId] || {}), completing: true },
      }));
      const result = await completeWork(contractId);
      // Debug logs removed
      showNotification(
        "success",
        "Work Completed",
        "Work marked as completed! The contract is now waiting for client confirmation."
      );
      loadUserAndContracts();
    } catch (error) {
      console.error("Complete work error:", error);
      showNotification(
        "error",
        "Complete Work Failed",
        `Failed to mark work as completed: ${error.message}`
      );
    } finally {
      setActionLoading((prev) => ({
        ...prev,
        [contractId]: { ...(prev[contractId] || {}), completing: false },
      }));
    }
  };

  const handleConfirmCompletion = async (contractId) => {
    try {
      setActionLoading((prev) => ({
        ...prev,
        [contractId]: { ...(prev[contractId] || {}), confirming: true },
      }));
      await confirmWorkCompletion(contractId);
      showNotification(
        "success",
        "Work Confirmed",
        "Work completion confirmed successfully! You can now submit feedback for this contract."
      );
      loadUserAndContracts();
    } catch (error) {
      showNotification(
        "error",
        "Confirmation Failed",
        `Failed to confirm completion: ${error.message}`
      );
    } finally {
      setActionLoading((prev) => ({
        ...prev,
        [contractId]: { ...(prev[contractId] || {}), confirming: false },
      }));
    }
  };

  const handleSubmitFeedback = async () => {
    try {
      // Frontend validation
      if (!feedback.comment || feedback.comment.trim().length < 5) {
        showNotification(
          "warning",
          "Validation Error",
          "Feedback must be at least 5 characters long"
        );
        return;
      }

      // Debug logs removed
      setSubmittingFeedback(true);
      await submitFeedback(feedbackModal.contract._id, {
        rating: feedback.rating,
        feedback: feedback.comment, // Backend expects 'feedback' not 'comment'
      });
      showNotification(
        "success",
        "Feedback Submitted",
        "Your feedback has been submitted successfully!"
      );
      setFeedbackModal({ show: false, contract: null });
      setFeedback({ rating: 5, comment: "" });
      loadUserAndContracts();
    } catch (error) {
      console.error("Feedback submission error:", error);
      const status = error?.response?.status;
      const code = error?.response?.data?.code;
      const message = error?.response?.data?.message || error?.message || "";
      if (
        code === "REVIEW_ALREADY_EXISTS" ||
        status === 409 ||
        /duplicate key/i.test(message)
      ) {
        showNotification(
          "info",
          "Already Submitted",
          "You have already submitted feedback for this contract."
        );
      } else {
        showNotification(
          "error",
          "Feedback Failed",
          `Failed to submit feedback: ${message}`
        );
      }
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const handleViewDetails = (contractId) => {
    setContractDetailsModal({
      show: true,
      contractId: contractId,
    });
  };

  const handleCloseDetailsModal = () => {
    setContractDetailsModal({
      show: false,
      contractId: null,
    });
  };

  const handleMessageClick = async (contract) => {
    try {
      // Determine the other party's details
      const otherParty =
        currentUser?.userType === "worker"
          ? { credentialId: contract.clientId, userType: "client" }
          : { credentialId: contract.workerId, userType: "worker" };

      // Determine the other party's credential and type
      const isWorker = currentUser?.userType === "worker";
      const target = isWorker ? contract?.clientId : contract?.workerId;
      const targetCredentialId =
        target?.credentialId && String(target.credentialId);
      const targetUserType = isWorker ? "client" : "worker";

      if (!targetCredentialId) {
        // Fallback: just open chat if we cannot resolve the other party
        navigate("/chat", { state: { contractId: contract._id } });
        return;
      }

      // Best-effort: ensure the conversation exists so ChatPage can immediately load it
      try {
        await createOrGetConversation({
          participantCredentialId: targetCredentialId,
          participantUserType: targetUserType,
        });
      } catch (error) {
        // non-fatal; ChatPage can still create lazily
        console.warn(
          "Conversation creation failed, will create lazily:",
          error.message
        );
      }

      // Navigate to chat with explicit selection + contract banner
      navigate("/chat", {
        state: {
          targetCredentialId: otherParty.credentialId,
          targetUserType: otherParty.userType,
          contractId: contract._id,
        },
      });
    } catch (error) {
      console.error("Failed to navigate to conversation:", error);
      showNotification(
        "error",
        "Navigation Failed",
        "Failed to open conversation"
      );
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      active: {
        color: "bg-blue-100 text-blue-800 border-blue-200",
        icon: Clock,
        text: "Active",
      },
      in_progress: {
        color: "bg-yellow-100 text-yellow-800 border-yellow-200",
        icon: Clock,
        text: "In Progress",
      },
      awaiting_client_confirmation: {
        color: "bg-orange-100 text-orange-800 border-orange-200",
        icon: AlertCircle,
        text: "Confirmation",
      },
      completed: {
        color: "bg-green-100 text-green-800 border-green-200",
        icon: CheckCircle,
        text: "Completed",
      },
      cancelled: {
        color: "bg-red-100 text-red-800 border-red-200",
        icon: AlertCircle,
        text: "Cancelled",
      },
    };

    const badge = badges[status] || {
      color: "bg-gray-100 text-gray-800 border-gray-200",
      icon: Clock,
      text: status,
    };
    const Icon = badge.icon;

    return (
      <span
        className={`px-3 py-2 rounded-full text-sm font-medium border ${badge.color} flex items-center gap-2 w-fit`}
      >
        <Icon size={16} />
        {badge.text}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64 mt-20">
        <Loader className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mt-30">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#545454]">My Contracts</h1>
          <p className="text-[#545454] mt-2">
            Manage your work contracts and track project progress
          </p>
        </div>

        {contracts.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <Users className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-[#545454] mb-2">
              No contracts found
            </h3>
            <p className="text-gray-500">
              {currentUser?.userType === "worker"
                ? "Apply to jobs to start getting contracts"
                : "Hire workers to create contracts"}
            </p>
          </div>
        ) : (
          <div className="grid gap-6">
            {contracts.map((contract) => (
              <div
                key={contract._id}
                className="bg-white rounded-[20px] shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold flex items-center text-[#545454] text-left mb-2 cursor-pointer transition-colors">
                        {contract.jobId.description || "Contract Work"}
                      </h3>
                      <div className="flex flex-col items-left gap-4 text-sm text-gray-600 mb-3">
                        <div className="flex items-center gap-1">
                          {/* <DollarSign size={14} /> */}
                          Aggreed Rate:
                          <span className="font-medium text-gray-900 ">
                            ₱{contract.agreedRate}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar size={16} />
                          <span>
                            Created{" "}
                            {new Date(contract.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm flex items-center text-left text-gray-500 mb-3">
                        Contract Type:{" "}
                        {contract.contractType.replaceAll("_", " ")}
                      </p>
                      <p className="text-sm flex items-center text-left text-gray-500 mb-3">
                        Contract ID: {contract._id}
                      </p>
                    </div>
                    {getStatusBadge(contract.contractStatus)}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-3 mb-4">
                    {/* Debug info - remove after testing */}
                    {/* <div className="text-xs text-gray-400 w-full mb-2">
                      Debug: Status={contract.contractStatus}, User=
                      {currentUser?.userType}
                    </div> */}

                    {/* Worker actions */}
                    {currentUser?.userType === "worker" && (
                      <>
                        {contract.contractStatus === "active" && (
                          <button
                            onClick={() => handleStartWork(contract._id)}
                            disabled={!!actionLoading[contract._id]?.starting}
                            className={`inline-flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${actionLoading[contract._id]?.starting
                                ? "bg-sky-300 text-white opacity-90 cursor-not-allowed"
                                : "bg-[#55b3f3] text-white hover:bg-sky-600"
                              }`}
                          >
                            {actionLoading[contract._id]?.starting ? (
                              <Loader size={16} className="mr-2 animate-spin" />
                            ) : (
                              <Clock size={16} className="mr-2" />
                            )}
                            {actionLoading[contract._id]?.starting
                              ? "Starting..."
                              : "Start Work"}
                          </button>
                        )}
                        {contract.contractStatus === "in_progress" && (
                          <button
                            onClick={() => handleCompleteWork(contract._id)}
                            disabled={!!actionLoading[contract._id]?.completing}
                            className={`inline-flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${actionLoading[contract._id]?.completing
                                ? "bg-sky-300 text-white opacity-90 cursor-not-allowed"
                                : "bg-[#55b3f3] text-white hover:bg-sky-600"
                              }`}
                          >
                            {actionLoading[contract._id]?.completing ? (
                              <Loader size={16} className="mr-2 animate-spin" />
                            ) : (
                              <CheckCircle size={16} className="mr-2" />
                            )}
                            {actionLoading[contract._id]?.completing
                              ? "Requesting..."
                              : "Request Completion"}
                          </button>
                        )}
                        {contract.contractStatus ===
                          "awaiting_client_confirmation" && (
                            <div className="inline-flex items-center px-4 py-2 bg-orange-100 text-orange-800 text-sm font-medium rounded-md">
                              <Clock size={16} className="mr-2" />
                              Waiting for client confirmation
                            </div>
                          )}
                        {contract.contractStatus === "completed" &&
                          !hasSubmittedFeedback(contract, currentUser) && (
                            <button
                              onClick={() => {
                                if (hasSubmittedFeedback(contract, currentUser)) {
                                  showNotification(
                                    "info",
                                    "Already Submitted",
                                    "You have already submitted feedback for this contract."
                                  );
                                  return;
                                }
                                setFeedbackModal({ show: true, contract });
                              }}
                              className="inline-flex items-center px-4 py-2 bg-[#55b3f3] text-white text-sm font-medium rounded-md hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 transition-colors cursor-pointer"
                            >
                              <Star size={16} className="mr-2" />
                              Submit Feedback
                            </button>
                          )}
                      </>
                    )}

                    {/* Client actions */}
                    {currentUser?.userType === "client" && (
                      <>
                        {contract.contractStatus ===
                          "awaiting_client_confirmation" && (
                            <button
                              onClick={() =>
                                handleConfirmCompletion(contract._id)
                              }
                              disabled={!!actionLoading[contract._id]?.confirming}
                              className={`inline-flex items-center px-4 py-2 text-white text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 transition-colors cursor-pointer ${actionLoading[contract._id]?.confirming
                                  ? "bg-sky-300 opacity-90 cursor-not-allowed"
                                  : "bg-[#55b3f3] hover:bg-sky-500"
                                }`}
                            >
                              {actionLoading[contract._id]?.confirming ? (
                                <Loader size={16} className="mr-2 animate-spin" />
                              ) : (
                                <CheckCircle size={16} className="mr-2" />
                              )}
                              {actionLoading[contract._id]?.confirming
                                ? "Confirming..."
                                : "Confirm Completion"}
                            </button>
                          )}
                        {contract.contractStatus === "completed" &&
                          !hasSubmittedFeedback(contract, currentUser) && (
                            <button
                              onClick={() => {
                                if (hasSubmittedFeedback(contract, currentUser)) {
                                  showNotification(
                                    "info",
                                    "Already Submitted",
                                    "You have already submitted feedback for this contract."
                                  );
                                  return;
                                }
                                setFeedbackModal({ show: true, contract });
                              }}
                              className="inline-flex items-center px-4 py-2 bg-[#55b3f3] text-white text-sm font-medium rounded-md hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 transition-colors cursor-pointer"
                            >
                              <Star size={16} className="mr-2" />
                              Submit Feedback
                            </button>
                          )}
                      </>
                    )}

                    {/* View Details button for all contracts */}
                    <button
                      onClick={() => handleViewDetails(contract._id)}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 cursor-pointer"
                    >
                      <Eye size={16} className="mr-2" />
                      View Details
                    </button>

                    {/* Message button for all contracts */}
                    <button
                      onClick={() => handleMessageClick(contract)}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors cursor-pointer"
                    >
                      <MessageSquare size={16} className="mr-2" />
                      Message
                    </button>
                  </div>

                  {/* Show feedback if exists */}
                  {(contract.clientFeedback || contract.workerFeedback) && (
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <h4 className="font-medium text-[#545454] mb-4">
                        Feedback
                      </h4>
                      {contract.clientFeedback && (
                        <div className="bg-white p-2 border-l-4 border-sky-500 pl-4 shadow-sm">
                          <img
                            className="w-5 h-5 text-gray-500 mx-auto mb-3"
                            src={client}
                            alt="client"
                          />
                          <p className="text-sm font-medium text-gray-900">
                            Client Feedback:
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex">
                              {[...Array(5)].map((_, i) => (
                                <Star
                                  key={i}
                                  size={16}
                                  className={
                                    i < contract.clientRating
                                      ? "text-yellow-400 fill-current"
                                      : "text-gray-300"
                                  }
                                />
                              ))}
                            </div>
                            <span className="text-sm text-gray-600">
                              ({contract.clientRating}/5)
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 mt-1">
                            {contract.clientFeedback}
                          </p>
                        </div>
                      )}
                      {contract.workerFeedback && (
                        <div className="bg-white p-2 border-l-4 border-green-500 pl-4 shadow-sm">
                          <img
                            className="w-5 h-5 text-gray-500 mx-auto mb-3"
                            src={worker}
                            alt="worker"
                          />
                          <p className="text-sm font-medium text-gray-900">
                            Worker Feedback:
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex">
                              {[...Array(5)].map((_, i) => (
                                <Star
                                  key={i}
                                  size={16}
                                  className={
                                    i < contract.workerRating
                                      ? "text-yellow-400 fill-current"
                                      : "text-gray-300"
                                  }
                                />
                              ))}
                            </div>
                            <span className="text-sm text-gray-600">
                              ({contract.workerRating}/5)
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 mt-1">
                            {contract.workerFeedback}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Contract Details Modal */}
        <ContractDetailsModal
          contractId={contractDetailsModal.contractId}
          isOpen={contractDetailsModal.show}
          onClose={handleCloseDetailsModal}
          currentUser={currentUser}
        />

        {/* Feedback Modal */}
        {feedbackModal.show && (
          <div className="fixed inset-0 bg-[#f4f6f6]/70 flex items-center justify-center z-[2000]">
            <div className="bg-white rounded-xl p-6 w-[90%] max-w-md mx-auto shadow-xl">
              <h3 className="text-lg font-semibold mb-4 text-center text-gray-800">
                Submit Feedback
              </h3>

              {/* Rating Section */}
              <div className="mb-4 text-center">
                <label className="block text-sm font-medium mb-3 text-gray-700">
                  Rating
                </label>
                <div className="flex items-center justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setFeedback({ ...feedback, rating: star })}
                      className={`p-1 transition-transform transform hover:scale-110 cursor-pointer ${star <= feedback.rating
                        ? "text-yellow-400"
                        : "text-gray-300 hover:text-yellow-300"
                        }`}
                    >
                      <Star
                        size={26}
                        className={
                          star <= feedback.rating ? "fill-current" : ""
                        }
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Comment Section */}
              <div className="mb-5">
                <label className="block text-sm font-medium mb-2 text-gray-700">
                  Comment
                </label>
                <textarea
                  value={feedback.comment}
                  onChange={(e) =>
                    setFeedback({ ...feedback, comment: e.target.value })
                  }
                  className="w-full p-3 border border-gray-300 rounded-md h-28 focus:ring-2 focus:ring-sky-400 focus:outline-none text-sm resize-none"
                  placeholder="Share your experience (minimum 5 characters)..."
                  required
                  minLength={5}
                  maxLength={1000}
                />
                <div className="text-xs text-gray-500 mt-1 text-right">
                  {feedback.comment.length}/1000 characters
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() =>
                    setFeedbackModal({ show: false, contract: null })
                  }
                  className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitFeedback}
                  disabled={submittingFeedback}
                  className={`px-4 py-2 rounded-md transition cursor-pointer text-white ${submittingFeedback
                      ? "bg-sky-300 cursor-not-allowed"
                      : "bg-sky-500 hover:bg-sky-600"
                    }`}
                >
                  <span className="inline-flex items-center">
                    {submittingFeedback && (
                      <Loader size={16} className="mr-2 animate-spin" />
                    )}
                    {submittingFeedback ? "Submitting..." : "Submit Feedback"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Notification Modal */}
        <NotificationModal
          isOpen={notification.show}
          type={notification.type}
          title={notification.title}
          message={notification.message}
          onClose={() =>
            setNotification({ show: false, type: "", title: "", message: "" })
          }
        />
      </div>
    </div>
  );
};

export default ContractManagement;
