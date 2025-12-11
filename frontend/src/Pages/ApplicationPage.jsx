import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import {
  getWorkerApplications,
  getClientApplications,
  respondToApplication,
  startApplicationDiscussion,
  markApplicationAgreement,
} from "../api/jobApplication";
import {
  getMyInvitations,
  getMySentInvitations,
  respondToInvitation,
  startInvitationDiscussion,
  markInvitationAgreement,
} from "../api/applications.jsx";
import { createOrGetConversation } from "../api/message.jsx";
import { getProfile } from "../api/profile.jsx";
import { baseURL } from "../utils/appMode";
import {
  Loader,
  User,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Briefcase,
  X,
  Eye,
  MessageCircle,
  Users,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
const ApplicationsPage = () => {
  const navigate = useNavigate();
  const socketRef = useRef(null);
  const [applications, setApplications] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userType, setUserType] = useState(null);
  const [selectedApp, setSelectedApp] = useState(null);
  const [selectedInvitation, setSelectedInvitation] = useState(null);
  const [activeTab, setActiveTab] = useState("applications");
  const [notice, setNotice] = useState({ open: false, title: "", message: "", variant: "info" });

  // Normalize status strings to detect discussion-like states reliably
  const isDiscussionLike = (status) => {
    if (!status) return false;
    const norm = String(status)
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/-+/g, "_");
    return (
      norm === "in_discussion" ||
      norm === "client_agreed" ||
      norm === "worker_agreed"
    );
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await getProfile();
        if (!res?.data?.success) {
          setError("Not authenticated");
          return;
        }

        const user = res.data.data;
        setUserType(user.userType);

        // Connect socket and register to user room
        if (!socketRef.current) {
          socketRef.current = io(baseURL, { withCredentials: true });
          const credId = user?.credentialId || user?._id || user?.id;
          if (credId) socketRef.current.emit("registerUser", String(credId));

          // Application related events
          const onAppUpdate = async () => {
            try {
              const who = await getProfile();
              let resp;
              if (who.data.data.userType === "worker")
                resp = await getWorkerApplications();
              else resp = await getClientApplications();
              setApplications(resp?.data?.applications || []);
            } catch (e) {
              /* noop */
            }
          };
          const onInvitationUpdate = async () => {
            try {
              const who = await getProfile();
              let inv;
              if (who.data.data.userType === "worker")
                inv = await getMyInvitations();
              else inv = await getMySentInvitations();
              setInvitations(inv || []);
            } catch (e) {
              /* noop */
            }
          };
          socketRef.current.on("application:updated", onAppUpdate);
          socketRef.current.on("application:discussion_started", onAppUpdate);
          socketRef.current.on("application:agreement", onAppUpdate);
          socketRef.current.on("contract:created", () => {
            onAppUpdate();
            onInvitationUpdate();
          });
        }

        // Fetch applications
        let applicationsResponse;
        if (user.userType === "worker") {
          applicationsResponse = await getWorkerApplications();
        } else if (user.userType === "client") {
          applicationsResponse = await getClientApplications();
        }
        setApplications(applicationsResponse?.data?.applications || []);

        // Fetch invitations
        let invitationsResponse;
        if (user.userType === "worker") {
          invitationsResponse = await getMyInvitations();
        } else if (user.userType === "client") {
          invitationsResponse = await getMySentInvitations();
        }
        setInvitations(invitationsResponse || []);
      } catch (err) {
        console.error("fetchData error:", err);
        setError(err.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    return () => {
      try {
        socketRef.current?.disconnect();
      } catch (_) { }
    };
  }, []);

  const handleResponse = async (applicationId, action) => {
    try {
      await respondToApplication(applicationId, { action });
      // Refresh applications to get updated status
      const user = await getProfile();
      let response;
      if (user.data.data.userType === "worker") {
        response = await getWorkerApplications();
      } else if (user.data.data.userType === "client") {
        response = await getClientApplications();
      }
      setApplications(response?.data?.applications || []);

      // Update selected app if it's the one we just responded to
      if (selectedApp?._id === applicationId) {
        const updatedApp = response?.data?.applications?.find(
          (app) => app._id === applicationId
        );
        if (updatedApp) setSelectedApp(updatedApp);
      }
    } catch (err) {
      console.error("Response failed:", err);
      setNotice({
        open: true,
        title: "Application",
        message: err?.message || "Failed to respond to application",
        variant: "error",
      });
    }
  };

  const handleStartDiscussion = async (applicationId) => {
    try {
      const response = await startApplicationDiscussion(applicationId);

      // Refresh applications
      const user = await getProfile();
      let appsResponse;
      if (user.data.data.userType === "worker") {
        appsResponse = await getWorkerApplications();
      } else if (user.data.data.userType === "client") {
        appsResponse = await getClientApplications();
      }
      setApplications(appsResponse?.data?.applications || []);

      // Update selected app
      if (selectedApp?._id === applicationId) {
        const updatedApp = appsResponse?.data?.applications?.find(
          (app) => app._id === applicationId
        );
        if (updatedApp) setSelectedApp(updatedApp);
      }

      // Navigate to Chat with target contact + discussion context
      try {
        const convoInfo = response?.data?.conversationInfo;
        let targetCredentialId = convoInfo?.participantCredentialId || null;
        let targetUserType = convoInfo?.participantUserType || null;

        // Fallback: derive from updated app if API didn't return convoInfo
        if (!targetCredentialId) {
          const updated =
            (appsResponse?.data?.applications || []).find(
              (a) => a._id === applicationId
            ) || selectedApp;
          if (updated) {
            if (updated.workerId?.credentialId) {
              targetCredentialId = String(updated.workerId.credentialId);
              targetUserType = "worker";
            }
          }
        }

        // Optionally ensure conversation exists (Chat can also create lazily)
        if (targetCredentialId && targetUserType) {
          try {
            await createOrGetConversation({
              participantCredentialId: targetCredentialId,
              participantUserType: targetUserType,
            });
          } catch (_) {
            // best-effort; proceed to chat regardless
          }

          const navState = {
            targetCredentialId,
            targetUserType,
            agreementContext: { kind: "application", id: applicationId },
          };
          try {
            sessionStorage.setItem(
              "chatAgreementContext",
              JSON.stringify(navState.agreementContext)
            );
          } catch (_) { }
          navigate("/chat", { state: navState });
          return;
        }

        // If still missing, just open chat but persist agreement context
        try {
          sessionStorage.setItem(
            "chatAgreementContext",
            JSON.stringify({ kind: "application", id: applicationId })
          );
        } catch (_) { }
        navigate("/chat");
      } catch (navErr) {
        console.warn("Navigation to chat failed:", navErr);
      }
    } catch (err) {
      console.error("Start discussion failed:", err);
      setNotice({
        open: true,
        title: "Start Discussion",
        message: err?.message || "Failed to start discussion",
        variant: "error",
      });
    }
  };

  const handleAgreement = async (applicationId, agreed) => {
    try {
      const response = await markApplicationAgreement(applicationId, agreed);

      // Refresh applications
      const user = await getProfile();
      let appsResponse;
      if (user.data.data.userType === "worker") {
        appsResponse = await getWorkerApplications();
      } else if (user.data.data.userType === "client") {
        appsResponse = await getClientApplications();
      }
      setApplications(appsResponse?.data?.applications || []);

      // Update selected app
      if (selectedApp?._id === applicationId) {
        const updatedApp = appsResponse?.data?.applications?.find(
          (app) => app._id === applicationId
        );
        if (updatedApp) setSelectedApp(updatedApp);
      }

      if (response?.data?.contract) {
        setNotice({
          open: true,
          title: "Contract Created",
          message: "Both parties agreed! Work contract has been created successfully!",
          variant: "success",
        });
      } else {
        setNotice({
          open: true,
          title: "Agreement Updated",
          message: response?.message || "Agreement status updated!",
          variant: "info",
        });
      }
    } catch (err) {
      console.error("Agreement failed:", err);
      setNotice({
        open: true,
        title: "Agreement Failed",
        message: err?.message || "Failed to update agreement",
        variant: "error",
      });
    }
  };

  // ==================== INVITATION HANDLERS ====================
  const handleInvitationResponse = async (invitationId, action) => {
    try {
      await respondToInvitation(invitationId, { action });

      // Refresh invitations to get updated status
      const user = await getProfile();
      let response;
      if (user.data.data.userType === "worker") {
        response = await getMyInvitations();
      } else if (user.data.data.userType === "client") {
        response = await getMySentInvitations();
      }
      setInvitations(response || []);

      // Update selected invitation if it's the one we just responded to
      if (selectedInvitation?._id === invitationId) {
        const updatedInvitation = response?.find((inv) => inv._id === invitationId);
        if (updatedInvitation) {
          setSelectedInvitation(updatedInvitation);
        } else if (action === "reject") {
          // If rejected and invitation is no longer in the list, reflect locally
          setSelectedInvitation((prev) =>
            prev ? { ...prev, invitationStatus: "rejected" } : prev
          );
        }
      }
    } catch (err) {
      console.error("Invitation response failed:", err);
      setNotice({
        open: true,
        title: "Invitation",
        message: err?.message || "Failed to respond to invitation",
        variant: "error",
      });
    }
  };

  const handleStartInvitationDiscussion = async (invitationId) => {
    try {
      const response = await startInvitationDiscussion(invitationId);

      // Refresh invitations
      const user = await getProfile();
      let invitationsResponse;
      if (user.data.data.userType === "worker") {
        invitationsResponse = await getMyInvitations();
      } else if (user.data.data.userType === "client") {
        invitationsResponse = await getMySentInvitations();
      }
      setInvitations(invitationsResponse || []);

      // Update selected invitation
      if (selectedInvitation?._id === invitationId) {
        let updatedInvitation = invitationsResponse?.find((inv) => inv._id === invitationId);
        if (!updatedInvitation) {
          // Try to use API payload if provided
          updatedInvitation = response?.data?.invitation || response?.data?.updatedInvitation;
        }
        if (updatedInvitation) {
          setSelectedInvitation(updatedInvitation);
        } else {
          // Fallback: reflect status immediately in the modal
          setSelectedInvitation((prev) => {
            if (!prev) return prev;
            if (agreed === false) return { ...prev, invitationStatus: "rejected" };
            const inferred = userType === "worker" ? "worker_agreed" : "client_agreed";
            return { ...prev, invitationStatus: inferred };
          });
        }
      }

      // Navigate to Chat with target contact + discussion context
      try {
        const convoInfo = response?.data?.conversationInfo;
        let targetCredentialId = convoInfo?.participantCredentialId || null;
        let targetUserType = convoInfo?.participantUserType || null;

        // Fallback: derive from updated invitation if API didn't return convoInfo
        if (!targetCredentialId) {
          const updated =
            (invitationsResponse || []).find((i) => i._id === invitationId) ||
            selectedInvitation;
          if (updated) {
            if (updated.clientId?.credentialId) {
              targetCredentialId = String(updated.clientId.credentialId);
              targetUserType = "client";
            }
          }
        }

        // Ensure conversation exists (optional)
        if (targetCredentialId && targetUserType) {
          try {
            await createOrGetConversation({
              participantCredentialId: targetCredentialId,
              participantUserType: targetUserType,
            });
          } catch (_) { }

          const navState = {
            targetCredentialId,
            targetUserType,
            agreementContext: { kind: "invitation", id: invitationId },
          };
          try {
            sessionStorage.setItem(
              "chatAgreementContext",
              JSON.stringify(navState.agreementContext)
            );
          } catch (_) { }
          navigate("/chat", { state: navState });
          return;
        }

        // Persist agreement context even when falling back
        try {
          sessionStorage.setItem(
            "chatAgreementContext",
            JSON.stringify({ kind: "invitation", id: invitationId })
          );
        } catch (_) { }
        navigate("/chat");
      } catch (navErr) {
        console.warn("Navigation to chat failed:", navErr);
      }
    } catch (err) {
      console.error("Start invitation discussion failed:", err);
      setNotice({
        open: true,
        title: "Start Discussion",
        message: err?.message || "Failed to start discussion",
        variant: "error",
      });
    }
  };

  // Unified helpers to open chat from modals
  const openChatForCurrentApplication = async () => {
    try {
      if (!selectedApp) return;
      // If client and still pending, start discussion first then navigate (handler already navigates)
      if (
        userType === "client" &&
        selectedApp.applicationStatus === "pending"
      ) {
        await handleStartDiscussion(selectedApp._id);
        return;
      }

      // Derive target based on role
      let targetCredentialId = null;
      let targetUserType = null;
      if (userType === "client") {
        targetCredentialId =
          selectedApp?.workerId?.credentialId &&
          String(selectedApp.workerId.credentialId);
        targetUserType = "worker";
      } else if (userType === "worker") {
        targetCredentialId =
          selectedApp?.clientId?.credentialId &&
          String(selectedApp.clientId.credentialId);
        targetUserType = "client";
      }

      if (targetCredentialId && targetUserType) {
        const includeAgreement = isDiscussionLike(
          selectedApp.applicationStatus
        );
        try {
          await createOrGetConversation({
            participantCredentialId: targetCredentialId,
            participantUserType: targetUserType,
          });
        } catch (_) { }

        const navState = {
          targetCredentialId,
          targetUserType,
          agreementContext: includeAgreement
            ? { kind: "application", id: selectedApp._id }
            : undefined,
        };
        try {
          if (navState.agreementContext) {
            sessionStorage.setItem(
              "chatAgreementContext",
              JSON.stringify(navState.agreementContext)
            );
          }
        } catch (_) { }
        navigate("/chat", { state: navState });
      } else {
        // Fallback: still persist agreement context if in discussion
        if (isDiscussionLike(selectedApp?.applicationStatus)) {
          try {
            sessionStorage.setItem(
              "chatAgreementContext",
              JSON.stringify({ kind: "application", id: selectedApp._id })
            );
          } catch (_) { }
        }
        navigate("/chat");
      }
    } catch (e) {
      console.warn("Open chat (application) failed:", e);
    }
  };

  const openChatForCurrentInvitation = async () => {
    try {
      if (!selectedInvitation) return;

      let justStarted = false;
      let convoInfo = null;

      // If still pending, attempt to start discussion regardless of role
      if (selectedInvitation.invitationStatus === "pending") {
        try {
          const res = await startInvitationDiscussion(selectedInvitation._id);
          convoInfo = res?.data?.conversationInfo || null;
          justStarted = true;
          // Refresh invitations after starting discussion
          const auth = await getProfile();
          let refresh;
          if (auth?.data?.data?.userType === "worker") {
            refresh = await getMyInvitations();
          } else if (auth?.data?.data?.userType === "client") {
            refresh = await getMySentInvitations();
          }
          setInvitations(refresh || []);
          // Update selected invitation if available
          if (selectedInvitation?._id) {
            const updated = refresh?.find?.((inv) => inv._id === selectedInvitation._id);
            if (updated) setSelectedInvitation(updated);
          }
        } catch (_) {
          // Non-fatal; we'll still try to open chat with derived target
        }
      }

      // Derive target credential and user type
      let targetCredentialId = convoInfo?.participantCredentialId || null;
      let targetUserType = convoInfo?.participantUserType || null;

      // Fallback from invitation data
      if (!targetCredentialId) {
        if (userType === "worker") {
          targetCredentialId = String(selectedInvitation?.clientId?.credentialId || "");
          targetUserType = "client";
        } else {
          targetCredentialId = String(selectedInvitation?.workerId?.credentialId || "");
          targetUserType = "worker";
        }
      }

      const includeAgreement =
        justStarted || isDiscussionLike(selectedInvitation.invitationStatus);

      if (targetCredentialId && targetUserType) {
        try {
          window.sessionStorage.setItem(
            "chat:targetCredentialId",
            targetCredentialId
          );
          window.sessionStorage.setItem(
            "chat:targetUserType",
            targetUserType
          );
          window.sessionStorage.setItem(
            "chat:includeAgreementContext",
            includeAgreement ? "1" : "0"
          );
        } catch (_) { }
        navigate("/chat");
      } else {
        // Last resort: open chat without a pre-selected target but preserve context
        try {
          window.sessionStorage.setItem(
            "chat:includeAgreementContext",
            includeAgreement ? "1" : "0"
          );
        } catch (_) { }
        navigate("/chat");
      }
    } catch (e) {
      console.warn("Open chat (invitation) failed:", e);
    }
  };

  // Open Chat directly from a list item (application)
  const openChatForApplicationItem = async (app) => {
    try {
      if (!app) return;

      let justStarted = false;
      let convoInfo = null;

      // If client and still pending, start discussion first
      if (userType === "client" && app.applicationStatus === "pending") {
        try {
          const res = await startApplicationDiscussion(app._id);
          convoInfo = res?.data?.conversationInfo || null;
          justStarted = true;
        } catch (_) { }
      }

      // Derive target
      let targetCredentialId = null;
      let targetUserType = null;
      if (userType === "client") {
        targetCredentialId =
          app?.workerId?.credentialId && String(app.workerId.credentialId);
        targetUserType = "worker";
      } else if (userType === "worker") {
        targetCredentialId =
          app?.clientId?.credentialId && String(app.clientId.credentialId);
        targetUserType = "client";
      }

      const includeAgreement =
        justStarted || isDiscussionLike(app.applicationStatus);

      if (targetCredentialId && targetUserType) {
        try {
          await createOrGetConversation({
            participantCredentialId: targetCredentialId,
            participantUserType: targetUserType,
          });
        } catch (_) { }

        const navState = {
          targetCredentialId,
          targetUserType,
          agreementContext: includeAgreement
            ? { kind: "application", id: app._id }
            : undefined,
        };
        try {
          if (navState.agreementContext) {
            sessionStorage.setItem(
              "chatAgreementContext",
              JSON.stringify(navState.agreementContext)
            );
          }
        } catch (_) { }
        navigate("/chat", { state: navState });
      } else {
        if (includeAgreement) {
          try {
            sessionStorage.setItem(
              "chatAgreementContext",
              JSON.stringify({ kind: "application", id: app._id })
            );
          } catch (_) { }
        }
        navigate("/chat");
      }
    } catch (e) {
      console.warn("Open chat from application item failed:", e);
    }
  };

  // Open Chat directly from a list item (invitation)
  const openChatForInvitationItem = async (inv) => {
    try {
      if (!inv) return;

      let justStarted = false;
      let convoInfo = null;

      // If worker and still pending, start discussion first
      if (userType === "worker" && inv.invitationStatus === "pending") {
        try {
          const res = await startInvitationDiscussion(inv._id);
          convoInfo = res?.data?.conversationInfo || null;
          justStarted = true;
        } catch (_) { }
      }

      // Derive target
      let targetCredentialId = null;
      let targetUserType = null;
      if (userType === "worker") {
        targetCredentialId =
          inv?.clientId?.credentialId && String(inv.clientId.credentialId);
        targetUserType = "client";
      } else if (userType === "client") {
        targetCredentialId =
          inv?.workerId?.credentialId && String(inv.workerId.credentialId);
        targetUserType = "worker";
      }

      const includeAgreement =
        justStarted || isDiscussionLike(inv.invitationStatus);

      if (targetCredentialId && targetUserType) {
        try {
          await createOrGetConversation({
            participantCredentialId: targetCredentialId,
            participantUserType: targetUserType,
          });
        } catch (_) { }

        const navState = {
          targetCredentialId,
          targetUserType,
          agreementContext: includeAgreement
            ? { kind: "invitation", id: inv._id }
            : undefined,
        };
        try {
          if (navState.agreementContext) {
            sessionStorage.setItem(
              "chatAgreementContext",
              JSON.stringify(navState.agreementContext)
            );
          }
        } catch (_) { }
        navigate("/chat", { state: navState });
      } else {
        if (includeAgreement) {
          try {
            sessionStorage.setItem(
              "chatAgreementContext",
              JSON.stringify({ kind: "invitation", id: inv._id })
            );
          } catch (_) { }
        }
        navigate("/chat");
      }
    } catch (e) {
      console.warn("Open chat from invitation item failed:", e);
    }
  };

  const handleInvitationAgreement = async (invitationId, agreed) => {
    try {
      const response = await markInvitationAgreement(invitationId, { agreed });

      // Refresh invitations
      const user = await getProfile();
      let invitationsResponse;
      if (user.data.data.userType === "worker") {
        invitationsResponse = await getMyInvitations();
      } else if (user.data.data.userType === "client") {
        invitationsResponse = await getMySentInvitations();
      }
      setInvitations(invitationsResponse || []);

      // Update selected invitation
      if (selectedInvitation?._id === invitationId) {
        let updatedInvitation = invitationsResponse?.find((inv) => inv._id === invitationId);
        if (!updatedInvitation) {
          // Try to use API payload if provided
          updatedInvitation = response?.data?.invitation || response?.data?.updatedInvitation;
        }
        if (updatedInvitation) {
          setSelectedInvitation(updatedInvitation);
        } else {
          // Fallback: reflect status immediately in the modal
          setSelectedInvitation((prev) => {
            if (!prev) return prev;
            if (agreed === false) return { ...prev, invitationStatus: "rejected" };
            const inferred = userType === "worker" ? "worker_agreed" : "client_agreed";
            return { ...prev, invitationStatus: inferred };
          });
        }
      }

      if (response?.data?.contract) {
        setNotice({
          open: true,
          title: "Contract Created",
          message: "Both parties agreed! Work contract has been created successfully!",
          variant: "success",
        });
      } else {
        setNotice({
          open: true,
          title: "Agreement Updated",
          message: response?.message || "Agreement status updated!",
          variant: "info",
        });
      }
    } catch (err) {
      console.error("Invitation agreement failed:", err);
      setNotice({
        open: true,
        title: "Agreement Failed",
        message: err?.message || "Failed to update agreement",
        variant: "error",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64 mt-20">
        <Loader className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-center text-red-500 font-medium mt-30">{error}</p>
    );
  }

  return (
    <div className="p-4 sm:p-6 mt-30 max-w-5xl mx-auto">
      <h1 className="text-xl sm:text-2xl font-bold text-[#545454] mb-6">
        {userType === "worker"
          ? "My Applications & Invitations"
          : "Applications & Invitations Sent"}
      </h1>

      {/* Tabs */}
      <div className="flex space-x-1 bg-gray-200 rounded-lg mb-6 opacity-80">
        <button
          onClick={() => setActiveTab("applications")}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${activeTab === "applications"
            ? "bg-white text-[#55b3f3] shadow-sm"
            : "text-gray-600 hover:text-gray-800 cursor-pointer"
            }`}
        >
          Applications ({applications.length})
        </button>
        <button
          onClick={() => setActiveTab("invitations")}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${activeTab === "invitations"
            ? "bg-white text-[#55b3f3] shadow-sm"
            : "text-gray-600 hover:text-gray-800 cursor-pointer"
            }`}
        >
          {userType === "worker" ? "Invitations Received" : "Invitations Sent"}{" "}
          ({invitations.length})
        </button>
      </div>

      {/* Content based on active tab */}
      {activeTab === "applications" && (
        <div>
          {applications.length === 0 ? (
            <p className="text-gray-500 md:text-center sm:text-left">
              {userType === "worker"
                ? "You have not applied to any jobs yet."
                : "No applications received yet."}
            </p>
          ) : (
            <div className="grid gap-4 sm:gap-5">
              {applications.map((app) => (
                <div
                  key={app._id}
                  onClick={() => setSelectedApp(app)}
                  className="bg-white shadow-md rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center hover:shadow-lg transition-all duration-200 cursor-pointer group"
                >
                  {/* LEFT SIDE INFO */}
                  <div className="flex items-start sm:items-center gap-3 sm:gap-4 flex-1">
                    <img
                      src={
                        userType === "worker"
                          ? app.clientId?.profilePicture?.url ||
                          "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"
                          : app.workerId?.profilePicture?.url ||
                          "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"
                      }
                      alt="Avatar"
                      className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover border"
                    />

                    <div>
                      {/* Worker or Client Name */}
                      <p className="font-semibold text-gray-800 flex items-center gap-2 text-sm sm:text-base">
                        <User className="w-4 h-4 text-blue-500" />
                        {userType === "worker"
                          ? `${app.clientId?.firstName || ""} ${app.clientId?.lastName || ""
                          }`
                          : `${app.workerId?.firstName || ""} ${app.workerId?.lastName || ""
                          }`}
                      </p>

                      {/* Job Title (for worker) */}
                      {userType === "worker" && (
                        <p className="text-xs sm:text-sm text-gray-600 flex items-center gap-2 mt-1 text-left line-clamp-1 md:text-base">
                          <Briefcase className="w-4 h-4" />
                          {app.jobId?.description?.substring(0, 50) || "Job"}
                        </p>
                      )}

                      {/* Cover Letter (preview only) */}
                      <p className="text-xs sm:text-sm text-gray-500 flex items-center gap-2 mt-1">
                        <FileText className="w-4 h-4" />
                        {app.message?.substring(0, 40) || "No message"}...
                      </p>
                    </div>
                  </div>

                  {/* RIGHT SIDE - STATUS / VIEW */}
                  <div className="flex items-center gap-2 sm:gap-3 mt-3 sm:mt-0">
                    {/* Status Badge */}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          [
                            "in_discussion",
                            "client_agreed",
                            "worker_agreed",
                          ].includes(app.applicationStatus)
                        )
                          openChatForApplicationItem(app);
                      }}
                      className={`px-2 py-1 sm:px-3 rounded-lg text-xs sm:text-sm font-medium ${app.applicationStatus === "accepted"
                        ? "bg-green-100 text-green-600"
                        : app.applicationStatus === "rejected"
                          ? "bg-red-100 text-red-600"
                          : app.applicationStatus === "in_discussion"
                            ? "bg-blue-100 text-blue-600"
                            : app.applicationStatus === "client_agreed" ||
                              app.applicationStatus === "worker_agreed"
                              ? "bg-yellow-100 text-yellow-600"
                              : "bg-gray-100 text-gray-600"
                        }`}
                    >
                      {app.applicationStatus === "pending"
                        ? "Pending"
                        : app.applicationStatus === "in_discussion"
                          ? "In Discussion"
                          : app.applicationStatus === "client_agreed"
                            ? "Client Agreed"
                            : app.applicationStatus === "worker_agreed"
                              ? "Worker Agreed"
                              : app.applicationStatus === "both_agreed"
                                ? "Both Agreed"
                                : app.applicationStatus}
                    </span>

                    {/* View Details Icon */}
                    <div className="flex items-center gap-1 text-blue-500 group-hover:text-blue-600 text-xs sm:text-sm font-medium">
                      <Eye className="w-4 h-4" />
                      View
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Invitations Tab */}
      {activeTab === "invitations" && (
        <div>
          {invitations.length === 0 ? (
            <p className="text-gray-500 md:text-center sm:text-left">
              {userType === "worker"
                ? "You have not received any invitations yet."
                : "You have not sent any invitations yet."}
            </p>
          ) : (
            <div className="grid gap-4 sm:gap-5">
              {invitations.map((invitation) => (
                <div
                  key={invitation._id}
                  onClick={() => setSelectedInvitation(invitation)}
                  className="bg-white shadow-md rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center hover:shadow-lg transition-all duration-200 cursor-pointer group"
                >
                  {/* LEFT SIDE INFO */}
                  <div className="flex items-start sm:items-center gap-3 sm:gap-4 flex-1">
                    <img
                      src={
                        userType === "worker"
                          ? invitation.clientId?.profilePicture?.url ||
                          "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"
                          : invitation.workerId?.profilePicture?.url ||
                          "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"
                      }
                      alt="Avatar"
                      className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover border"
                    />

                    <div>
                      {/* Client or Worker Name */}
                      <p className="font-semibold text-gray-800 flex items-center gap-2 text-sm sm:text-base">
                        <User className="w-4 h-4 text-blue-500" />
                        {userType === "worker"
                          ? `${invitation.clientId?.firstName || ""} ${invitation.clientId?.lastName || ""
                          }`
                          : `${invitation.workerId?.firstName || ""} ${invitation.workerId?.lastName || ""
                          }`}
                      </p>

                      {/* Job Title */}
                      <p className="text-xs sm:text-sm text-gray-600 flex items-center gap-2 mt-1 text-left line-clamp-1 md:text-base">
                        <Briefcase className="w-4 h-4" />
                        {invitation.jobId?.description?.substring(0, 50) ||
                          "Job"}
                      </p>

                      {/* Description Preview */}
                      <p className="text-xs sm:text-sm text-gray-500 flex items-center gap-2 mt-1">
                        <FileText className="w-4 h-4" />
                        {invitation.description?.substring(0, 40) ||
                          "No description"}
                        ...
                      </p>

                      {/* Proposed Rate */}
                      <p className="text-xs sm:text-sm flex text-gray-500 items-center font-medium mt-1">
                        Proposed Rate:{" "}
                        <span className="text-green-600 pl-1">
                          {" "}
                          ${invitation.proposedRate}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* RIGHT SIDE - STATUS */}
                  <div className="flex items-center gap-2 sm:gap-3 mt-3 sm:mt-0">
                    {/* Status Badge */}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          [
                            "in_discussion",
                            "client_agreed",
                            "worker_agreed",
                          ].includes(invitation.invitationStatus)
                        )
                          openChatForInvitationItem(invitation);
                      }}
                      className={`px-2 py-1 rounded-full text-xs font-medium ${invitation.invitationStatus === "pending"
                        ? "bg-yellow-100 text-yellow-800"
                        : invitation.invitationStatus === "accepted" ||
                          invitation.invitationStatus === "both_agreed"
                          ? "bg-green-100 text-green-800"
                          : invitation.invitationStatus === "rejected"
                            ? "bg-red-100 text-red-800"
                            : invitation.invitationStatus === "in_discussion" ||
                              invitation.invitationStatus === "client_agreed" ||
                              invitation.invitationStatus === "worker_agreed"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-gray-100 text-gray-800"
                        }`}
                    >
                      {invitation.invitationStatus === "pending"
                        ? "Pending"
                        : invitation.invitationStatus === "in_discussion"
                          ? "In Discussion"
                          : invitation.invitationStatus === "client_agreed"
                            ? "Client Agreed"
                            : invitation.invitationStatus === "worker_agreed"
                              ? "Worker Agreed"
                              : invitation.invitationStatus === "both_agreed"
                                ? "Both Agreed"
                                : invitation.invitationStatus === "accepted"
                                  ? "Accepted"
                                  : invitation.invitationStatus === "rejected"
                                    ? "Rejected"
                                    : invitation.invitationStatus}
                    </span>

                    {/* View Details Icon */}
                    <div className="flex items-center gap-1 text-blue-500 group-hover:text-blue-600 text-xs sm:text-sm font-medium">
                      <Eye className="w-4 h-4" />
                      View
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal for Full Details */}
      {selectedApp && (
        <div className="fixed inset-0 bg-[#f4f6f6] bg-opacity-40 flex items-center justify-center z-[2000] px-3">
          <div className="bg-white rounded-2xl shadow-lg p-5 sm:p-6 w-full max-w-md sm:max-w-lg relative">
            <button
              onClick={() => setSelectedApp(null)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-lg sm:text-xl font-bold text-gray-800 mb-4">
              Application Details
            </h2>

            {/* User Info */}
            <div className="flex items-center gap-3 sm:gap-4 mb-4">
              {(() => {
                const isWorker = userType === "worker";
                const person = isWorker ? selectedApp?.clientId : selectedApp?.workerId;
                const pid = person?._id || person?.id || null;
                const routeBase = isWorker ? "/client" : "/worker";
                const canClick = Boolean(pid);
                const avatarSrc =
                  (isWorker
                    ? selectedApp.clientId?.profilePicture?.url
                    : selectedApp.workerId?.profilePicture?.url) ||
                  "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png";
                const fullName = `${person?.firstName || ""} ${person?.lastName || ""}`.trim();
                return (
                  <>
                    <button
                      type="button"
                      onClick={() => canClick && navigate(`${routeBase}/${pid}`)}
                      disabled={!canClick}
                      className={`${canClick ? "cursor-pointer hover:opacity-90" : "cursor-default opacity-60"}`}
                      aria-label={`View ${isWorker ? "client" : "worker"} profile`}
                      title="View profile"
                    >
                      <img
                        src={avatarSrc}
                        alt="Avatar"
                        className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border object-cover"
                      />
                    </button>
                    <div>
                      <button
                        type="button"
                        onClick={() => canClick && navigate(`${routeBase}/${pid}`)}
                        disabled={!canClick}
                        className={`font-semibold text-gray-800 text-sm sm:text-base text-left ${canClick ? "" : "opacity-60"}`}
                        title="View profile"
                      >
                        {fullName || (isWorker ? "Client" : "Worker")}
                      </button>
                      <p className="text-xs sm:text-sm text-gray-600">
                        Status:{" "}
                        <span
                          className={`font-medium ${selectedApp.applicationStatus === "accepted"
                            ? "text-green-600"
                            : selectedApp.applicationStatus === "rejected"
                              ? "text-red-600"
                              : selectedApp.applicationStatus === "in_discussion"
                                ? "text-blue-600"
                                : selectedApp.applicationStatus === "client_agreed" ||
                                  selectedApp.applicationStatus === "worker_agreed"
                                  ? "text-yellow-600"
                                  : "text-gray-600"
                            }`}
                        >
                          {selectedApp.applicationStatus === "in_discussion"
                            ? "In Discussion"
                            : selectedApp.applicationStatus === "client_agreed"
                              ? "Client Agreed"
                              : selectedApp.applicationStatus === "worker_agreed"
                                ? "Worker Agreed"
                                : selectedApp.applicationStatus === "both_agreed"
                                  ? "Both Agreed"
                                  : selectedApp.applicationStatus}
                        </span>
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Details Box */}
            <div className="text-start py-4 shadow-sm rounded-md mb-4 px-2 space-y-3">
              <p className="text-gray-700 flex items-start gap-2 text-sm sm:text-base">
                <FileText className="w-5 h-5 text-gray-400 mt-0.5" />
                <span>{selectedApp.message || "No message"}</span>
              </p>

              <p className="text-gray-700 flex items-center gap-2 text-sm sm:text-base">
                <Briefcase className="w-5 h-5 text-gray-400" />
                <span>₱{selectedApp.proposedRate}</span>
              </p>

              {selectedApp.estimatedDuration && (
                <p className="text-gray-700 flex items-center gap-2 text-sm sm:text-base">
                  <Clock className="w-5 h-5 text-gray-400" />
                  <span>
                    {selectedApp.estimatedDuration?.value}{" "}
                    {selectedApp.estimatedDuration?.unit}
                  </span>
                </p>
              )}
            </div>

            {/* Applied Date */}
            <p className="text-gray-500 text-xs sm:text-sm mb-4 text-start">
              <Clock className="w-3 h-3 inline mr-1" />
              Applied at:{" "}
              {selectedApp.appliedAt
                ? new Date(selectedApp.appliedAt).toLocaleString()
                : "N/A"}
            </p>

            {/* Client actions */}
            {userType === "client" &&
              selectedApp.applicationStatus === "pending" && (
                <div className="flex flex-col sm:flex-row gap-2 mt-3 justify-end">
                  <button
                    onClick={() => handleResponse(selectedApp._id, "accept")}
                    className="flex items-center gap-1 bg-green-500 text-white px-3 py-2 rounded-lg hover:bg-green-600 cursor-pointer text-sm"
                  >
                    <CheckCircle className="w-4 h-4" /> Accept Directly
                  </button>
                  <button
                    onClick={() => handleStartDiscussion(selectedApp._id)}
                    className="flex items-center gap-1 bg-blue-500 text-white px-3 py-2 rounded-lg hover:bg-blue-600 cursor-pointer text-sm"
                  >
                    <MessageCircle className="w-4 h-4" /> Start Discussion
                  </button>
                  {/* <button
                    onClick={openChatForCurrentApplication}
                    className="flex items-center gap-1 bg-indigo-500 text-white px-3 py-2 rounded-lg hover:bg-indigo-600 cursor-pointer text-sm"
                  >
                    <MessageCircle className="w-4 h-4" /> Message
                  </button> */}
                  <button
                    onClick={() => handleResponse(selectedApp._id, "reject")}
                    className="flex items-center gap-1 bg-red-500 text-white px-3 py-2 rounded-lg hover:bg-red-600 cursor-pointer text-sm"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                </div>
              )}

            {/* Discussion phase actions */}
            {selectedApp.applicationStatus === "in_discussion" && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-5 h-5 text-blue-600" />
                  <h3 className="font-semibold text-blue-800">
                    Discussion Phase
                  </h3>
                </div>
                <p className="text-sm text-blue-700 mb-3">
                  You can now message each other to discuss the project details
                  and validate if this is legitimate.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => handleAgreement(selectedApp._id, true)}
                    className="flex items-center gap-1 bg-green-500 text-white px-3 py-2 rounded-lg hover:bg-green-600 cursor-pointer text-sm"
                  >
                    <ThumbsUp className="w-4 h-4" /> I Agree to Proceed
                  </button>
                  <button
                    onClick={() => handleAgreement(selectedApp._id, false)}
                    className="flex items-center gap-1 bg-gray-500 text-white px-3 py-2 rounded-lg hover:bg-gray-600 cursor-pointer text-sm"
                  >
                    <ThumbsDown className="w-4 h-4" /> I Don't Agree
                  </button>
                  <button
                    onClick={openChatForCurrentApplication}
                    className="flex items-center gap-1 bg-indigo-500 text-white px-3 py-2 rounded-lg hover:bg-indigo-600 cursor-pointer text-sm"
                  >
                    <MessageCircle className="w-4 h-4" /> Message
                  </button>
                </div>
              </div>
            )}

            {/* Agreement status display */}
            {(selectedApp.applicationStatus === "client_agreed" ||
              selectedApp.applicationStatus === "worker_agreed") && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-5 h-5 text-yellow-600" />
                    <h3 className="font-semibold text-yellow-800">
                      Waiting for Agreement
                    </h3>
                  </div>
                  <p className="text-sm text-yellow-700 mb-3">
                    {selectedApp.applicationStatus === "client_agreed"
                      ? "Client has agreed. Waiting for worker to agree."
                      : "Worker has agreed. Waiting for client to agree."}
                  </p>
                  {((userType === "client" &&
                    selectedApp.applicationStatus === "worker_agreed") ||
                    (userType === "worker" &&
                      selectedApp.applicationStatus === "client_agreed")) && (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          onClick={() => handleAgreement(selectedApp._id, true)}
                          className="flex items-center gap-1 bg-green-500 text-white px-3 py-2 rounded-lg hover:bg-green-600 cursor-pointer text-sm"
                        >
                          <ThumbsUp className="w-4 h-4" /> I Agree Too!
                        </button>
                        <button
                          onClick={() => handleAgreement(selectedApp._id, false)}
                          className="flex items-center gap-1 bg-gray-500 text-white px-3 py-2 rounded-lg hover:bg-gray-600 cursor-pointer text-sm"
                        >
                          <ThumbsDown className="w-4 h-4" /> I Don't Agree
                        </button>
                      </div>
                    )}
                </div>
              )}

            {/* Success state */}
            {selectedApp.applicationStatus === "accepted" && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <h3 className="font-semibold text-green-800">
                    Contract Created!
                  </h3>
                </div>
                <p className="text-sm text-green-700 mt-1">
                  Both parties have agreed. A work contract has been created and
                  the work can begin.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal for Invitation Details */}
      {selectedInvitation && (
        <div className="fixed inset-0 bg-[#f4f6f6] bg-opacity-40 flex items-center justify-center z-[2000] px-3">
          <div className="bg-white rounded-2xl shadow-lg p-5 sm:p-6 w-full max-w-md sm:max-w-lg relative">
            <button
              onClick={() => setSelectedInvitation(null)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-lg sm:text-xl font-bold text-gray-800 mb-4">
              Invitation Details
            </h2>

            {/* Invitation Details Card */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 sm:p-6">
              {/* User Info */}
              <div className="flex items-center gap-4 mb-6 pb-4 border-b border-gray-100">
                {(() => {
                  const isWorker = userType === "worker";
                  const person = isWorker ? selectedInvitation?.clientId : selectedInvitation?.workerId;
                  const pid = person?._id || person?.id || null;
                  const routeBase = isWorker ? "/client" : "/worker";
                  const canClick = Boolean(pid);
                  const avatarSrc =
                    (isWorker
                      ? selectedInvitation.clientId?.profilePicture?.url
                      : selectedInvitation.workerId?.profilePicture?.url) ||
                    "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png";
                  const fullName = `${person?.firstName || ""} ${person?.lastName || ""}`.trim();
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => canClick && navigate(`${routeBase}/${pid}`)}
                        disabled={!canClick}
                        className={`${canClick ? "cursor-pointer hover:opacity-90" : "cursor-default opacity-60"}`}
                        aria-label={`View ${isWorker ? "client" : "worker"} profile`}
                        title="View profile"
                      >
                        <img
                          src={avatarSrc}
                          alt="Profile"
                          className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover border border-gray-300 shadow-sm"
                        />
                      </button>
                      <div>
                        <button
                          type="button"
                          onClick={() => canClick && navigate(`${routeBase}/${pid}`)}
                          disabled={!canClick}
                          className={`font-semibold text-gray-800 text-base sm:text-lg text-left ${canClick ? "hover:underline" : "opacity-60"}`}
                          title="View profile"
                        >
                          {fullName || (isWorker ? "Client" : "Worker")}
                        </button>
                        <p className="text-xs sm:text-sm text-gray-500 mt-0.5 flex items-center">
                          {isWorker ? "Client" : "Worker"}
                        </p>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Job Info */}
              <div className="mb-5">
                <h4 className="text-sm font-medium text-gray-700 mb-1 text-left">
                  Job Description
                </h4>
                <div className="p-3 bg-gray-50 border border-gray-100 rounded-lg text-xs sm:text-sm text-gray-600 shadow-inner text-left">
                  {selectedInvitation.jobId?.description ||
                    "No job description available."}
                </div>
              </div>

              {/* Proposed Rate */}
              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-1 text-left">
                  Proposed Rate
                </h4>
                <p className="text-xl font-semibold text-green-600 tracking-wide text-left">
                  ₱{selectedInvitation.proposedRate || "0"}
                </p>
              </div>
            </div>

            {/* Invitation Description */}
            <div className="mb-4 px-4 mt-4">
              <h4 className="font-medium text-gray-800 text-sm mb-1 text-left">
                Message:
              </h4>
              <p className="text-xs sm:text-sm text-gray-600 bg-gray-50 p-3 rounded-lg text-left">
                {selectedInvitation.description || "No message provided"}
              </p>
            </div>

            {/* Status */}
            <div className="mb-6 px-4">
              <h4 className="font-medium text-gray-800 text-sm mb-1 text-left">
                Status:
              </h4>
              <div className="flex justify-start">
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${selectedInvitation.invitationStatus === "pending"
                    ? "bg-yellow-100 text-yellow-800"
                    : selectedInvitation.invitationStatus === "accepted" ||
                      selectedInvitation.invitationStatus === "both_agreed"
                      ? "bg-green-100 text-green-800"
                      : selectedInvitation.invitationStatus === "rejected"
                        ? "bg-red-100 text-red-800"
                        : selectedInvitation.invitationStatus ===
                          "in_discussion" ||
                          selectedInvitation.invitationStatus ===
                          "client_agreed" ||
                          selectedInvitation.invitationStatus === "worker_agreed"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-gray-100 text-gray-800"
                    }`}
                >
                  {selectedInvitation.invitationStatus === "pending"
                    ? "Pending"
                    : selectedInvitation.invitationStatus === "in_discussion"
                      ? "In Discussion"
                      : selectedInvitation.invitationStatus === "client_agreed"
                        ? "Client Agreed"
                        : selectedInvitation.invitationStatus === "worker_agreed"
                          ? "Worker Agreed"
                          : selectedInvitation.invitationStatus === "both_agreed"
                            ? "Both Agreed"
                            : selectedInvitation.invitationStatus === "accepted"
                              ? "Accepted"
                              : selectedInvitation.invitationStatus === "rejected"
                                ? "Rejected"
                                : selectedInvitation.invitationStatus}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            {userType === "worker" &&
              selectedInvitation.invitationStatus === "pending" && (
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
                  <button
                    onClick={() =>
                      handleInvitationResponse(selectedInvitation._id, "accept")
                    }
                    className="flex-1 bg-[#55b3f3] text-white px-4 py-2 rounded-lg hover:bg-sky-500 transition-colors font-medium text-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Accept
                  </button>
                  <button
                    onClick={() =>
                      handleStartInvitationDiscussion(selectedInvitation._id)
                    }
                    className="flex-1 bg-[#55b3f3] text-white px-4 py-2 rounded-lg hover:bg-sky-500 transition-colors font-medium text-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <MessageCircle className="w-4 h-4" />
                    Discuss
                  </button>
                  <button
                    onClick={openChatForCurrentInvitation}
                    className="flex-1 bg-indigo-500 text-white px-4 py-2 rounded-lg hover:bg-indigo-600 transition-colors font-medium text-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <MessageCircle className="w-4 h-4" />
                    Message
                  </button>
                  <button
                    onClick={() =>
                      handleInvitationResponse(selectedInvitation._id, "reject")
                    }
                    className="flex-1 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors font-medium text-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </button>
                </div>
              )}

            {/* Client can still message while pending */}
            {userType === "client" &&
              selectedInvitation.invitationStatus === "pending" && (
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
                  <button
                    onClick={openChatForCurrentInvitation}
                    className="flex-1 bg-indigo-500 text-white px-4 py-2 rounded-lg hover:bg-indigo-600 transition-colors font-medium text-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <MessageCircle className="w-4 h-4" />
                    Message
                  </button>
                </div>
              )}

            {/* Role-specific agreement buttons during discussion */}

            {/* Agreement Status Messages */}
            {(selectedInvitation.invitationStatus === "client_agreed" ||
              selectedInvitation.invitationStatus === "worker_agreed") && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <p className="text-blue-800 text-sm font-medium">
                    {selectedInvitation.invitationStatus === "client_agreed"
                      ? "Client has agreed. Waiting for worker to agree."
                      : "Worker has agreed. Waiting for client to agree."}
                  </p>
                </div>
              )}

            {/* Client Agreement Buttons */}
            {userType === "client" &&
              (selectedInvitation.invitationStatus === "in_discussion" ||
                selectedInvitation.invitationStatus === "worker_agreed") && (
                <div className="mb-4">
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <button
                      onClick={() =>
                        handleInvitationAgreement(selectedInvitation._id, true)
                      }
                      className="flex-1 bg-[#55b3f3] text-white px-4 py-2 rounded-lg hover:bg-sky-500 transition-colors font-medium text-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ThumbsUp className="w-4 h-4" />
                      Agree to Terms
                    </button>
                    <button
                      onClick={() =>
                        handleInvitationAgreement(selectedInvitation._id, false)
                      }
                      className="flex-1 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors font-medium text-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ThumbsDown className="w-4 h-4" />
                      Decline Terms
                    </button>
                    <button
                      onClick={openChatForCurrentInvitation}
                      className="flex-1 bg-indigo-500 text-white px-4 py-2 rounded-lg hover:bg-indigo-600 transition-colors font-medium text-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Message
                    </button>
                  </div>
                </div>
              )}

            {/* Worker Agreement Buttons */}
            {userType === "worker" &&
              (selectedInvitation.invitationStatus === "in_discussion" ||
                selectedInvitation.invitationStatus === "client_agreed") && (
                <div className="mb-4">
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <button
                      onClick={() =>
                        handleInvitationAgreement(selectedInvitation._id, true)
                      }
                      className="flex-1 bg-[#55b3f3] text-white px-4 py-2 rounded-lg hover:bg-sky-500 transition-colors font-medium text-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ThumbsUp className="w-4 h-4" />
                      Agree to Terms
                    </button>
                    <button
                      onClick={() =>
                        handleInvitationAgreement(selectedInvitation._id, false)
                      }
                      className="flex-1 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors font-medium text-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ThumbsDown className="w-4 h-4" />
                      Decline Terms
                    </button>
                    <button
                      onClick={openChatForCurrentInvitation}
                      className="flex-1 bg-indigo-500 text-white px-4 py-2 rounded-lg hover:bg-indigo-600 transition-colors font-medium text-xs flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Message
                    </button>
                  </div>
                </div>
              )}

            {/* Status Messages */}
            {(selectedInvitation.invitationStatus === "accepted" ||
              selectedInvitation.invitationStatus === "both_agreed") && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                  <p className="text-green-800 text-sm font-medium">
                    {" "}
                    {selectedInvitation.invitationStatus === "both_agreed"
                      ? "Both parties agreed! Work contract has been created."
                      : "Invitation accepted! Work can now begin."}
                  </p>
                </div>
              )}

            {selectedInvitation.invitationStatus === "rejected" && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-red-800 text-sm font-medium">
                  Invitation was rejected.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notice Modal */}
      {notice?.open && (
        <div className="fixed inset-0 bg-[#f4f6f6] bg-opacity-40 flex items-center justify-center z-[2000] px-3">
          <div className="bg-white rounded-2xl shadow-lg p-5 sm:p-6 w-full max-w-sm relative">
            <button
              onClick={() => setNotice({ open: false, title: "", message: "", variant: "info" })}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-3">
              {notice.variant === "success" && (
                <CheckCircle className="w-5 h-5 text-green-600" />
              )}
              {notice.variant === "error" && (
                <XCircle className="w-5 h-5 text-red-600" />
              )}
              {notice.variant === "info" && (
                <MessageCircle className="w-5 h-5 text-blue-600" />
              )}
              <h3 className="text-base sm:text-lg font-semibold text-gray-800">
                {notice.title || "Notice"}
              </h3>
            </div>
            <p className="text-sm text-gray-700 mb-4 whitespace-pre-line">
              {notice.message}
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setNotice({ open: false, title: "", message: "", variant: "info" })}
                className="bg-[#55b3f3] text-white px-4 py-2 rounded-lg hover:bg-sky-500 transition-colors font-medium text-sm cursor-pointer"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApplicationsPage;
