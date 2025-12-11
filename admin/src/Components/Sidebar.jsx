import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { logout } from "../Api/auth";
import Logo from "./../assets/image.png";
import { UserCog, Users, LogOut } from "lucide-react";

const Sidebar = () => {
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [isContentDropdownOpen, setIsContentDropdownOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await logout(); // ✅ calls POST /admin/logout
      navigate("/"); // ✅ redirect to login page
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      {/* ✅ Loading Modal */}
      {isLoggingOut && (
  <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-white bg-opacity-40">
          <div className="bg-white p-6 rounded-2xl shadow-lg flex flex-col items-center gap-3">
            <svg
              className="w-8 h-8 animate-spin text-blue-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              ></path>
            </svg>
            <p className="text-gray-700 font-medium">Logging out...</p>
          </div>
        </div>
      )}

      <button
        data-drawer-target="default-sidebar"
        data-drawer-toggle="default-sidebar"
        aria-controls="default-sidebar"
        type="button"
        className="inline-flex items-center p-2 mt-2 ms-3 text-sm text-gray-500 rounded-lg sm:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200"
      >
        <span className="sr-only">Open sidebar</span>
        <svg
          className="w-6 h-6"
          aria-hidden="true"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            clipRule="evenodd"
            fillRule="evenodd"
            d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 10.5a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5a.75.75 0 01-.75-.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10z"
          ></path>
        </svg>
      </button>

      {/* ✅ Sidebar */}
      <aside
        id="default-sidebar"
        className="fixed top-0 left-0 z-40 w-64 h-screen transition-transform -translate-x-full sm:translate-x-0"
        aria-label="Sidebar"
      >
        <div className="h-full px-3 py-4">
          <ul className="space-y-2 font-medium">
            {/* Logo */}
            <li className="mb-6">
              <div className="flex items-center p-2 justify-center">
                <img src={Logo} alt="FixIt Logo" className="h-20 w-auto" />
              </div>
            </li>

            {/* Dashboard */}
            <li>
              <Link
                to="/dashboard"
                className="flex items-center p-2 text-gray-900 rounded-lg group hover:border-blue-300 hover:border-l-4"
              >
                <svg
                  className="w-5 h-5 text-[#55b3f3]"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                  viewBox="0 0 22 21"
                >
                  <path d="M16.975 11H10V4.025a1 1 0 0 0-1.066-.998 8.5 8.5 0 1 0 9.039 9.039.999.999 0 0 0-1-1.066h.002Z" />
                  <path d="M12.5 0c-.157 0-.311.01-.565.027A1 1 0 0 0 11 1.02V10h8.975a1 1 0 0 0 1-.935c.013-.188.028-.374.028-.565A8.51 8.51 0 0 0 12.5 0Z" />
                </svg>
                <span className="ms-3">Dashboard</span>
              </Link>
            </li>

            {/* User Management with Dropdown */}
            <li>
              <button
                onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
                className="flex items-center w-full p-2 text-gray-900 rounded-lg group hover:border-blue-300 hover:border-l-4 cursor-pointer"
              >
                <svg
                  className="w-5 h-5 text-[#55b3f3]"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                  viewBox="0 0 18 18"
                >
                  <path d="M6.143 0H1.857A1.857 1.857 0 0 0 0 1.857v4.286C0 7.169.831 8 1.857 8h4.286A1.857 1.857 0 0 0 8 6.143V1.857A1.857 1.857 0 0 0 6.143 0Zm10 0h-4.286A1.857 1.857 0 0 0 10 1.857v4.286C10 7.169 10.831 8 11.857 8h4.286A1.857 1.857 0 0 0 18 6.143V1.857A1.857 1.857 0 0 0 16.143 0Zm-10 10H1.857A1.857 1.857 0 0 0 0 11.857v4.286C0 17.169.831 18 1.857 18h4.286A1.857 1.857 0 0 0 8 16.143v-4.286A1.857 1.857 0 0 0 6.143 10Zm10 0h-4.286A1.857 1.857 0 0 0 10 11.857v4.286c0 1.026.831 1.857 1.857 1.857h4.286A1.857 1.857 0 0 0 18 16.143v-4.286A1.857 1.857 0 0 0 16.143 10Z" />
                </svg>
                <span className="ms-3">User Management</span>
                <svg
                  className={`w-4 h-4 ml-2 transition-transform ${
                    isUserDropdownOpen ? "rotate-90" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              {isUserDropdownOpen && (
                <ul className="ml-8 mt-2 space-y-2">
                  <li>
                    <Link
                      to="/client-management"
                      className="flex items-center gap-2 p-2 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <UserCog className="w-5 h-5 text-gray-500 group-hover:text-gray-900" />
                      <span>Client Management</span>
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/worker-management"
                      className="flex items-center gap-2 p-2 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <Users className="w-5 h-5 text-gray-500 group-hover:text-gray-900" />
                      <span>Worker Management</span>
                    </Link>
                  </li>
                </ul>
              )}
            </li>

            {/* Manage Content with Dropdown */}
            <li>
              <button
                onClick={() => setIsContentDropdownOpen(!isContentDropdownOpen)}
                className="flex items-center w-full p-2 text-gray-900 rounded-lg group hover:border-blue-300 hover:border-l-4 cursor-pointer"
              >
                <svg
                  className="shrink-0 w-5 h-5 text-[#55b3f3]"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="m17.418 3.623-.018-.008a6.713 6.713 0 0 0-2.4-.569V2h1a1 1 0 1 0 0-2h-2a1 1 0 0 0-1 1v2H9.89A6.977 6.977 0 0 1 12 8v5h-2V8A5 5 0 1 0 0 8v6a1 1 0 0 0 1 1h8v4a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-4h6a1 1 0 0 0 1-1V8a5 5 0 0 0-2.582-4.377ZM6 12H4a1 1 0 0 1 0-2h2a1 1 0 0 1 0 2Z" />
                </svg>
                <span className="ms-3 whitespace-nowrap">Manage Content</span>
                <svg
                  className={`w-4 h-4 ml-2 transition-transform ${
                    isContentDropdownOpen ? "rotate-90" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              {isContentDropdownOpen && (
                <ul className="ml-8 mt-2 space-y-2">
                  {/* Skill Categories */}
                  <li>
                    <Link
                      to="/content"
                      className="flex items-center gap-2 p-2 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <svg
                        className="w-5 h-5 text-gray-500"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M4 4h6v6H4V4Zm0 10h6v6H4v-6Zm10-10h6v6h-6V4Zm0 10h6v6h-6v-6Z" />
                      </svg>
                      <span>Skill Categories</span>
                    </Link>
                  </li>

                  {/* Pending Jobs */}
                  <li>
                    <Link
                      to="/job-pending"
                      className="flex items-center gap-2 p-2 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <svg
                        className="w-5 h-5 text-gray-500"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M6 2a2 2 0 0 0-2 2v16l8-4 8 4V4a2 2 0 0 0-2-2H6Z" />
                      </svg>
                      <span>Jobs</span>
                    </Link>
                  </li>
                </ul>
              )}
            </li>

            {/* Verification */}
            <li>
              <Link
                to="/verification"
                className="flex items-center p-2 text-gray-900 rounded-lg  group hover:border-blue-300 hover:border-l-4"
              >
                <svg
                  className="w-5 h-5 text-[#55b3f3] transition duration-75 "
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                  viewBox="0 0 20 18"
                >
                  <path d="M14 2a3.963 3.963 0 0 0-1.4.267 6.439 6.439 0 0 1-1.331 6.638A4 4 0 1 0 14 2Zm1 9h-1.264A6.957 6.957 0 0 1 15 15v2a2.97 2.97 0 0 1-.184 1H19a1 1 0 0 0 1-1v-1a5.006 5.006 0 0 0-5-5ZM6.5 9a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM8 10H5a5.006 5.006 0 0 0-5 5v2a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-2a5.006 5.006 0 0 0-5-5Z" />
                </svg>
                <span className="flex-1 ms-3 whitespace-nowrap">
                  Verification
                </span>
              </Link>
            </li>

            {/* Advertisement */}
            <li>
              <Link
                to={"/advertisement"}
                className="flex items-center p-2 text-gray-900 rounded-lg  group hover:border-blue-300 hover:border-l-4"
              >
                <svg
                  className="w-5 h-5 text-[#55b3f3] transition duration-75 "
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                  viewBox="0 0 18 20"
                >
                  <path d="M17 5.923A1 1 0 0 0 16 5h-3V4a4 4 0 1 0-8 0v1H2a1 1 0 0 0-1 .923L.086 17.846A2 2 0 0 0 2.08 20h13.84a2 2 0 0 0 1.994-2.153L17 5.923ZM7 9a1 1 0 0 1-2 0V7h2v2Zm0-5a2 2 0 1 1 4 0v1H7V4Zm6 5a1 1 0 1 1-2 0V7h2v2Z" />
                </svg>
                <span className="flex-1 ms-3 whitespace-nowrap">
                  Advertisement
                </span>
              </Link>
            </li>

            {/* ✅ Logout */}
            <li>
              <button
                onClick={handleLogout}
                className="flex items-center w-full p-2 text-gray-900 rounded-lg group hover:border-blue-300 hover:border-l-4 cursor-pointer"
              >
                <LogOut className="w-5 h-5 text-[#55b3f3]" />
                <span className="ms-3">Log out</span>
              </button>
            </li>
          </ul>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
