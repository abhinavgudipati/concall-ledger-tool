import React, { useState } from "react";
import { supabase } from "./supabase";

const THEMES = {
  light: {
    bg: "#FAFAF8",
    panel: "#FFFFFF",
    ink: "#13151A",
    inkMuted: "#5B6B5E",
    inkFaint: "#9B9D94",
    accent: "#1F4D3D",
    accentBg: "#E8F0EA",
    hairline: "#E2E0D8",
    headerBg: "#13151A",
    headerInk: "#FAFAF8",
  },
};

export default function SignInPage() {
  const t = THEMES.light;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: t.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', -apple-system, sans-serif",
        color: t.ink,
      }}
    >
      {/* Logo / wordmark */}
      <div style={{ marginBottom: "48px", textAlign: "center" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "12px",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "36px",
              background: t.headerBg,
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="2" y="2" width="6" height="6" rx="1" fill="#FAFAF8" />
              <rect x="10" y="2" width="6" height="6" rx="1" fill="#FAFAF8" opacity="0.5" />
              <rect x="2" y="10" width="6" height="6" rx="1" fill="#FAFAF8" opacity="0.5" />
              <rect x="10" y="10" width="6" height="6" rx="1" fill="#FAFAF8" opacity="0.3" />
            </svg>
          </div>
          <span style={{ fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em" }}>
            Concalls.in
          </span>
        </div>
        <p style={{ color: t.inkMuted, fontSize: "14px", margin: 0 }}>
          Track and compare management guidance across quarters.
        </p>
      </div>

      {/* Sign-in card */}
      <div
        style={{
          background: t.panel,
          border: `1px solid ${t.hairline}`,
          borderRadius: "12px",
          padding: "40px",
          width: "100%",
          maxWidth: "380px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        <h2
          style={{
            fontSize: "18px",
            fontWeight: 600,
            margin: "0 0 8px",
            letterSpacing: "-0.01em",
            color: "#13151A",
          }}
        >
          Sign in to your workspace
        </h2>
        <p style={{ color: t.inkMuted, fontSize: "13px", margin: "0 0 28px" }}>
          Your reports and history are saved to your account.
        </p>

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            padding: "11px 16px",
            background: loading ? "#f5f5f3" : "#fff",
            border: `1px solid ${t.hairline}`,
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 500,
            color: t.ink,
            cursor: loading ? "not-allowed" : "pointer",
            transition: "background 0.15s, box-shadow 0.15s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
          onMouseEnter={(e) => { if (!loading) e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
        >
          {/* Google logo */}
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
            <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>

        {error && (
          <p style={{ color: "#9B3E3E", fontSize: "12px", marginTop: "12px", textAlign: "center" }}>
            {error}
          </p>
        )}

        <p
          style={{
            color: t.inkFaint,
            fontSize: "11px",
            marginTop: "24px",
            textAlign: "center",
            lineHeight: "1.5",
          }}
        >
          By signing in you agree to our terms of service.
          <br />
          Your data is stored privately and never shared.
        </p>
      </div>
    </div>
  );
}
