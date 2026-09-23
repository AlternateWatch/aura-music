import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
declare global { interface Window { turnstile: any; } }

export function AuthForm({ onSuccess, onCancel }: { onSuccess: any; onCancel: any }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const isNativeApp = Capacitor.isNativePlatform();

  useEffect(() => {
  if (isNativeApp) return;

  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

  s.onload = () => {
    if (window.turnstile && turnstileRef.current) {
      window.turnstile.render(turnstileRef.current, {
        sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
        callback: (t: string) => setTurnstileToken(t)
      });
    }
  };

  document.body.appendChild(s);

  return () => {
    if (document.body.contains(s)) {
      document.body.removeChild(s);
    }
  };
}, [isNativeApp]);
  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!isNativeApp && !turnstileToken) {
  setError("Captcha required");
  return;
}

const API_BASE = "https://aura.basildo.me";

const endpoint = isLogin
  ? `${API_BASE}/api/auth/login`
  : `${API_BASE}/api/auth/register`;
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, username, turnstileToken }) });
    const d = await res.json();
    if (res.ok) { 
        if (isLogin) {
            // FIXED: Passing profile_pic_path from the server response to the app state
            onSuccess(d.token, { 
                username: d.username, 
                userId: d.userId, 
                custom_bg_path: d.custom_bg_path,
                profile_pic_path: d.profile_pic_path // <--- ADDED
            }, d.role); 
        } else {
            setIsLogin(true); 
        }
    } 
    else {
    setError(`Error ${res.status}: ${d.error || "Sin respuesta del servidor"}`);
}
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-white">
      <h3 className="text-xl font-bold uppercase tracking-tighter">{isLogin ? "Sign In" : "Register"}</h3>
      {!isLogin && <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" required className="bg-white/5 border border-white/10 p-3 rounded-xl outline-none font-bold" />}
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" required className="bg-white/5 border border-white/10 p-3 rounded-xl outline-none font-bold" />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required className="bg-white/5 border border-white/10 p-3 rounded-xl outline-none font-bold" />
      {!isNativeApp && (
  <div ref={turnstileRef} className="flex justify-center" />
)}
      {error && <p className="text-red-500 text-[10px] uppercase font-bold">{error}</p>}
      <button type="submit" className="bg-white text-black py-3 rounded-xl font-bold uppercase hover:scale-105 transition-all">{isLogin ? "Continue" : "Register"}</button>
      <button type="button" onClick={() => setIsLogin(!isLogin)} className="text-[10px] opacity-40 uppercase font-bold hover:text-white transition-all">{isLogin ? "Need an account? Join" : "Back to login"}</button>
      <button type="button" onClick={onCancel} className="text-[10px] opacity-20 uppercase font-bold mt-2">Cancel</button>
    </form>
  );
} 