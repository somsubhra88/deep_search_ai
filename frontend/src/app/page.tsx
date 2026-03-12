"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import { Search, Lock, Zap, History } from "lucide-react";

export default function Home() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push("/search");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-black p-4">
      <div className="max-w-4xl w-full text-center space-y-8">
        <div className="space-y-4">
          <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-4">
            Deep Search AI Agent
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto">
            AI-powered research agent with live progress streaming, secure authentication, and personalized search history
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mt-12">
          <div className="bg-gray-800/50 backdrop-blur-xl p-6 rounded-xl border border-gray-700">
            <Search className="h-12 w-12 text-blue-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Smart Search</h3>
            <p className="text-sm text-gray-400">Advanced AI-powered research with real-time progress tracking</p>
          </div>

          <div className="bg-gray-800/50 backdrop-blur-xl p-6 rounded-xl border border-gray-700">
            <Lock className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Secure</h3>
            <p className="text-sm text-gray-400">Industry-standard bcrypt encryption and JWT authentication</p>
          </div>

          <div className="bg-gray-800/50 backdrop-blur-xl p-6 rounded-xl border border-gray-700">
            <History className="h-12 w-12 text-purple-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">History</h3>
            <p className="text-sm text-gray-400">Track and manage all your searches in one place</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-12">
          <Link
            href="/register"
            className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40"
          >
            Get Started
          </Link>
          <Link
            href="/login"
            className="px-8 py-4 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl transition-all duration-200"
          >
            Sign In
          </Link>
        </div>

        <div className="mt-12 flex items-center justify-center gap-2 text-sm text-gray-400">
          <Zap className="h-4 w-4 text-yellow-500" />
          <span>Fast, secure, and intelligent research at your fingertips</span>
        </div>
      </div>
    </div>
  );
}
