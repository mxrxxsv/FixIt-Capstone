import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  MapPin,
  Briefcase,
  Clock,
  Search,
  X,
  CheckCircle,
  SlidersHorizontal,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getAllJobs, postJob as createJob } from "../api/jobs";
import axios from "axios";
import AddressInput from "../components/AddressInput";
import { getProfile } from "../api/profile";
import PortfolioSetup from "../components/PortfolioSetup";
import IDSetup from "../components/IDSetup";
import VerificationNotice from "../components/VerificationNotice";

const currentUser = {
  avatar:
    "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png",
};

const FindWork = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [location, setLocation] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [jobPosts, setJobPosts] = useState([]);
  const [user, setUser] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [hasMore, setHasMore] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  // Dynamic inner scroll height for job list
  const listRef = useRef(null);
  const [listHeight, setListHeight] = useState(480);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showPortfolioSetup, setShowPortfolioSetup] = useState(false);
  const [portfolioSetupCompleted, setPortfolioSetupCompleted] = useState({
    profilePhoto: false,
    biography: false,
    portfolio: false,
    certificates: false,
    experience: false,
    education: false,
    skills: false,
  });
  const [portfolioSetupInitialStep, setPortfolioSetupInitialStep] = useState(1);

  const [loading, setLoading] = useState(true);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showDesktopFilters, setShowDesktopFilters] = useState(false);
  const desktopFilterContainerRef = useRef(null);

  // Note: removed ratings prefetch to reduce API calls

  const [newJob, setNewJob] = useState({
    description: "",
    location: "",
    priceOffer: "",
  });

  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  // New: filter category for searching jobs
  const [filterCategory, setFilterCategory] = useState("");

  // Sorting states
  const [sortBy, setSortBy] = useState("createdAt");
  const [order, setOrder] = useState("desc");

  // NEW: Draft and confirm modal state
  const [draft, setDraft] = useState(null);
  const [showDraftConfirm, setShowDraftConfirm] = useState(false);

  const [showIdSetup, setShowIdSetup] = useState(false);

  // NEW: UI-styled feedback modal (matches WorkerPortfolio)
  const [feedback, setFeedback] = useState({ show: false, message: "" });

  const requiresClientVerification =
    user?.userType === "client" && !user?.isVerified;

  const handleIdStatusChange = (nextStatus) => {
    if (!nextStatus) {
      return;
    }

    setUser((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        isVerified:
          typeof nextStatus.isVerified === "boolean"
            ? nextStatus.isVerified
            : prev.isVerified,
        idPictureId:
          nextStatus.documents?.idPicture?.id || prev.idPictureId || null,
        selfiePictureId:
          nextStatus.documents?.selfie?.id || prev.selfiePictureId || null,
      };
    });

    if (
      nextStatus.isVerified ||
      (nextStatus.hasCompleteVerification && user?.userType === "worker")
    ) {
      setShowIdSetup(false);
    }
  };

  // NEW: Reset form helper
  const resetForm = () => {
    setNewJob({ description: "", location: "", priceOffer: "" });
    setSelectedCategory("");
  };

  // NEW: Handle modal close with draft check
  const handleCloseModal = () => {
    const hasInput =
      newJob.description ||
      newJob.location ||
      newJob.priceOffer ||
      selectedCategory;

    if (hasInput) {
      setShowDraftConfirm(true);
    } else {
      resetForm();
      setIsModalOpen(false);
    }
  };

  // NEW: Save/Discard draft
  const handleSaveDraft = () => {
    setDraft({ ...newJob, category: selectedCategory });
    setShowDraftConfirm(false);
    setIsModalOpen(false);
  };

  const handleDiscardDraft = () => {
    resetForm();
    setDraft(null);
    setShowDraftConfirm(false);
    setIsModalOpen(false);
  };

  // NEW: Load draft when modal opens
  useEffect(() => {
    if (isModalOpen) {
      if (draft) {
        setNewJob({
          description: draft.description,
          location: draft.location,
          priceOffer: draft.priceOffer,
        });
        setSelectedCategory(draft.category);
      } else {
        resetForm();
      }
    }
  }, [isModalOpen]);

  // ================== YOUR EXISTING LOGIC ==================

  // Fetch jobs with pagination and minimal calls
  const fetchJobs = async ({ useCache = true, pageOverride = null } = {}) => {
    try {
      const effectivePage = pageOverride ?? page;
      const isFirstPage = effectivePage === 1;

      if (isFirstPage) {
        setLoading(true);
      } else {
        setIsFetchingMore(true);
      }

      const options = { page: effectivePage, limit };
      if (filterCategory) options.category = filterCategory;
      if (location) options.location = location;
      if (sortBy) options.sortBy = sortBy;
      if (order) options.order = order;
      if (!useCache) options._t = Date.now();
      const response = await getAllJobs(options);
      const jobsArray = Array.isArray(response.data?.data?.jobs)
        ? response.data.data.jobs
        : [];
      setHasMore(jobsArray.length === limit);

      if (isFirstPage) {
        setJobPosts(jobsArray);
      } else {
        setJobPosts((prev) => {
          const seen = new Set(prev.map((j) => String(j.id || j._id || "")));
          const toAdd = jobsArray.filter(
            (j) => !seen.has(String(j.id || j._id || ""))
          );
          return [...prev, ...toAdd];
        });
      }
      setLastRefreshTime(new Date());
    } catch (err) {
      console.error("Error fetching jobs:", err);
    } finally {
      setLoading(false);
      setIsFetchingMore(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchJobs({ useCache: false, pageOverride: 1 });
    } finally {
      setIsRefreshing(false);
    }
  };

  const mode = import.meta.env.VITE_APP_MODE;

  const baseURL =
    mode === "production"
      ? import.meta.env.VITE_API_PROD_URL
      : import.meta.env.VITE_API_DEV_URL;

  // Fetch categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await axios.get(`${baseURL}/skills`);
        const cats = res.data?.data?.categories;
        setCategories(Array.isArray(cats) ? cats : []);
      } catch (err) {
        console.error("Error fetching categories:", err);
      }
    };
    fetchCategories();
  }, []);

  // Initial fetch (page 1 only)
  // Removed duplicate initial fetch to avoid double API calls on mount.

  // Handle Enter key press for search and location (use onKeyDown; onKeyPress is deprecated)
  const handleSearchKeyPress = (e) => {
    if (e.key === "Enter") {
      setSearch(searchInput.trim());
    }
  };

  const handleLocationKeyPress = (e) => {
    if (e.key === "Enter") {
      setLocation(locationInput.trim());
    }
  };

  // Refetch when filters or sorting changes (reset to page 1)
  useEffect(() => {
    setPage(1);
    fetchJobs({ useCache: false, pageOverride: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCategory, location, sortBy, order]);

  // Load more when page increases (>1)
  useEffect(() => {
    if (page > 1) {
      fetchJobs({ useCache: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Compute dynamic height so only the job list scrolls
  useEffect(() => {
    const computeListHeight = () => {
      if (!listRef.current) return;
      const rect = listRef.current.getBoundingClientRect();
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      // 12-16px bottom padding safety
      const h = Math.max(viewportH - rect.top - 16, 200);
      setListHeight(h);
    };
    const rafCompute = () => requestAnimationFrame(computeListHeight);
    // Initial and after layout changes
    rafCompute();
    window.addEventListener("resize", computeListHeight);
    return () => window.removeEventListener("resize", computeListHeight);
  }, [loading, showMobileFilters, showDesktopFilters, user, page, filterCategory, location, sortBy, order]);

  // Handle posting a new job
  const handlePostJob = async (e) => {
    e.preventDefault();

    if (requiresClientVerification) {
      setFeedback({
        show: true,
        message: "Please verify your identity before posting a job.",
      });
      setShowIdSetup(true);
      return;
    }

    // Client-side validation aligned with backend rules (Joi):
    const desc = (newJob.description || '').trim();
    const loc = (newJob.location || '').trim();
    const priceNum = Number(newJob.priceOffer);

    // If any required field is missing, show a generic message (WorkerPortfolio style)
    const missingRequired = !desc || !loc || !selectedCategory || newJob.priceOffer === '' || newJob.priceOffer === null;
    if (missingRequired) {
      setFeedback({ show: true, message: 'Please complete the job details.' });
      return;
    }

    // Additional validations (lengths, numeric constraints). We collect these but show only the first problem.
    const errs = [];
    if (desc.length < 20) errs.push('Description must be at least 20 characters.');
    if (loc.length < 2) errs.push('Location must be at least 2 characters.');
    if (Number.isNaN(priceNum)) errs.push('Price must be a valid number.');
    else if (priceNum < 0) errs.push('Price cannot be negative.');

    if (errs.length) {
      const first = errs[0];
      const moreCount = errs.length - 1;
      const message = moreCount > 0 ? `${first} (and ${moreCount} more)` : first;
      setFeedback({ show: true, message });
      return;
    }

    try {
      const jobData = {
        description: desc,
        location: loc,
        price: priceNum,
        category: selectedCategory,
      };

      await createJob(jobData);

      // Refresh job list to include the new job
      setPage(1);
      await fetchJobs({ useCache: false, pageOverride: 1 });

      resetForm();
      setIsModalOpen(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      console.error("Error posting job:", error);

      // Match WorkerPortfolio parsing and produce a concise single message
      let userMessage = "Something went wrong.";

      if (error?.response && error.response.data) {
        const data = error.response.data;

        if (data.code === 'VALIDATION_ERROR' && Array.isArray(data.errors) && data.errors.length > 0) {
          // Show only the first server validation error to avoid overwhelming the user
          const firstErr = data.errors[0];
          let firstMsg = '';
          if (firstErr && firstErr.field && firstErr.message) firstMsg = `${firstErr.field}: ${firstErr.message}`;
          else if (firstErr && firstErr.message) firstMsg = firstErr.message;
          else firstMsg = JSON.stringify(firstErr);
          if (data.errors.length > 1) firstMsg += ` (and ${data.errors.length - 1} more)`;
          userMessage = firstMsg || data.message || 'Validation error';
        } else if (data.code === 'INAPPROPRIATE_CONTENT') {
          const reason = data?.reason ? ` Reason: ${data.reason}` : '';
          userMessage = `${data?.message || 'Content does not meet our community guidelines.'}${reason}`;
        } else if (data.code === 'DUPLICATE_ERROR') {
          userMessage = data.message || 'A similar job already exists.';
        } else if (data.message) {
          userMessage = data.message;
          if (data.code && process.env.NODE_ENV !== 'production') userMessage += ` (${data.code})`;
        }
      } else if (error.request) {
        userMessage = 'Network error: failed to reach server. Please check your connection and try again.';
      } else if (error.message) {
        userMessage = error.message;
      }

      setFeedback({ show: true, message: userMessage });
    }
  };

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await getProfile();
        const userData = res.data?.data;

        setUser(userData);

        if (userData?.userType === "worker") {
          const biography =
            typeof userData.biography === "string"
              ? userData.biography.trim()
              : "";
          const portfolios = Array.isArray(userData.portfolio)
            ? userData.portfolio
            : [];
          const certificates = Array.isArray(userData.certificates)
            ? userData.certificates
            : [];
          const skills = Array.isArray(userData.skillsByCategory)
            ? userData.skillsByCategory
            : [];
          const experiences = Array.isArray(userData.experience)
            ? userData.experience
            : [];
          const education = Array.isArray(userData.education)
            ? userData.education
            : [];

          const hasProfilePhoto = Boolean(userData?.image);
          const completedFlags = {
            profilePhoto: hasProfilePhoto,
            biography: biography.length > 0,
            portfolio: portfolios.length > 0,
            certificates: certificates.length > 0,
            experience: experiences.length > 0,
            education: education.length > 0,
            skills: skills.length > 0,
          };

          setPortfolioSetupCompleted(completedFlags);

          // determine first incomplete step order: 1 photo, 2 bio, 3 portfolio, 4 certificates, 5 experience, 6 education, 7 skills
          const stepOrder = [
            { key: "profilePhoto", step: 1 },
            { key: "biography", step: 2 },
            { key: "portfolio", step: 3 },
            { key: "certificates", step: 4 },
            { key: "experience", step: 5 },
            { key: "education", step: 6 },
            { key: "skills", step: 7 },
          ];
          const firstIncomplete = stepOrder.find(({ key }) => !completedFlags[key]);
          setPortfolioSetupInitialStep(firstIncomplete ? firstIncomplete.step : 7);

          const shouldShowModal =
            portfolios.length === 0 ||
            certificates.length === 0 ||
            skills.length === 0 ||
            experiences.length === 0 ||
            biography.length === 0 ||
            education.length === 0;

          setShowPortfolioSetup(shouldShowModal);

          if (!userData.idPictureId && !userData.selfiePictureId) {
            setShowIdSetup(true);
          } else {
            setShowIdSetup(false);
          }
        } else {
          setShowPortfolioSetup(false);
          if (userData?.userType === "client") {
            setShowIdSetup(!userData.isVerified);
          } else {
            setShowIdSetup(false);
          }
        }
      } catch (err) {
        console.error("Auth check failed", err);
        setShowPortfolioSetup(false);
      }
    };

    fetchUser();
  }, []);

  // Close desktop filters dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!showDesktopFilters) return;

    const handleOutside = (e) => {
      const el = desktopFilterContainerRef.current;
      if (el && !el.contains(e.target)) {
        setShowDesktopFilters(false);
      }
    };

    const handleEsc = (e) => {
      if (e.key === "Escape") setShowDesktopFilters(false);
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside, { passive: true });
    document.addEventListener("keydown", handleEsc);

    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [showDesktopFilters]);

  // Filter jobs (client-side search across description, location, and category label)
  const filteredJobs = Array.isArray(jobPosts)
    ? jobPosts.filter((job) => {
      const q = (search || "").trim().toLowerCase();
      if (!q) return true;
      const desc = (job.description || "").toLowerCase();
      const loc = (job.location || "").toLowerCase();
      const cat = (
        job.category?.name || job.category?.categoryName || ""
      ).toLowerCase();
      return (
        desc.includes(q) ||
        loc.includes(q) ||
        cat.includes(q)
      );
    })
    : [];

  if (loading && (page === 1 || jobPosts.length === 0)) {
    return (
      <div className="max-w-5xl mx-auto p-4 md:p-0 mt-25 md:mt-35">
        <div className="space-y-4 pb-4 animate-pulse">
          {/* Optional verification notice skeleton */}
          <div className="h-10 bg-white border border-gray-200 rounded-[12px] shadow-sm w-full" />

          {/* Search + Filters Skeleton (mirror main UI layout) */}
          <div className="relative w-full md:flex-1 mb-2">
            {/* Search input shell */}
            <div className="w-full h-12 bg-white border border-gray-200 shadow rounded-[18px]" />
            {/* Left search icon placeholder */}
            <div className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 bg-gray-200 rounded" />
            {/* Desktop Filters button placeholder */}
            <div className="hidden md:block absolute right-2 top-1/2 -translate-y-1/2 h-8 w-24 bg-gray-200 rounded-[14px]" />
            {/* Mobile Filters button placeholder */}
            <div className="md:hidden absolute right-2 top-1/2 -translate-y-1/2 h-8 w-20 bg-gray-200 rounded-[14px]" />
          </div>

          {/* Post Box Skeleton (client only) to match 'Post a work...' */}
          {user?.userType === "client" && (
            <div className="bg-white shadow rounded-[20px] p-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-200" />
                <div className="flex-1 h-10 bg-gray-100 rounded-full flex items-center px-4">
                  <div className="h-3 w-28 bg-gray-200 rounded-full" />
                </div>
              </div>
            </div>
          )}

          {/* Job Card Skeletons (mirror job card UI) */}
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-[20px] p-4 bg-white shadow-sm">
              <div className="rounded-xl p-2 bg-white">
                {/* Header: avatar + name + date */}
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gray-200" />
                    <div className="flex flex-col gap-1">
                      <div className="h-4 bg-gray-200 rounded w-32" />
                    </div>
                  </div>
                  <div className="h-4 bg-gray-200 rounded w-20" />
                </div>

                {/* Description line with icon placeholder */}
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-5 h-5 bg-gray-200 rounded" />
                  <div className="h-5 bg-gray-200 rounded w-3/4" />
                </div>

                {/* Category chip (single like real UI) */}
                <div className="flex gap-2 mt-3">
                  <div className="h-6 bg-gray-200 rounded-md w-28" />
                </div>

                {/* Footer: location + price */}
                <div className="flex justify-between items-center mt-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-gray-200 rounded" />
                    <div className="h-4 bg-gray-200 rounded w-44" />
                  </div>
                  <div className="h-4 bg-gray-200 rounded w-16" />
                </div>
              </div>
            </div>
          ))}

          {/* Load more button skeleton */}
          <div className="mx-auto h-10 w-36 bg-white border border-gray-200 rounded-md shadow" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-0 mt-25 md:mt-35 animate-fade-in">

      <VerificationNotice user={user} />

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <div ref={desktopFilterContainerRef} className="relative w-full md:flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 z-10" />
          <input
            type="text"
            placeholder="Search job descriptions..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyPress}
            className="w-full px-4 py-4 md:py-3 shadow rounded-[18px] bg-white pl-10 pr-44 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          {/* <button
            type="button"
            onClick={() => setSearch(searchInput.trim())}
            className="absolute right-24 md:right-26 top-1/2 -translate-y-1/2 px-2 md:px-3 py-2 rounded-[14px] bg-sky-500 text-white text-sm hover:bg-sky-700 shadow-md cursor-pointer"
            aria-label="Search"
          >
            Search
          </button> */}

          {/* Mobile filters trigger next to Search*/}
          <button
            type="button"
            onClick={() => setShowMobileFilters(true)}
            className="flex md:hidden absolute right-2 top-1/2 -translate-y-1/2 px-2 md:px-3 py-2 rounded-[14px] bg-white border border-gray-200 text-gray-700 text-sm shadow-sm hover:bg-gray-50 cursor-pointer items-center gap-2"
            aria-label="Filters"
            aria-expanded={showMobileFilters}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
          </button>

          {/* Desktop filters trigger inside search row */}
          <button
            type="button"
            onClick={() => setShowDesktopFilters((s) => !s)}
            className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-[14px] bg-white border border-gray-200 text-gray-700 text-sm shadow-sm hover:bg-gray-50 cursor-pointer items-center gap-2"
            aria-label="Filters"
            aria-expanded={showDesktopFilters}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
          </button>

          {/* Desktop filters dropdown popover */}
          {showDesktopFilters && (
            <div className="hidden md:block absolute right-0 top-full mt-2 w-80 bg-white shadow-lg rounded-lg p-3 z-20 animate-scale-in">
              {/* Location */}
              <div className="flex items-stretch gap-2 mb-3">
                <input
                  type="text"
                  placeholder="Filter by location"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  onKeyDown={handleLocationKeyPress}
                  className="flex-1 px-3 py-2 shadow rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <button
                  type="button"
                  onClick={() => setLocation(locationInput.trim())}
                  className="shrink-0 px-3 py-2 rounded-md bg-[#55b3f3] text-white text-sm hover:bg-blue-400 cursor-pointer"
                >
                  Apply
                </button>
              </div>
              {/* Category */}
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full px-3 py-2 shadow rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 mb-3"
              >
                <option value="">All categories</option>
                {categories.map((cat) => (
                  <option key={cat._id} value={cat._id}>
                    {cat.categoryName}
                  </option>
                ))}
              </select>
              {/* Sorting */}
              <div className="flex gap-3 flex-wrap mb-3">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-3 py-2 shadow rounded-md bg-white text-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 flex-1"
                >
                  <option value="createdAt">Date Posted</option>
                  <option value="price">Price</option>
                  <option value="updatedAt">Last Updated</option>
                </select>
                <select
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                  className="px-3 py-2 shadow rounded-md bg-white text-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
              {(filterCategory || location || sortBy !== "createdAt" || order !== "desc") && (
                <button
                  onClick={() => {
                    setFilterCategory("");
                    setLocation("");
                    setSearch("");
                    setSortBy("createdAt");
                    setOrder("desc");
                  }}
                  className="text-sm text-[#55b3f3] hover:text-sky-700 hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Mobile: inline filter button moved next to Search above */}

        {/* Desktop: toggle handled inside search bar; no inline button here */}
      </div>

      {/* Mobile filters modal (portaled) */}
      {showMobileFilters &&
        createPortal(
          <div className="fixed inset-0 z-[2000] md:hidden" role="dialog" aria-modal="true">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40 animate-fade-in"
              onClick={() => setShowMobileFilters(false)}
              aria-hidden="true"
            />
            {/* Bottom sheet panel */}
            <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-2xl p-4 shadow-2xl max-h-[80vh] overflow-y-auto animate-slide-up">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-gray-800">Filters</h3>
                <button
                  type="button"
                  onClick={() => setShowMobileFilters(false)}
                  className="p-2 rounded-full hover:bg-gray-100"
                  aria-label="Close filters"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {/* Location */}
              <div className="flex items-stretch gap-2 mb-3">
                <input
                  type="text"
                  placeholder="Filter by location"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  onKeyDown={handleLocationKeyPress}
                  className="flex-1 px-3 py-2 shadow rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <button
                  type="button"
                  onClick={() => setLocation(locationInput.trim())}
                  className="shrink-0 px-3 py-2 rounded-md bg-[#55b3f3] text-white text-sm hover:bg-blue-400 cursor-pointer"
                >
                  Apply
                </button>
              </div>
              {/* Category */}
              <div className="mb-3">
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="w-full px-3 py-2 shadow rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  <option value="">All categories</option>
                  {categories.map((cat) => (
                    <option key={cat._id} value={cat._id}>
                      {cat.categoryName}
                    </option>
                  ))}
                </select>
              </div>
              {/* Sorting */}
              <div className="flex gap-3 flex-wrap mb-3">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="px-3 py-2 shadow rounded-md bg-white text-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 flex-1"
                >
                  <option value="createdAt">Date Posted</option>
                  <option value="price">Price</option>
                  <option value="updatedAt">Last Updated</option>
                </select>
                <select
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                  className="px-3 py-2 shadow rounded-md bg-white text-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
              {(filterCategory || location || sortBy !== "createdAt" || order !== "desc") && (
                <button
                  onClick={() => {
                    setFilterCategory("");
                    setLocation("");
                    setSearch("");
                    setSortBy("createdAt");
                    setOrder("desc");
                  }}
                  className="text-sm text-[#55b3f3] hover:text-sky-700 hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* Post Box */}
      {user?.userType === "client" && (
        <div
          onClick={() => {
            if (requiresClientVerification) {
              setShowIdSetup(true);
              return;
            }
            setIsModalOpen(true);
          }}
          className={`bg-white shadow rounded-[20px] p-4 mb-4 cursor-pointer hover:shadow-md transition ${
            requiresClientVerification ? "ring-1 ring-yellow-300" : ""
          }`}
        >
          <div className="flex items-center gap-3">
            <img
              src={user?.image || currentUser.avatar}
              alt="Avatar"
              className="w-10 h-10 rounded-full object-cover"
            />

            <div
              className={`flex-1 bg-gray-100 px-4 py-2 rounded-full text-left ${
                requiresClientVerification ? "text-amber-700" : "text-gray-500"
              }`}
            >
              {requiresClientVerification
                ? "Verify your ID to post"
                : "Post a work..."}
            </div>
          </div>
        </div>
      )}

      {/* Modal (portaled) */}
      {isModalOpen &&
        createPortal(
          <div className="fixed inset-0 bg-white/20 backdrop-blur-md bg-opacity-50 flex items-center justify-center z-[2000]" role="dialog" aria-modal="true">
            <div className="bg-white rounded-lg w-full max-w-2xl p-6 shadow-lg relative">
              {/* CHANGED: Close uses draft check */}
              <button
                onClick={handleCloseModal}
                className="absolute top-1 right-3 text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                <X size={20} />
              </button>

              {/* Job Preview: show only after user inputs something; no loading skeleton */}
              {(newJob.description || newJob.location || selectedCategory || newJob.priceOffer) && (
                <div className="mt-6 pt-2">
                  <div className="rounded-[20px] p-4 bg-gray-50 shadow-sm mb-4">
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        <img
                          src={user?.image || currentUser.avatar}
                          alt="Avatar"
                          className="w-8 h-8 rounded-full object-cover"
                        />
                        <span className="text-md font-semibold text-[#252525]">
                          {user?.fullName || "Client Name"}
                        </span>
                      </div>
                      <span className="flex items-center gap-1 text-sm text-[#252525] opacity-80">
                        {/* <Clock size={16} /> Just now */}
                      </span>
                    </div>
                    <p className="text-gray-700 mt-1 text-left flex items-center gap-2">
                      <span className="flex items-center justify-center w-5 h-5">
                        <Briefcase size={20} className="text-[#55B2F3]" />
                      </span>
                      <span className="line-clamp-1 md:text-base">
                        {newJob.description}
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {selectedCategory ? (
                        <span className="bg-[#55B2F3]/90 text-white font-medium backdrop-blur-sm px-2.5 py-1 rounded-md text-sm">
                          {categories.find((c) => c._id === selectedCategory)?.categoryName}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-sm">No category selected</span>
                      )}
                    </div>
                    <div className="flex justify-between items-center mt-4 text-sm text-gray-600 ">
                      <span className="flex items-center gap-1">
                        <MapPin size={16} />
                        <span className="truncate overflow-hidden max-w-45 md:max-w-full md:text-base text-gray-500">
                          {newJob.location}
                        </span>
                      </span>
                      <span className="font-bold text-green-400">
                        {newJob.priceOffer ? `₱${parseFloat(newJob.priceOffer).toLocaleString()}` : "₱0"}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Job Creation Form */}
              <form onSubmit={handlePostJob} className="space-y-3">
                <textarea
                  placeholder="Job description"
                  value={newJob.description}
                  onChange={(e) =>
                    setNewJob({ ...newJob, description: e.target.value })
                  }
                  className="px-4 py-2 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full"
                  rows="3"
                />
                <label className="block text-sm font-medium text-gray-500 mb-1 text-left">
                  Address
                </label>
                <AddressInput
                  value={newJob.location}
                  onChange={(address) =>
                    setNewJob({ ...newJob, location: address })
                  }
                />
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1 text-left">
                    Category
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="px-3 py-2 bg-gray-50 border border-gray-300 text-gray-500 text-sm rounded-lg block w-full"
                  >
                    <option value="">Select a category</option>
                    {categories.map((cat) => (
                      <option key={cat._id} value={cat._id} className="text-black">
                        {cat.categoryName}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="number"
                  placeholder="Price offer (₱)"
                  value={newJob.priceOffer}
                  onChange={(e) =>
                    setNewJob({ ...newJob, priceOffer: e.target.value })
                  }
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block"
                  min="0"
                  step="0.01"
                />
                <button
                  type="submit"
                  className="w-full px-4 py-2 bg-[#55b3f3] text-white rounded-md hover:bg-blue-400 cursor-pointer transition-colors"
                >
                  Post Job
                </button>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Draft confirmation modal (portaled) */}
      {showDraftConfirm &&
        createPortal(
          <div className="fixed inset-0 flex items-center justify-center bg-white/20 backdrop-blur-md bg-opacity-40 z-[2000]" role="dialog" aria-modal="true">
            <div className="bg-white rounded-[20px] p-6 shadow-lg max-w-sm w-full text-center">
              <h3 className="text-lg font-semibold mb-4">Save draft</h3>
              <p className="text-gray-600 mb-6">
                You have unsaved input. Do you want to save it as a draft or
                discard it?
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={handleDiscardDraft}
                  className="px-4 py-2 bg-gray-200 rounded-md hover:bg-gray-300 cursor-pointer transition-colors"
                >
                  Discard
                </button>
                <button
                  onClick={handleSaveDraft}
                  className="px-4 py-2 bg-[#55b3f3] text-white rounded-md hover:bg-sky-600 cursor-pointer transition-colors"
                >
                  Save Draft
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Validation/Alert Modal (portaled) */}
      {feedback.show &&
        createPortal(
          <div className="fixed inset-0 bg-white/60 flex items-center justify-center z-[2000]">
            <div className="bg-white rounded-xl shadow-xl p-6 border border-gray-200 max-w-sm w-full text-center">
              <div className="flex flex-col items-center gap-3">
                <p className="text-gray-700 text-base font-medium whitespace-pre-line">{feedback.message}</p>
                <button
                  onClick={() => setFeedback({ show: false, message: "" })}
                  className="mt-3 px-5 py-2 bg-[#55b3f3] text-white rounded-lg hover:bg-sky-600 transition-colors"
                >
                  OK
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ID Setup Modal */}
      {showIdSetup && (
        <IDSetup
          onClose={() => setShowIdSetup(false)}
          onStatusChange={handleIdStatusChange}
        />
      )}

      {/* Show Portfolio Setup */}
      {showPortfolioSetup && (
        <PortfolioSetup
          onClose={() => setShowPortfolioSetup(false)}
          completed={portfolioSetupCompleted}
          initialStep={portfolioSetupInitialStep}
        />
      )}

      {/* Success Modal */}
      {showSuccess && (
        <div className="fixed bottom-6 right-6 bg-[#55b3f3] text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-slide-up">
          <CheckCircle size={20} /> Job posted successfully!
        </div>
      )}

      {/* Job Posts Display (inner scroll like FindWorker) */}
      {filteredJobs.length > 0 ? (
        <div ref={listRef} style={{ height: listHeight }} className="custom-scrollbar flex flex-col overflow-y-auto pr-2">
          <div className="space-y-4 pb-4 stagger-children">
            {filteredJobs.map((job) => {
              const toIdString = (val) => {
                if (!val) return "";
                if (typeof val === "string") return val;
                if (typeof val === "object") return val._id || val.id || "";
                try { return String(val); } catch { return ""; }
              };
              // Robustly derive the Client model id for profile route
              const clientProfileId =
                toIdString(job?.client?.id) ||
                toIdString(job?.client?._id) ||
                toIdString(job?.clientId);
              return (
                <div
                  key={job.id || job._id}
                  className="rounded-[20px] p-4 bg-white shadow-sm hover:shadow-lg transition-all block cursor-pointer"
                  onClick={() => {
                    const viewerIsClient = user?.userType === "client";

                    const idToStr = (val) => {
                      if (!val) return "";
                      if (typeof val === "string") return val;
                      if (typeof val === "object") return val._id || val.id || String(val || "");
                      try {
                        return String(val);
                      } catch {
                        return "";
                      }
                    };

                    const viewerCandidates = [
                      user?.profileId,
                      user?.credentialId?._id,
                      user?.credentialId,
                      user?._id,
                      user?.id,
                    ]
                      .map(idToStr)
                      .filter((s) => typeof s === "string" && s.length);

                    const ownerCandidates = [
                      job?.client?.credentialId?._id,
                      job?.client?.credentialId,
                      job?.client?.id,
                      job?.client?._id,
                      job?.credentialId,
                    ]
                      .map(idToStr)
                      .filter((s) => typeof s === "string" && s.length);

                    const anyMatch = viewerCandidates.some((v) =>
                      ownerCandidates.includes(v)
                    );

                    const isOwner = Boolean(viewerIsClient && anyMatch);

                    if (isOwner) {
                      navigate(`/invite-workers/${job.id || job._id}`);
                    } else {
                      navigate(`/job/${job.id || job._id}`);
                    }
                  }}
                >
                  <div className="rounded-xl p-2 bg-white transition-all">
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            if (!user) return; // Not logged in: allow card click to proceed
                            e.stopPropagation();
                            if (clientProfileId) navigate(`/client/${clientProfileId}`);
                          }}
                          className={`focus:outline-none ${user ? '' : 'cursor-default'}`}
                          title={user ? "View client profile" : "Log in to view profile"}
                        >
                          <img
                            src={
                              job.client?.profilePicture?.url ||
                              currentUser.avatar
                            }
                            alt="Client Avatar"
                            className={`w-8 h-8 rounded-full object-cover ${user ? 'cursor-pointer' : 'cursor-default'}`}
                          />
                        </button>
                        <div className="flex flex-col">
                          <span className="md:text-md font-bold text-[#252525]">
                            {job.client?.name || "Client Name"}
                          </span>
                        </div>
                      </div>
                      <span className="flex items-center gap-1 font-medium text-sm text-[#252525] opacity-80">
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
                      <span className="line-clamp-1 md:text-base">
                        {job.description}
                      </span>
                    </p>

                    <div className="flex flex-wrap gap-2 mt-3">
                      <span className="bg-[#55B2F3]/90 text-white font-medium backdrop-blur-sm px-2.5 py-1 rounded-md text-sm">
                        {job.category?.name || "Uncategorized"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-4 text-sm text-gray-600 ">
                      <span className="flex items-center gap-1">
                        <MapPin size={16} />
                        <span className="truncate overflow-hidden max-w-45 md:max-w-full md:text-base text-gray-500">
                          {job.location}
                        </span>
                      </span>
                      <span className="font-bold text-green-400">
                        ₱{job.price?.toLocaleString() || 0}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {hasMore && (
              <div className="text-center mt-4">
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={isFetchingMore}
                  className="px-4 py-2 bg-white shadow rounded-md hover:shadow-md disabled:opacity-60"
                >
                  {isFetchingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center mt-10">
          <p className="text-gray-500 mb-4">No job posts found.</p>
          {search ||
            location ||
            filterCategory ||
            sortBy !== "createdAt" ||
            order !== "desc" ? (
            <p className="text-sm text-gray-400">
              Try adjusting your search filters or{" "}
              <button
                onClick={() => {
                  setSearch("");
                  setLocation("");
                  setFilterCategory("");
                  setSortBy("createdAt");
                  setOrder("desc");
                }}
                className="text-blue-500 hover:underline"
              >
                clear all filters
              </button>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default FindWork;
