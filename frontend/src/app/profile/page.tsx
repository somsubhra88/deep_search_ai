"use client";

import { useState, useEffect } from "react";
import { useAuth, useAuthToken } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import { History, Settings, Clock } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface SearchHistoryItem {
  id: string;
  search_id: string;
  query: string;
  mode: string;
  created_at: string;
  status: string;
}

export default function ProfilePage() {
  const { user } = useAuth();
  const token = useAuthToken();
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [preferences, setPreferences] = useState<any>({});
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [activeTab, setActiveTab] = useState<"history" | "settings">("history");

  useEffect(() => {
    if (token) {
      fetchHistory();
      fetchPreferences();
    }
  }, [token]);

  const fetchHistory = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/history`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setHistory(data.history || []);
      }
    } catch (error) {
      console.error("Failed to fetch history:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const fetchPreferences = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/preferences`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPreferences(data.preferences || {});
      }
    } catch (error) {
      console.error("Failed to fetch preferences:", error);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen p-6">
        <div className="max-w-6xl mx-auto">
          {/* Profile Header */}
          <div className="glass rounded-2xl p-6 mb-6 border border-[var(--glass-border)]">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
                {user?.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-2xl font-bold">{user?.username}</h1>
                <p className="text-gray-500 dark:text-gray-400">{user?.email}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Member since {user?.created_at ? formatDate(user.created_at) : "N/A"}
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="glass rounded-2xl border border-[var(--glass-border)] overflow-hidden">
            <div className="flex border-b border-[var(--glass-border)]">
              <button
                onClick={() => setActiveTab("history")}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 font-medium transition-colors ${
                  activeTab === "history"
                    ? "bg-blue-500/10 text-blue-500 border-b-2 border-blue-500"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50"
                }`}
              >
                <History className="h-4 w-4" />
                Search History
              </button>
              <button
                onClick={() => setActiveTab("settings")}
                className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 font-medium transition-colors ${
                  activeTab === "settings"
                    ? "bg-blue-500/10 text-blue-500 border-b-2 border-blue-500"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50"
                }`}
              >
                <Settings className="h-4 w-4" />
                Preferences
              </button>
            </div>

            <div className="p-6">
              {activeTab === "history" && (
                <div>
                  <h2 className="text-xl font-semibold mb-4">Your Search History</h2>
                  {isLoadingHistory ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    </div>
                  ) : history.length === 0 ? (
                    <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                      <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>No search history yet</p>
                      <p className="text-sm mt-1">Your searches will appear here</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {history.map((item) => (
                        <div
                          key={item.id}
                          className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-500 transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-medium">{item.query}</p>
                              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatDate(item.created_at)}
                                </span>
                                <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-500">
                                  {item.mode}
                                </span>
                                <span className={`px-2 py-1 rounded ${
                                  item.status === "completed"
                                    ? "bg-green-500/10 text-green-500"
                                    : "bg-yellow-500/10 text-yellow-500"
                                }`}>
                                  {item.status}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "settings" && (
                <div>
                  <h2 className="text-xl font-semibold mb-4">Your Preferences</h2>
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                      <h3 className="font-medium mb-2">Theme</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {preferences.theme || "System default"}
                      </p>
                    </div>
                    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                      <h3 className="font-medium mb-2">Default Provider</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {preferences.default_provider || "Not set"}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
