import axios from "axios";
import { baseURL } from "../utils/appMode.js";
const API = axios.create({
  baseURL: baseURL + "/id-verification",
  withCredentials: true,
});

export const uploadIDPicture = async (userId, file) => {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("userId", userId);

  const { data } = await API.post("/upload-id-picture", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return data;
};

export const uploadSelfie = async (userId, file) => {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("userId", userId);

  const { data } = await API.post("/upload-selfie", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return data;
};


export const getVerificationStatus = async (userId) => {
  const endpoint = userId ? `/status/${userId}` : "/status";
  const { data } = await API.get(endpoint);
  return data;
};
