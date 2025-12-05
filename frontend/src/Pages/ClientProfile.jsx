import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getAllJobs, getJobById } from "../api/jobs";
import { getClientReviewsById } from "../api/feedback";
import {
  MapPin,
  Star,
  Briefcase,
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

const PLACEHOLDER =
  "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png";

const Avatar = ({ url, size = 64, alt = "Client" }) => (
  <img
    src={url || PLACEHOLDER}
    alt={alt}
    className="rounded-full object-cover"
    style={{ width: size, height: size }}
    onError={(e) => (e.currentTarget.src = PLACEHOLDER)}
  />
);

const Stars = ({ value = 0 }) => {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <div className="flex items-center gap-0.5">
      {[...Array(5)].map((_, i) => {
        const filled = i < full || (i === full && half);
        return (
          <Star
            key={i}
            size={16}
            className={filled ? "text-yellow-400 fill-yellow-400" : "text-gray-300"}
          />
        );
      })}
      <span className="ml-1 text-sm text-gray-600">{value ? value.toFixed(1) : "0.0"}</span>
    </div>
  );
};

// Text-based star renderer to match Worker reviews UI
const renderStars = (rating) => {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  return "⭐️".repeat(r) + "☆".repeat(5 - r);
};

const deriveClientVerification = (...sources) => {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    const hasDocs =
      source.hasIdDocuments ??
      Boolean(source.idPictureId && source.selfiePictureId);

    const rawStatus = source.verificationStatus || source.verified || "";
    const status = String(rawStatus).toLowerCase();

    const flag = Boolean(
      source.isVerified ?? source.profile?.isVerified ?? false
    );

    if (hasDocs && (flag || status === "approved" || status === "verified")) {
      return true;
    }
  }

  return false;
};

export default function ClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState(null);
  const [clientInfo, setClientInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [jobMap, setJobMap] = useState({});

  // Status color mapping similar to profile job post styling
  const getStatusStyle = (status) => {
    const s = String(status || "").toLowerCase();
    const map = {
      open: "bg-green-100 text-green-600",
      active: "bg-blue-100 text-blue-700",
      in_progress: "bg-blue-100 text-blue-700",
      completed: "bg-gray-200 text-gray-600",
      cancelled: "bg-red-100 text-red-600",
      disputed: "bg-purple-100 text-purple-700",
    };
    return map[s] || "bg-gray-100 text-gray-700";
  };

  const hasMore = useMemo(() => {
    return !!stats && !!stats.pagination && page < stats.pagination.totalPages;
  }, [stats, page]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        // Fetch client's jobs (first page is enough for identity info & list)
        const jobsRes = await getAllJobs({ page: 1, limit: 10, clientId: id, _t: Date.now() });
        // Backend getAllJobs ignores clientId; filter client-side to only include this client's jobs
        const allJobs = jobsRes?.data?.data?.jobs || [];
        let jobsArr = allJobs.filter((j) => String(j?.client?.id || "") === String(id));
        setJobs(jobsArr);

        // Fetch client reviews with stats (1st page)
        const reviewsRes = await getClientReviewsById(id, { page: 1, limit: 10 });
        const d = reviewsRes?.data || {};
        setReviews(Array.isArray(d.reviews) ? d.reviews : []);
        setStats({
          statistics: d.statistics,
          pagination: d.pagination,
          client: d.client,
        });

        // Build client info strictly from this client's job payload (fallback to reviews stats only for ratings)
        const firstJob = jobsArr && jobsArr[0];
        const statsClient = d.client;
        const rawPic =
          firstJob?.client?.profilePicture ||
          statsClient?.profilePicture ||
          statsClient?.image;
        const clientPic =
          rawPic?.url || (typeof rawPic === "string" ? rawPic : null);
        const clientName =
          firstJob?.client?.name ||
          statsClient?.name ||
          `${statsClient?.firstName || ""} ${statsClient?.lastName || ""}`.trim() ||
          "Client";
        const resolvedVerificationStatus =
          firstJob?.client?.verificationStatus ||
          statsClient?.verificationStatus ||
          null;
        const isVerifiedFlag = deriveClientVerification(
          firstJob?.client,
          statsClient
        );
        setClientInfo({
          name: clientName,
          avatar: clientPic,
          isVerified: isVerifiedFlag,
          verificationStatus: resolvedVerificationStatus,
        });
      } catch (e) {
        console.error("Failed to load client profile:", e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  // Enrich missing job details for each review's job header (frontend-only; cached by jobMap)
  useEffect(() => {
    const list = reviews || [];
    if (!list.length) return;

    const idsToFetch = new Set();
    for (const r of list) {
      const j = r.jobId || r.job;
      if (!j) continue;
      if (typeof j === "string") {
        if (!jobMap[j]) idsToFetch.add(j);
      } else if (j && typeof j === "object") {
        const jid = j._id || j.id;
        const missingFields = !(j.price && j.location && j.category && j.client);
        if (jid && missingFields && !jobMap[jid]) idsToFetch.add(jid);
      }
    }

    const fetchIds = Array.from(idsToFetch);
    if (!fetchIds.length) return;

    let cancelled = false;
    const run = async () => {
      const entries = await Promise.all(
        fetchIds.map(async (jid) => {
          try {
            const resp = await getJobById(jid);
            const payload = resp?.data || resp;
            const jobData = payload?.data?.job || payload?.data || payload?.job || payload;
            return [jid, jobData];
          } catch (err) {
            return [jid, null];
          }
        })
      );
      if (cancelled) return;
      setJobMap((prev) => {
        const next = { ...prev };
        for (const [jid, jdata] of entries) {
          if (jdata) next[jid] = jdata;
        }
        return next;
      });
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [reviews, jobMap]);

  const loadMoreReviews = async () => {
    try {
      const next = page + 1;
      const res = await getClientReviewsById(id, { page: next, limit: 10 });
      const d = res?.data || {};
      setReviews((prev) => [...prev, ...(Array.isArray(d.reviews) ? d.reviews : [])]);
      setStats((prev) => ({
        ...(prev || {}),
        statistics: d.statistics,
        pagination: d.pagination,
        client: d.client,
      }));
      setPage(next);
    } catch (e) {
      console.error("Load more reviews failed:", e);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-4 md:p-0 mt-20">
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-gray-100 rounded-xl" />
          <div className="h-40 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  const avg = stats?.statistics?.averageRating || 0;
  const total = stats?.statistics?.totalReviews || 0;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-0 mt-35">
      <div className="mb-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center text-[#55b3f3] hover:text-blue-300 font-medium cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 mr-1" />
        </button>
      </div>
      {/* Header */}
      <div className="bg-white shadow rounded-2xl p-4 mb-6">
        <div className="flex items-center text-left gap-4">
          <Avatar url={clientInfo?.avatar} size={72} alt={clientInfo?.name} />
          <div>
            <div className="text-xl font-semibold text-[#252525]">{clientInfo?.name || "Client"}</div>
            <div className="flex items-center gap-3 mt-1">
              <Stars value={avg} />
              <span className="text-sm text-gray-600">{total} review{total === 1 ? "" : "s"}</span>
            </div>
            {clientInfo && (
              <div className="flex flex-col items-start gap-1">
                <div
                  className={`inline-flex items-center gap-1 text-xs font-medium px-3 py-1 rounded-full ${
                    clientInfo.isVerified
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {clientInfo.isVerified ? (
                    <ShieldCheck size={14} />
                  ) : (
                    <ShieldAlert size={14} />
                  )}
                  {clientInfo.isVerified ? "Verified Client" : "Not Verified"}
                </div>
                {clientInfo.verificationStatus && (
                  <span className="text-xs text-gray-500 capitalize">
                    Status: {String(clientInfo.verificationStatus).replace(/_/g, " ")}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Jobs by this client */}
      <div className="bg-white shadow rounded-2xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-[#252525]">Jobs by this client</h2>
          <span className="text-sm text-gray-500">{jobs.length} result{jobs.length === 1 ? "" : "s"}</span>
        </div>
        <div className="space-y-4">
          {jobs.length === 0 && (
            <div className="text-sm text-gray-500">No recent jobs posted.</div>
          )}
          {jobs.map((job) => (
            <div
              key={job.id || job._id}
              className="rounded-[20px] p-4 bg-white shadow-sm hover:shadow-lg transition-all block cursor-pointer"
              onClick={() => navigate(`/job/${job.id || job._id}`)}
            >
              <div className="rounded-xl p-2 bg-white transition-all">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <img
                      src={clientInfo?.avatar || "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png"}
                      alt="Client Avatar"
                      className="w-8 h-8 rounded-full object-cover"
                    />
                    <div className="flex flex-col">
                      <span className="text-md font-bold text-[#252525]">
                        {job.client?.name || "Client Name"}
                      </span>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-sm font-medium text-[#252525] opacity-80">
                    {new Date(job.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>

                <p className="text-gray-700 mt-1 text-left flex items-center gap-2">
                  <span className="flex items-center justify-center w-5 h-5">
                    <Briefcase size={20} className="text-[#55B2F3]" />
                  </span>
                  <span className="line-clamp-1 md:text-base">{job.description}</span>
                </p>

                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="bg-[#55B2F3]/90 text-white font-medium backdrop-blur-sm px-2 py-1 rounded-md text-sm">
                    {job.category?.name || "Uncategorized"}
                  </span>
                  {job.status && (
                    <span className={`${getStatusStyle(job.status)} px-3 py-1 rounded-full text-sm capitalize`}>
                      {job.status.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center mt-4 text-sm text-gray-600 ">
                  <span className="flex items-center gap-1">
                    <MapPin size={16} />
                    <span className="truncate overflow-hidden max-w-45 md:max-w-full md:text-base text-gray-500">{job.location}</span>
                  </span>
                  <span className="font-bold text-green-400">
                    ₱{(job.price || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reviews */}
      <div className="bg-white shadow rounded-2xl p-4 mb-4">
        <h2 className="text-lg font-semibold mb-3">Client reviews</h2>
        <div className="space-y-3">
          {reviews.length === 0 && (
            <div className="text-sm text-gray-500">No reviews yet.</div>
          )}
          {reviews.map((rev) => {
            const reviewer = rev.reviewerId || {};
            const reviewerName = `${reviewer.firstName || ""} ${reviewer.lastName || ""}`.trim() || "Reviewer";
            const reviewerPic = reviewer.profilePicture?.url || reviewer.profilePicture || PLACEHOLDER;
            const reviewerId = reviewer._id || reviewer.id;
            const baseJob = rev.jobId || rev.job || null;
            const jobId = typeof baseJob === "string" ? baseJob : baseJob?._id || baseJob?.id;
            const job = jobId ? (jobMap[jobId] || baseJob) : baseJob;

            return (
              <div key={rev._id} className="p-3 rounded-xl border border-gray-100">
                {/* Job post header - FindWork-style block above each review */}
                {job && (
                  <div className="w-full mb-3">
                    <div
                      className="rounded-[20px] p-4 bg-white shadow-sm transition-all block cursor-pointer"
                      onClick={() => jobId && navigate(`/job/${jobId}`)}
                      role="button"
                      aria-label="View job details"
                    >
                      <div className="rounded-xl p-2 bg-white transition-all">
                        <div className="flex justify-between items-center mb-2">
                          <div className="flex items-center gap-2">
                            <img
                              src={job.client?.profilePicture?.url || clientInfo?.avatar || PLACEHOLDER}
                              alt="Client Avatar"
                              className="w-8 h-8 rounded-full object-cover"
                              onError={(e) => (e.currentTarget.src = PLACEHOLDER)}
                            />
                            <span className="text-md font-bold text-[#252525]">
                              {job.client?.name || jobs?.[0]?.client?.name || "Client"}
                            </span>
                          </div>
                          <span className="flex items-center gap-1 text-sm font-medium text-[#252525] opacity-80">
                            {rev.reviewDate ? new Date(rev.reviewDate).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            }) : ""}
                          </span>
                        </div>
                        <p className="text-gray-700 mt-1 text-left flex items-center gap-2">
                          <span className="flex items-center justify-center w-5 h-5">
                            <Briefcase size={20} className="text-[#55B2F3]" />
                          </span>
                          <span className="line-clamp-1 md:text-base">{job.description || job.title || "Job post"}</span>
                        </p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          {(job.category?.name || job.category?.categoryName || (typeof job.category === "string" && job.category)) && (
                            <span className="bg-[#55B2F3]/90 text-white font-medium backdrop-blur-sm px-2 py-1 rounded-md text-sm">
                              {job.category?.name || job.category?.categoryName || (typeof job.category === "string" ? job.category : "")}
                            </span>
                          )}
                          {job.status && (
                            <span className={`${getStatusStyle(job.status)} px-3 py-1 rounded-full text-sm capitalize`}>
                              {String(job.status).replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                        <div className="flex justify-between items-center mt-4 text-sm text-gray-600 ">
                          <span className="flex items-center gap-1">
                            <MapPin size={16} />
                            <span className="truncate overflow-hidden max-w-45 md:max-w-full md:text-base text-gray-500">{job.location || ""}</span>
                          </span>
                          <span className="font-bold text-green-400">
                            {(typeof job.price === "number" || typeof job.price === "string") ? `₱${Number(job.price).toLocaleString()}` : ""}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {/* Reviewer block styled like Worker reviews */}
                <div className="p-4 rounded-[10px]">
                  <button
                    type="button"
                    onClick={() => reviewerId && navigate(`/worker/${reviewerId}`)}
                    disabled={!reviewerId}
                    aria-label={`View ${reviewerName} profile`}
                    className={`flex flex-row gap-2 items-center text-left ${reviewerId ? "cursor-pointer hover:opacity-90" : "cursor-default opacity-60"}`}
                  >
                    <img
                      src={reviewerPic}
                      alt={reviewerName}
                      className="w-8 h-8 rounded-full object-cover border"
                      onError={(e) => (e.currentTarget.src = PLACEHOLDER)}
                    />
                    <p className="font-semibold mt-1">{reviewerName}</p>
                  </button>
                  <p className="text-sm text-yellow-500 text-left mt-2">{renderStars(Number(rev.rating) || 0)}</p>
                  {rev.feedback && (
                    <p className="mt-1 text-gray-700 text-left">{rev.feedback}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {hasMore && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={loadMoreReviews}
              className="px-4 py-2 bg-[#55b3f3] text-white rounded-md hover:bg-blue-400 cursor-pointer"
            >
              Load more reviews
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
