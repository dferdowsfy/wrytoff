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
  const [showAuthForm, setShowAuthForm] = useState(false);

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
      console.error(err);
      let msg = 'An unexpected error occurred. Please try again.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = 'Invalid email or password. Please try again.';
      } else if (err.code === 'auth/email-already-in-use') {
        msg = 'This email is already in use. Try signing in instead.';
      } else if (err.code === 'auth/weak-password') {
        msg = 'Password should be at least 6 characters.';
      } else if (err.code === 'auth/invalid-email') {
        msg = 'Please enter a valid email address.';
      }
      setError(msg);
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
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#fff', fontFamily: "'Inter', sans-serif" }}>Loading Wrytoff...</div>;
  }

  const handleLogout = () => signOut(auth);

  // 1) NOT LOGGED IN — SHOW LANDING OR FORM
  if (!user) {
    if (!showAuthForm) {
      return (
        <div style={{ minHeight: '100vh', background: 'linear-gradient(145deg, #f1f5f9 0%, #e2e8f0 100%)', color: '#1e293b', fontFamily: "'Inter', sans-serif", overflowX: 'hidden' }}>
          {/* TOP NAV */}
          <nav style={{ padding: '32px 80px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L3.5 7V17L12 22L20.5 17V7L12 2Z" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3.5 7L12 12L20.5 7" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 22V12" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.8px' }}>Wrytoff</span>
            </div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <button onClick={() => { setIsLogin(true); setShowAuthForm(true); }} style={{ background: 'none', border: '1px solid #cbd5e1', padding: '10px 28px', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', color: '#0f172a' }}>Login</button>
              <button onClick={() => { setIsLogin(false); setShowAuthForm(true); }} style={{ background: '#0f172a', color: '#fff', padding: '10px 28px', borderRadius: '10px', fontSize: '14px', fontWeight: '600', border: 'none', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>Sign Up</button>
            </div>
          </nav>

          {/* HERO SECTION */}
          <div style={{ padding: '60px 80px 100px', display: 'flex', alignItems: 'center', gap: '80px', maxWidth: '1400px', margin: '0 auto' }}>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: '80px', fontWeight: '900', lineHeight: '0.95', color: '#0f172a', marginBottom: '32px', letterSpacing: '-3px' }}>
                Optimize your <br/><span style={{ color: '#2563eb' }}>tax refund</span> <br/>with AI
              </h1>
              <p style={{ fontSize: '20px', color: '#475569', marginBottom: '44px', lineHeight: '1.5', maxWidth: '520px' }}>
                Maximize your write-offs, discover hidden deductions, and maximize your savings effortlessly with Wrytoff's intelligent platform.
              </p>
              <button onClick={() => { setIsLogin(false); setShowAuthForm(true); }} style={{ background: '#2563eb', color: '#fff', padding: '18px 40px', borderRadius: '14px', fontSize: '17px', fontWeight: '700', border: 'none', cursor: 'pointer', boxShadow: '0 12px 24px -6px rgba(37, 99, 235, 0.4)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                Get Started for Free <span style={{ fontSize: '20px' }}>↗</span>
              </button>
            </div>

            <div style={{ flex: 1.2, position: 'relative' }}>
              {/* Main Dashboard Mockup */}
              <div style={{ background: '#fff', borderRadius: '32px', border: '1px solid #e2e8f0', boxShadow: '0 40px 100px -20px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
                <div style={{ padding: '18px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff5f57' }} />
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffbd2e' }} />
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#28c840' }} />
                </div>
                <div style={{ padding: '48px 56px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
                    <div style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', letterSpacing: '1.2px' }}>ESTIMATED REFUND 2026</div>
                    <div style={{ height: '8px', width: '40px', borderRadius: '4px', background: '#e2e8f0' }} />
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '44px' }}>
                    <div>
                      <div style={{ fontSize: '56px', fontWeight: '900', color: '#0f172a', letterSpacing: '-2px', lineHeight: '1' }}>
                        $14,750
                        <span style={{ fontSize: '20px', color: '#10b981', marginLeft: '12px', fontWeight: '700', verticalAlign: 'top' }}>+$3,200</span>
                      </div>
                      <div style={{ fontSize: '14px', color: '#64748b', marginTop: '12px' }}>Current projected refund · Single filer</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Marginal Bracket</div>
                      <div style={{ fontSize: '18px', fontWeight: '800', color: '#2563eb' }}>24%</div>
                    </div>
                  </div>

                  <div style={{ padding: '24px', background: '#f8fafc', borderRadius: '20px', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', marginBottom: '20px', letterSpacing: '0.5px' }}>DEDUCTION SNAPSHOT</div>
                    <div style={{ display: 'flex', gap: '12px', height: '100px', alignItems: 'flex-end' }}>
                      {[35, 60, 40, 95, 55, 100, 50, 85].map((h, i) => (
                        <div key={i} style={{ flex: 1, height: `${h}%`, background: i === 5 ? '#2563eb' : '#e2e8f0', borderRadius: '6px', transition: 'height 0.3s ease' }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Chat Overlay (Updating Dashboard) */}
              <div style={{ position: 'absolute', bottom: '120px', left: '-50px', width: '310px', background: '#fff', borderRadius: '24px', boxShadow: '0 30px 60px -12px rgba(0,0,0,0.22)', padding: '20px', border: '1px solid #e2e8f0', zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>Wrytoff AI</span>
                </div>
                <div style={{ fontSize: '13px', color: '#334155', lineHeight: '1.5', background: '#f1f5f9', padding: '14px', borderRadius: '18px', borderBottomLeftRadius: '4px', marginBottom: '12px' }}>
                  "Add home office: <span style={{ fontWeight: '700' }}>$300/mo</span> and set WiFi to <span style={{ fontWeight: '700' }}>70%</span> biz use."
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontSize: '12px', fontWeight: '700' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                  Updating dashboard fields...
                </div>
              </div>

              {/* Optimization Intelligence Overlay */}
              <div style={{ position: 'absolute', top: '40px', right: '-60px', width: '290px', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', borderRadius: '24px', boxShadow: '0 30px 60px -12px rgba(0,0,0,0.3)', padding: '24px', border: '1px solid #334155', zIndex: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#10b98122', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '18px' }}>💡</span>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#fff' }}>Optimization Intelligence</span>
                </div>
                <div style={{ marginBottom: '18px' }}>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px', letterSpacing: '0.5px' }}>RECOMMENDATION</div>
                  <div style={{ fontSize: '14px', color: '#e2e8f0', fontWeight: '600', lineHeight: '1.4' }}>Contribute to SEP-IRA to maximize tax efficiency.</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff08', padding: '12px 16px', borderRadius: '12px', border: '1px solid #ffffff10' }}>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Potental Savings</div>
                  <div style={{ fontSize: '15px', fontWeight: '800', color: '#10b981' }}>+$1,200</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={{ minHeight: '100vh', display: 'flex', background: '#0f172a', color: '#f8fafc', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ margin: 'auto', width: '100%', maxWidth: '440px', padding: '48px', background: '#1e293b', borderRadius: '24px', border: '1px solid #334155', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
          <div style={{ marginBottom: '32px' }}>
            <span onClick={() => setShowAuthForm(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#94a3b8', cursor: 'pointer', marginBottom: '16px', fontWeight: '500' }}>
              ← Back to home
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L3.5 7V17L12 22L20.5 17V7L12 2Z" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3.5 7L12 12L20.5 7" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#fff', margin: 0, letterSpacing: '-0.5px' }}>Wrytoff</h2>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '15px' }}>{isLogin ? 'Welcome back! Sign in to your account.' : 'Create your account to start optimizing.'}</p>
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
      <div style={{ minHeight: '100vh', display: 'flex', background: '#0f172a', color: '#f8fafc', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ margin: 'auto', width: '100%', maxWidth: '440px', padding: '48px', background: '#1e293b', borderRadius: '24px', border: '1px solid #334155' }}>
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
      <WrytoffTaxOptimizer userProfile={userProfile} onLogout={handleLogout} />
    </>
  );
}
