import axios from "axios";
import API_CONFIG from "../config/api.js";

const verificationApi = axios.create({
  baseURL: `${API_CONFIG.getApiUrl("verification")}/admin`,
  ...API_CONFIG.axiosConfig,
});

verificationApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const getPendingVerifications = (params = {}) =>
  verificationApi.get("/pending", { params });

export const approveVerification = (userId, requireResubmission = false) =>
  verificationApi.post(`/approve/${userId}`, { requireResubmission });

export const rejectVerification = (
  userId,
  reason,
  requireResubmission = true
) => verificationApi.post(`/reject/${userId}`, { reason, requireResubmission });

export default verificationApi;
