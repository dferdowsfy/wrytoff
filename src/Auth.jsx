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
      return <LandingScrollytelling onLogin={() => { setIsLogin(true); setShowAuthForm(true); }} onSignUp={() => { setIsLogin(false); setShowAuthForm(true); }} />;
    }

    return (
      <div style={{ minHeight: '100vh', display: 'flex', background: '#0f172a', color: '#f8fafc', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ margin: 'auto', width: '100%', maxWidth: '440px', padding: '48px', background: '#1e293b', borderRadius: '24px', border: '1px solid #334155', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
          <div style={{ marginBottom: '32px' }}>
            <div onClick={() => setShowAuthForm(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#94a3b8', cursor: 'pointer', marginBottom: '24px', fontWeight: '500' }}>
              ← Back to home
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L3.5 7V17L12 22L20.5 17V7L12 2Z" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3.5 7L12 12L20.5 7" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#fff', margin: 0, letterSpacing: '-0.5px' }}>Wrytoff</h2>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '15px' }}>{isLogin ? 'Welcome back! Sign in to your account.' : 'Create your account to start optimizing.'}</p>
          </div>
          
          <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={{ padding: '12px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', outline: 'none' }} />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required style={{ padding: '12px', borderRadius: '8px', border: '1px solid #475569', background: '#0f172a', color: '#fff', outline: 'none' }} />
            
            {error && <div style={{ color: '#ef4444', fontSize: '13px' }}>{error}</div>}
            
            <button type="submit" disabled={authLoading} style={{ background: '#2563eb', color: '#fff', padding: '12px', borderRadius: '8px', fontWeight: '600', border: 'none', cursor: 'pointer', marginTop: '8px' }}>
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

// ──────────────────────────────────────────────────────────────────────────────
// LANDING SCROLLYTELLING COMPONENT
// ──────────────────────────────────────────────────────────────────────────────
function LandingScrollytelling({ onLogin, onSignUp }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setStep(parseInt(entry.target.getAttribute('data-step')));
        }
      });
    }, { threshold: 0.6 });

    document.querySelectorAll('.scroll-step').forEach(s => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ background: '#f8fafc', color: '#0f172a', fontFamily: "'Inter', sans-serif" }}>
      {/* Fixed Nav */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, padding: '24px 80px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1000, background: 'rgba(248,250,252,0.8)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L3.5 7V17L12 22L20.5 17V7L12 2Z" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3.5 7L12 12L20.5 7" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.5px' }}>Wrytoff</span>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onLogin} style={{ background: 'none', border: 'none', padding: '8px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', color: '#475569' }}>Login</button>
          <button onClick={onSignUp} style={{ background: '#0f172a', color: '#fff', padding: '10px 24px', borderRadius: '10px', fontSize: '14px', fontWeight: '600', border: 'none', cursor: 'pointer' }}>Get Started</button>
        </div>
      </nav>

      <div style={{ display: 'flex', maxWidth: '1400px', margin: '0 auto' }}>
        {/* LEFT COLUMN: SCROLLING STORY */}
        <div style={{ flex: 1, padding: '0 80px' }}>
          <section className="scroll-step" data-step="0" style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h1 style={{ fontSize: '72px', fontWeight: '900', lineHeight: '1', letterSpacing: '-3px', marginBottom: '24px' }}>
              Optimize your <br/><span style={{ color: '#2563eb' }}>tax refund</span> <br/>with AI
            </h1>
            <p style={{ fontSize: '20px', color: '#475569', lineHeight: '1.6', maxWidth: '440px' }}>
              Wrytoff bridges the gap between your raw data and IRS-ready optimizations through simple conversation.
            </p>
            <div style={{ marginTop: '40px', display: 'flex', gap: '10px' }}>
              <div style={{ width: '40px', height: '4px', background: '#2563eb', borderRadius: '2px' }} />
              <div style={{ width: '20px', height: '4px', background: '#e2e8f0', borderRadius: '2px' }} />
            </div>
          </section>

          <section className="scroll-step" data-step="1" style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ color: '#2563eb', fontWeight: '800', fontSize: '12px', letterSpacing: '2px', marginBottom: '16px' }}>STEP 01</div>
            <h2 style={{ fontSize: '48px', fontWeight: '800', letterSpacing: '-2px', marginBottom: '20px' }}>Update via chat</h2>
            <p style={{ fontSize: '18px', color: '#475569', lineHeight: '1.6', maxWidth: '440px' }}>
              Just tell Wrytoff what changed. No forms, no complicated spreadsheets. Type like you talk.
            </p>
          </section>

          <section className="scroll-step" data-step="2" style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ color: '#2563eb', fontWeight: '800', fontSize: '12px', letterSpacing: '2px', marginBottom: '16px' }}>STEP 02</div>
            <h2 style={{ fontSize: '48px', fontWeight: '800', letterSpacing: '-2px', marginBottom: '20px' }}>Real-time sync</h2>
            <p style={{ fontSize: '18px', color: '#475569', lineHeight: '1.6', maxWidth: '440px' }}>
              Watch as Wrytoff parses your request and updates the dashboard fields instantly, annualizing expenses automatically.
            </p>
          </section>

          <section className="scroll-step" data-step="3" style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ color: '#2563eb', fontWeight: '800', fontSize: '12px', letterSpacing: '2px', marginBottom: '16px' }}>STEP 03</div>
            <h2 style={{ fontSize: '48px', fontWeight: '800', letterSpacing: '-2px', marginBottom: '20px' }}>Live impact</h2>
            <p style={{ fontSize: '18px', color: '#475569', lineHeight: '1.6', maxWidth: '440px' }}>
              The refund engine recalculates your liability in milliseconds, showing the exact tax impact of every deduction.
            </p>
          </section>

          <section className="scroll-step" data-step="4" style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ color: '#2563eb', fontWeight: '800', fontSize: '12px', letterSpacing: '2px', marginBottom: '16px' }}>STEP 04</div>
            <h2 style={{ fontSize: '48px', fontWeight: '800', letterSpacing: '-2px', marginBottom: '20px' }}>Optimization AI</h2>
            <p style={{ fontSize: '18px', color: '#475569', lineHeight: '1.6', maxWidth: '440px' }}>
              Wrytoff doesn't just record data—it scans for opportunities like SEP-IRA contributions and home office missed flags.
            </p>
            <button onClick={onSignUp} style={{ alignSelf: 'flex-start', background: '#2563eb', color: '#fff', padding: '16px 36px', borderRadius: '12px', fontSize: '16px', fontWeight: '700', border: 'none', cursor: 'pointer', marginTop: '40px', boxShadow: '0 10px 20px -5px rgba(37,99,235,0.4)' }}>
              Maximize Your Savings Now
            </button>
          </section>
        </div>

        {/* RIGHT COLUMN: STICKY PRODUCT INTERFACE */}
        <div style={{ flex: 1.2, position: 'relative' }}>
          <div style={{ position: 'sticky', top: '15vh', height: '70vh', display: 'flex', alignItems: 'center' }}>
            <StickyDashboard step={step} />
          </div>
        </div>
      </div>
      
      <div style={{ height: '20vh' }} />
    </div>
  );
}

function StickyDashboard({ step }) {
  const refundValue = step >= 3 ? 15410 : 14580;
  const homeOfficeVal = step >= 2 ? '$3,600/yr' : '—';
  const wifiVal = step >= 2 ? '70%' : '10%';
  
  return (
    <div style={{ width: '100%', perspective: '1200px' }}>
      <div style={{ 
        background: '#fff', borderRadius: '32px', border: '1px solid #e2e8f0', 
        boxShadow: '0 40px 100px -20px rgba(0,0,0,0.12)', 
        overflow: 'hidden', padding: '0',
        transform: `rotateY(-5deg) rotateX(2deg) translateY(${step === 0 ? '20px' : '0'})`,
        opacity: step === 0 ? 0.7 : 1,
        transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: '6px', background: '#f8fafc' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff5f5733' }} />
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffbd2e33' }} />
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#28c84033' }} />
        </div>

        <div style={{ padding: '48px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '40px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', letterSpacing: '1px', marginBottom: '8px' }}>ESTIMATED POSITION</div>
              <div style={{ fontSize: '56px', fontWeight: '900', color: '#0f172a', letterSpacing: '-2px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                ${refundValue.toLocaleString()}
                <div style={{ 
                  fontSize: '18px', background: '#10b981', color: '#fff', padding: '4px 12px', borderRadius: '20px', fontWeight: '700',
                  opacity: step === 3 ? 1 : 0, transform: step === 3 ? 'scale(1)' : 'scale(0.8)', transition: 'all 0.5s'
                }}>+$830</div>
              </div>
            </div>
          </div>

          <div style={{ border: '1px solid #f1f5f9', borderRadius: '16px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600' }}>VENDOR</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: '600' }}>VALUE</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>Home Office</td>
                  <td style={{ padding: '12px 16px', fontWeight: '700', color: step >= 2 ? '#2563eb' : '#94a3b8', transition: 'color 0.4s' }}>{homeOfficeVal}</td>
                </tr>
                <tr>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>Internet/WiFi (Biz %)</td>
                  <td style={{ padding: '12px 16px', fontWeight: '700', color: step >= 2 ? '#2563eb' : '#94a3b8', transition: 'color 0.4s' }}>{wifiVal}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ 
        position: 'absolute', top: '50%', left: '-80px', width: '300px', 
        background: '#fff', borderRadius: '20px', border: '1px solid #e2e8f0', 
        padding: '20px', boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
        opacity: step >= 1 ? 1 : 0, transform: step >= 1 ? 'translateY(0)' : 'translateY(20px)',
        transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>⚡</div>
          <span style={{ fontSize: '12px', fontWeight: '800' }}>Wrytoff AI</span>
        </div>
        <div style={{ fontSize: '13px', background: '#f1f5f9', padding: '12px', borderRadius: '14px', lineHeight: '1.4' }}>
          "Add my home office at $300/mo and set wifi to 70% biz use"
        </div>
      </div>

      <div style={{ 
        position: 'absolute', top: '20px', right: '-40px', width: '280px', 
        background: '#0f172a', borderRadius: '20px', color: '#fff',
        padding: '24px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)',
        opacity: step >= 4 ? 1 : 0, transform: step >= 4 ? 'scale(1)' : 'scale(0.9)',
        transition: 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        zIndex: 51
      }}>
        <div style={{ color: '#10b981', fontSize: '11px', fontWeight: '800', letterSpacing: '1px', marginBottom: '8px' }}>OPTIMIZATION DETECTED</div>
        <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '12px' }}>SEP-IRA Contribution</div>
        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>Potental Refund Increase</div>
          <div style={{ fontSize: '18px', fontWeight: '800', color: '#10b981' }}>+$1,200</div>
        </div>
      </div>
    </div>
  );
}
