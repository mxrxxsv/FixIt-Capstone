import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Upload, CheckCircle, AlertCircle, Info, Loader2, Clock } from "lucide-react";
import {
  uploadIDPicture,
  uploadSelfie,
  getVerificationStatus,
} from "../api/idVerification";
import { getProfile } from "../api/profile";

const STATUS_CONTENT = {
  not_submitted: {
    icon: AlertCircle,
    label: "Not Submitted",
    textClass: "text-amber-600",
    helperClient:
      "Upload a valid ID and selfie so workers can trust your job posts.",
    helperWorker:
      "Upload your ID and selfie to unlock the rest of the platform.",
  },
  pending: {
    icon: Clock,
    label: "Under Review",
    textClass: "text-blue-600",
    helper:
      "We’re reviewing your documents. This usually takes 24–48 hours.",
  },
  approved: {
    icon: CheckCircle,
    label: "Verified",
    textClass: "text-green-600",
    helperClient:
      "You’re fully verified. Workers can see the verified badge on your profile.",
    helperWorker:
      "You’re verified. Clients will now see your trusted badge.",
  },
  rejected: {
    icon: AlertCircle,
    label: "Needs Attention",
    textClass: "text-red-600",
    helper:
      "Please re-submit clearer photos of your government ID and selfie.",
  },
};

const IDSetup = ({ onClose, onStatusChange }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [idFile, setIdFile] = useState(null);
  const [selfieFile, setSelfieFile] = useState(null);
  const [idPreview, setIdPreview] = useState(null);
  const [selfiePreview, setSelfiePreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [idLoading, setIdLoading] = useState(false);
  const [selfieLoading, setSelfieLoading] = useState(false);
  const isClient = currentUser?.userType === "client";

  const statusKey = status?.verificationStatus || "not_submitted";
  const statusInfo = STATUS_CONTENT[statusKey] || STATUS_CONTENT.not_submitted;
  const StatusIcon = statusInfo.icon || AlertCircle;
  const statusLabel = status?.verificationStatusText || statusInfo.label;
  const statusTextClass = statusInfo.textClass || "text-gray-600";
  const statusHelper =
    (isClient ? statusInfo.helperClient : statusInfo.helperWorker) ||
    statusInfo.helper ||
    "";
  const hasIdOnFile = Boolean(status?.hasIdPicture);
  const hasSelfieOnFile = Boolean(status?.hasSelfie);
  const idButtonLabel = hasIdOnFile ? "Replace ID" : "Upload ID";
  const selfieButtonLabel = hasSelfieOnFile ? "Replace Selfie" : "Upload Selfie";
  const idButtonDisabled = !idFile || idLoading;
  const selfieButtonDisabled = !selfieFile || selfieLoading;

  // Camera state for selfie capture
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const selfieInputRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");

  useEffect(() => {
    getProfile()
      .then((res) => {
        setCurrentUser(res.data.data);
      })
      .catch(() => setCurrentUser(null));
  }, []);

  const refreshStatus = async (userId) => {
    if (!userId) return;
    try {
      const res = await getVerificationStatus(userId);
      const normalized = res.data || res;
      setStatus(normalized);
      onStatusChange?.(normalized);
    } catch (err) {
      console.error("Failed to fetch verification status:", err);
    }
  };

  useEffect(() => {
    if (!currentUser?.id) return;
    refreshStatus(currentUser.id);
  }, [currentUser]);

  const handleFileSelect = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (type === "id") {
        setIdFile(file);
        setIdPreview(reader.result);
      } else {
        setSelfieFile(file);
        setSelfiePreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const startCamera = async () => {
    try {
      setCameraError("");

      // Secure context is required except on localhost
      if (!window.isSecureContext) {
        setCameraError(
          "Camera requires a secure context. Open the app on https:// or use http://localhost during development."
        );
        setCameraActive(false);
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          "Your browser doesn't support camera access. Try the latest Chrome/Edge/Safari or upload a photo instead."
        );
        setCameraActive(false);
        return;
      }

      const constraints = {
        video: { facingMode: { ideal: "user" } },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      console.error("Unable to access camera:", err);
      const name = err?.name || "";
      let msg = "Unable to access camera. Please allow camera permission.";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        msg =
          "Camera permission was blocked. Click the lock icon in your browser's address bar and allow Camera access for this site, then retry.";
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        msg = "No camera device found. Connect a camera or upload a selfie instead.";
      } else if (name === "NotReadableError") {
        msg = "Camera is in use by another app. Close other apps using the camera and try again.";
      } else if (name === "OverconstrainedError") {
        msg = "This device can't satisfy the requested camera settings. Try again or upload a selfie.";
      } else if (name === "SecurityError") {
        msg = "Camera access is blocked by your browser or OS security settings. Allow access and retry.";
      }
      setCameraError(msg);
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const captureSelfie = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        // Store as File so backend receives filename/type
        const file = new File([blob], "selfie.jpg", { type: "image/jpeg" });
        setSelfieFile(file);
        // Revoke previous preview if any
        if (selfiePreview) URL.revokeObjectURL(selfiePreview);
        setSelfiePreview(url);
        stopCamera();
      },
      "image/jpeg",
      0.9
    );
  };

  const handleSelfieFilePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (selfiePreview) URL.revokeObjectURL(selfiePreview);
    } catch {}
    const url = URL.createObjectURL(file);
    setSelfieFile(file);
    setSelfiePreview(url);
    setCameraError("");
    setCameraActive(false);
  };

  // Cleanup object URLs and stop camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      if (selfiePreview) URL.revokeObjectURL(selfiePreview);
      if (idPreview) URL.revokeObjectURL(idPreview);
    };
  }, [selfiePreview, idPreview]);

  const handleUpload = async (type) => {
    const userId = currentUser?.id;
    if (!userId) {
      return;
    }

    try {
      if (type === "id" && idFile) {
        setIdLoading(true);
        await uploadIDPicture(userId, idFile);
      } else if (type === "selfie" && selfieFile) {
        setSelfieLoading(true);
        await uploadSelfie(userId, selfieFile);
      }

      await refreshStatus(userId);
    } catch (err) {
  console.error("Upload failed:", err.response?.data || err.message);
    } finally {
      setIdLoading(false);
      setSelfieLoading(false);
    }
  };


  return createPortal(
    <div className="fixed inset-0 bg-white/20 backdrop-blur-md bg-opacity-50 flex items-center justify-center z-[2000]" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-lg relative max-h-[90vh] overflow-y-auto p-6 mx-4">

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 cursor-pointer"
        >
          <X size={20} />
        </button>

        {/* Title */}
        <h2 className="text-2xl font-bold text-center text-gray-800 mb-2">
          Verify Your Identity
        </h2>
        <p className="text-sm text-gray-500 text-center mb-6">
          {isClient
            ? "Upload a valid ID and selfie so workers can see you’re a verified client."
            : "To secure your account and unlock all features, please upload a valid ID and a selfie."}
        </p>
        {isClient && statusKey === "approved" && (
          <p className="text-xs text-green-600 text-center -mt-4 mb-4">
            You’re already verified. You can resubmit documents anytime if you need to update them.
          </p>
        )}

        {/* Status */}
        <div className="mb-6 text-center">
          <p
            className={`${statusTextClass} flex items-center justify-center gap-2 text-sm font-semibold`}
          >
            <StatusIcon size={18} /> {statusLabel}
          </p>
          {statusHelper && (
            <p className="text-xs text-gray-500 mt-1">{statusHelper}</p>
          )}
        </div>

        {/* ID Upload */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Step 1: Government-issued ID
          </label>
          <label className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition cursor-pointer">
            {idPreview ? (
              <img src={idPreview} alt="ID Preview" className="h-40 object-contain rounded-lg" />
            ) : (
              <>
                <Upload className="w-8 h-8 text-gray-500 mb-2" />
                <p className="text-sm text-gray-500">Click to upload ID</p>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleFileSelect(e, "id")}
              className="hidden"
            />
          </label>
          <button
            onClick={() => handleUpload("id")}
            disabled={idButtonDisabled}
            className="mt-3 w-full px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {idLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload size={16} />}
            {idButtonLabel}
          </button>

        </div>

        {/* Selfie Capture (Camera only, no file upload) */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Step 2: Take or Upload Selfie
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-full w-40 h-40 mx-auto flex items-center justify-center bg-gray-50 overflow-hidden relative">
            {cameraActive ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="object-cover w-full h-full"
              />
            ) : selfiePreview ? (
              <img src={selfiePreview} alt="Selfie Preview" className="object-cover w-full h-full" />
            ) : (
              <div className="flex flex-col items-center justify-center text-center">
                <Upload className="w-6 h-6 text-gray-500 mb-2" />
                <p className="text-xs text-gray-500">Take a selfie or for testing (upload from device)</p>
              </div>
            )}
          </div>
          {cameraError && (
            <p className="text-red-500 text-xs text-center mt-2">{cameraError}</p>
          )}
          <div className="mt-3 flex items-center justify-center gap-2">
            {!cameraActive && !selfiePreview && (
              <button
                type="button"
                onClick={startCamera}
                className="px-4 py-2 bg-[#55b3f3] text-white text-sm rounded-md hover:bg-sky-600 cursor-pointer"
              >
                Open Camera
              </button>
            )}
            {cameraActive && (
              <>
                <button
                  type="button"
                  onClick={captureSelfie}
                  className="px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 cursor-pointer"
                >
                  Take Selfie
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300 cursor-pointer"
                >
                  Cancel
                </button>
              </>
            )}
            {!cameraActive && selfiePreview && (
              <button
                type="button"
                onClick={() => {
                  if (selfiePreview) URL.revokeObjectURL(selfiePreview);
                  setSelfiePreview(null);
                  setSelfieFile(null);
                  startCamera();
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300 cursor-pointer"
              >
                Retake
              </button>
            )}
            {!cameraActive && (
              <button
                type="button"
                onClick={() => selfieInputRef.current?.click()}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50 cursor-pointer"
              >
                Upload from device
              </button>
            )}
          </div>
          {/* Hidden file input for selfie fallback */}
          <input
            ref={selfieInputRef}
            type="file"
            accept="image/*"
            capture="user"
            onChange={handleSelfieFilePick}
            className="hidden"
          />
          <button
            onClick={() => handleUpload("selfie")}
            disabled={selfieButtonDisabled}
            className="mt-3 w-full px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {selfieLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload size={16} />}
            {selfieButtonLabel}
          </button>
        </div>

        {/* Notes */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-gray-700 flex gap-2">
          <Info className="text-blue-500 w-5 h-5 mt-0.5" />
          <ul className="list-disc pl-4 space-y-1 mt-4 text-left">
            <li>Use a valid government-issued ID (e.g., Passport, Driver’s License, UMID).</li>
            <li>Ensure the details are clear and not blurry.</li>
            <li>Selfie must clearly show your face with good lighting.</li>
            <li>Verification usually takes 24–48 hours.</li>
          </ul>
        </div>

      </div>
    </div>,
    document.body
  );
};

export default IDSetup;
