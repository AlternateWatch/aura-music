import React, { useState } from 'react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (token: string, username: string) => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const body = isLogin ? { email, password } : { username, email, password };

    try {
      // Note: We use the relative path because the server serves the frontend
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok) {
        if (isLogin) {
          onSuccess(data.token, data.username);
          onClose();
        } else {
          setIsLogin(true); // Switch to login after successful register
          alert("Account created! Please login.");
        }
      } else {
        setError(data.error || "Authentication failed");
      }
    } catch (err) {
      setError("Server connection failed");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#121212]/80 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold tracking-tighter text-white font-mono uppercase">
            {isLogin ? 'Login to Aura' : 'Join the Library'}
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            {isLogin ? 'Welcome back, listener.' : 'Create an account to contribute music.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs font-medium uppercase tracking-widest text-gray-500 mb-1">Username</label>
              <input
                type="text"
                required
                className="w-full rounded-lg border border-white/5 bg-white/5 p-3 text-white outline-none focus:border-purple-500/50 focus:bg-white/10 transition-all font-mono"
                placeholder="audiophile_99"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium uppercase tracking-widest text-gray-500 mb-1">Email</label>
            <input
              type="email"
              required
              className="w-full rounded-lg border border-white/5 bg-white/5 p-3 text-white outline-none focus:border-purple-500/50 focus:bg-white/10 transition-all font-mono"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-widest text-gray-500 mb-1">Password</label>
            <input
              type="password"
              required
              className="w-full rounded-lg border border-white/5 bg-white/5 p-3 text-white outline-none focus:border-purple-500/50 focus:bg-white/10 transition-all font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-red-400 font-mono italic">{error}</p>}

          <button
            type="submit"
            className="w-full rounded-lg bg-white p-3 font-bold text-black transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            {isLogin ? 'CONTINUE' : 'CREATE ACCOUNT'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-gray-400 hover:text-white transition-colors underline decoration-purple-500/50 underline-offset-4"
          >
            {isLogin ? "Don't have an account? Register" : "Already have an account? Login"}
          </button>
        </div>

        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default AuthModal;