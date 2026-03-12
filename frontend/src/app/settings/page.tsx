"use client";

import { useState, useEffect } from "react";
import { useAuth, useAuthToken } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Key, Eye, EyeOff, Trash2, Save, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ApiKeyProvider {
  provider: string;
  label: string;
  placeholder: string;
}

const AVAILABLE_PROVIDERS: ApiKeyProvider[] = [
  { provider: "openai", label: "OpenAI", placeholder: "sk-..." },
  { provider: "anthropic", label: "Anthropic Claude", placeholder: "sk-ant-..." },
  { provider: "openrouter", label: "OpenRouter", placeholder: "sk-or-..." },
  { provider: "serpapi", label: "SerpAPI (Search)", placeholder: "..." },
  { provider: "tavily", label: "Tavily (Search)", placeholder: "tvly-..." },
  { provider: "gemini", label: "Google Gemini", placeholder: "..." },
  { provider: "grok", label: "xAI Grok", placeholder: "..." },
  { provider: "mistral", label: "Mistral AI", placeholder: "..." },
  { provider: "deepseek", label: "DeepSeek", placeholder: "..." },
  { provider: "qwen", label: "Qwen (DashScope)", placeholder: "..." },
  { provider: "inception", label: "Inception Labs", placeholder: "..." },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const token = useAuthToken();
  const [savedProviders, setSavedProviders] = useState<string[]>([]);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      fetchSavedProviders();
    }
  }, [token]);

  const fetchSavedProviders = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/api-keys`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setSavedProviders(data.providers || []);
      }
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    } finally {
      setLoading(false);
    }
  };

  const saveApiKey = async (provider: string) => {
    const key = apiKeys[provider];
    if (!key || key.trim().length === 0) {
      toast.error("Please enter a valid API key");
      return;
    }

    setSaving(provider);

    try {
      const response = await fetch(`${API_BASE}/api/auth/api-keys`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider, api_key: key }),
      });

      if (response.ok) {
        toast.success(`API key for ${provider} saved successfully`);
        setSavedProviders([...new Set([...savedProviders, provider])]);
        setApiKeys({ ...apiKeys, [provider]: "" });
      } else {
        const error = await response.json();
        toast.error(error.detail || "Failed to save API key");
      }
    } catch (error) {
      toast.error("Failed to save API key");
    } finally {
      setSaving(null);
    }
  };

  const deleteApiKey = async (provider: string) => {
    if (!confirm(`Delete API key for ${provider}?`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/auth/api-keys/${provider}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        toast.success(`API key for ${provider} deleted`);
        setSavedProviders(savedProviders.filter((p) => p !== provider));
      } else {
        toast.error("Failed to delete API key");
      }
    } catch (error) {
      toast.error("Failed to delete API key");
    }
  };

  const toggleShowKey = (provider: string) => {
    setShowKeys({ ...showKeys, [provider]: !showKeys[provider] });
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen p-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Settings</h1>
            <p className="text-gray-500 dark:text-gray-400">
              Manage your API keys and preferences
            </p>
          </div>

          {/* Security Notice */}
          <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-blue-600 dark:text-blue-400 mb-1">
                Your API keys are secure
              </p>
              <p className="text-gray-600 dark:text-gray-300">
                All API keys are encrypted using industry-standard AES-256 encryption before storage.
                They are never exposed in logs or to other users.
              </p>
            </div>
          </div>

          {/* API Keys Section */}
          <div className="glass rounded-2xl border border-[var(--glass-border)] overflow-hidden">
            <div className="p-6 border-b border-[var(--glass-border)]">
              <div className="flex items-center gap-3">
                <Key className="h-6 w-6 text-blue-500" />
                <div>
                  <h2 className="text-xl font-semibold">API Keys</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Save your API keys to avoid re-entering them
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {AVAILABLE_PROVIDERS.map((provider) => {
                const isSaved = savedProviders.includes(provider.provider);
                const isSaving = saving === provider.provider;

                return (
                  <div
                    key={provider.provider}
                    className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-medium flex items-center gap-2">
                          {provider.label}
                          {isSaved && (
                            <span className="flex items-center gap-1 text-xs bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-1 rounded-full">
                              <Check className="h-3 w-3" />
                              Saved
                            </span>
                          )}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {provider.provider}
                        </p>
                      </div>

                      {isSaved && (
                        <button
                          onClick={() => deleteApiKey(provider.provider)}
                          className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-red-600 dark:text-red-400"
                          title="Delete API key"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <input
                          type={showKeys[provider.provider] ? "text" : "password"}
                          value={apiKeys[provider.provider] || ""}
                          onChange={(e) =>
                            setApiKeys({ ...apiKeys, [provider.provider]: e.target.value })
                          }
                          placeholder={isSaved ? "••••••••••••" : provider.placeholder}
                          className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                        />
                        <button
                          onClick={() => toggleShowKey(provider.provider)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                        >
                          {showKeys[provider.provider] ? (
                            <EyeOff className="h-4 w-4 text-gray-500" />
                          ) : (
                            <Eye className="h-4 w-4 text-gray-500" />
                          )}
                        </button>
                      </div>
                      <button
                        onClick={() => saveApiKey(provider.provider)}
                        disabled={isSaving || !apiKeys[provider.provider]}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isSaving ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4" />
                            Save
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Info Footer */}
          <div className="mt-6 p-4 text-sm text-gray-600 dark:text-gray-400 text-center">
            <p>
              Your API keys are stored securely and used only for your searches.
              They are never shared with other users or third parties.
            </p>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
