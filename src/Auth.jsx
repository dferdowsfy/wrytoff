import { useState, useEffect } from 'react';
import { auth, db } from './firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import WrytoffTaxOptimizer from './App';

export default function AuthGuard() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [showAuthForm, setShowAuthForm] = useState(false); // Controls whether to show Landing or Auth Form

  // Onboarding
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [businessType, setBusinessType] = useState('single-member LLC');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        const docRef = doc(db, 'users', u.uid);
        const docSnap = await getDoc(docRef).catch(() => null);
        if (docSnap && docSnap.exists() && docSnap.data().onboardingCompleted) {
          setUserProfile(docSnap.data());
          setNeedsOnboarding(false);
        } else {
          setNeedsOnboarding(true);
        }
      } else {
        setUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    setAuthLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!companyName) return setError('Company name is required');
    setError('');
    setAuthLoading(true);
    try {
      const profileData = {
        uid: user.uid,
        email: user.email,
        companyName,
        taxProfile: { businessType },
        onboardingCompleted: true,
        createdAt: new Date().toISOString()
      };
      await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
      setUserProfile(prev => ({ ...prev, ...profileData }));
      setNeedsOnboarding(false);
    } catch (err) {
      setError('Failed to save profile: Check your Firebase API keys & rules.');
    } finally {
      setAuthLoading(false);
    }
  };

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#fff', fontFamily: "'DM Mono', monospace" }}>Loading Wrytoff...</div>;
  }

  // LOGOUT (Exported securely or passed down)
  const handleLogout = () => signOut(auth);

  // 1) NOT LOGGED IN — SHOW LANDING OR FORM
  if (!user) {
    if (!showAuthForm) {
      return (
        <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg, #f1f5f9 0%, #e2e8f0 100%)', color: '#1e293b', fontFamily: "'Inter', sans-serif", overflowX: 'hidden' }}>
          {/* TOP NAV */}
          <nav style={{ padding: '24px 80px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '32px', height: '32px', background: '#0f172a', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold' }}>W</div>
              <span style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.5px' }}>Wrytoff</span>
              <div style={{ marginLeft: '40px', display: 'flex', gap: '30px', fontSize: '14px', fontWeight: '500', color: '#64748b' }}>
                <span style={{ cursor: 'pointer' }}>Features</span>
                <span style={{ cursor: 'pointer' }}>Pricing</span>
                <span style={{ cursor: 'pointer' }}>Blog</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
              <button onClick={() => { setIsLogin(true); setShowAuthForm(true); }} style={{ background: 'none', border: '1px solid #cbd5e1', padding: '10px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', color: '#0f172a' }}>Login</button>
              <button onClick={() => { setIsLogin(false); setShowAuthForm(true); }} style={{ background: '#0f172a', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', border: 'none', cursor: 'pointer', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>Sign Up</button>
            </div>
          </nav>

          {/* HERO SECTION */}
          <div style={{ padding: '80px 80px 120px', display: 'flex', alignItems: 'center', gap: '60px', maxWidth: '1400px', margin: '0 auto' }}>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: '72px', fontWeight: '900', lineHeight: '1.05', color: '#0f172a', marginBottom: '24px', letterSpacing: '-2px' }}>
                Optimize your <br/>tax refund with AI
              </h1>
              <p style={{ fontSize: '19px', color: '#475569', marginBottom: '40px', lineHeight: '1.6', maxWidth: '540px' }}>
                Leverage advanced artificial intelligence to identify every available deduction, maximize your write-offs, and ensure maximum compliance with ease.
              </p>
              <button onClick={() => { setIsLogin(false); setShowAuthForm(true); }} style={{ background: '#2563eb', color: '#fff', padding: '16px 36px', borderRadius: '12px', fontSize: '16px', fontWeight: '700', border: 'none', cursor: 'pointer', boxShadow: '0 10px 15px -3px rgba(37, 99, 235, 0.3)' }}>
                Get Started for Free ↗
              </button>
            </div>

            <div style={{ flex: 1.2, position: 'relative' }}>
              {/* DASHBOARD MOCKUP */}
              <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
                {/* Mock Header */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff5f57' }} />
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffbd2e' }} />
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#28c840' }} />
                </div>
                <div style={{ padding: '40px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '20px' }}>TAX DASHBOARD</div>
                  <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
                    <div style={{ flex: 1, padding: '20px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>Estimated refund</div>
                      <div style={{ fontSize: '32px', fontWeight: '800', color: '#0f172a' }}>$14,750</div>
                    </div>
                    <div style={{ flex: 1, padding: '20px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>Deductions found</div>
                      <div style={{ fontSize: '32px', fontWeight: '800', color: '#10b981' }}>$8,920</div>
                    </div>
                  </div>
                  {/* BAR CHART MOCK */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', height: '120px' }}>
                    {[40, 70, 45, 90, 65, 80, 55].map((h, i) => (
                      <div key={i} style={{ flex: 1, height: `${h}%`, background: h > 75 ? '#2563eb' : '#e2e8f0', borderRadius: '4px' }} />
                    ))}
                  </div>
                </div>
              </div>

              {/* CHAT BUBBLE OVERLAY */}
              <div style={{ position: 'absolute', bottom: '40px', right: '-20px', width: '280px', background: '#fff', borderRadius: '16px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)', padding: '20px', border: '1px solid #e2e8f0', zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#fff' }}>✨</div>
                  <span style={{ fontSize: '13px', fontWeight: '700' }}>Wrytoff AI</span>
                </div>
                <div style={{ fontSize: '13px', color: '#334155', lineHeight: '1.4', background: '#f1f5f9', padding: '12px', borderRadius: '12px', borderBottomLeftRadius: '2px' }}>
                  Added home office deduction: <span style={{ fontWeight: 'bold' }}>+$300/mo</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={{ minHeight: '100vh', display: 'flex', background: '#0f172a', color: '#f8fafc', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ margin: 'auto', width: '100%', maxWidth: '400px', padding: '40px', background: '#1e293b', borderRadius: '16px', border: '1px solid #334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: '600', color: '#10b981', margin: 0 }}>Wrytoff</h2>
            <span onClick={() => setShowAuthForm(false)} style={{ fontSize: '12px', color: '#94a3b8', cursor: 'pointer' }}>Close</span>
          </div>
          
          <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={{ padding: '12px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', outline: 'none' }} />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required style={{ padding: '12px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', outline: 'none' }} />
            
            {error && <div style={{ color: '#ef4444', fontSize: '13px' }}>{error}</div>}
            
            <button type="submit" disabled={authLoading} style={{ background: '#10b981', color: '#022c22', padding: '12px', borderRadius: '8px', fontWeight: '600', border: 'none', cursor: 'pointer', marginTop: '8px' }}>
              {authLoading ? 'Loading...' : (isLogin ? 'Sign In' : 'Create Account')}
            </button>
          </form>
          
          <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <span onClick={() => setIsLogin(!isLogin)} style={{ color: '#3b82f6', cursor: 'pointer' }}>
              {isLogin ? 'Sign up' : 'Sign in'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // 2) ONBOARDING / MISSING PROFILE
  if (needsOnboarding) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', background: '#0f172a', color: '#f8fafc', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ margin: 'auto', width: '100%', maxWidth: '400px', padding: '40px', background: '#1e293b', borderRadius: '16px', border: '1px solid #334155' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '24px', color: '#fff' }}>Welcome to Wrytoff</h2>
          <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>What is your business name?</label>
              <input type="text" placeholder="Acme Consulting LLC" value={companyName} onChange={e => setCompanyName(e.target.value)} required style={{ width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', outline: 'none' }} />
            </div>
            
            <div>
              <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>How are you taxed?</label>
              <select value={businessType} onChange={e => setBusinessType(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', outline: 'none' }}>
                <option value="single-member LLC">Single-member LLC / Sole Prop</option>
                <option value="S-Corp">S-Corp</option>
                <option value="Partnership">Partnership</option>
              </select>
            </div>
            
            {error && <div style={{ color: '#ef4444', fontSize: '13px' }}>{error}</div>}
            
            <button type="submit" disabled={authLoading} style={{ background: '#3b82f6', color: '#fff', padding: '12px', borderRadius: '8px', fontWeight: '600', border: 'none', cursor: 'pointer', marginTop: '10px' }}>
              {authLoading ? 'Saving...' : 'Complete Profile'}
            </button>
            <button type="button" onClick={handleLogout} style={{ background: 'transparent', color: '#94a3b8', border: 'none', cursor: 'pointer', fontSize: '12px', marginTop: '8px' }}>Log out</button>
          </form>
        </div>
      </div>
    );
  }

  // 3) AUTHENTICATED & ONBOARDED
  return (
    <>
      {/* We uniquely pass the handleLogout directly so the user can log out from the dashboard */}
      <WrytoffTaxOptimizer userProfile={userProfile} onLogout={handleLogout} />
    </>
  );
}
