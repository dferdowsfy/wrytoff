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

  // 1) NOT LOGGED IN
  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', background: '#0f172a', color: '#f8fafc', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ margin: 'auto', width: '100%', maxWidth: '400px', padding: '40px', background: '#1e293b', borderRadius: '16px', border: '1px solid #334155' }}>
          <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '8px', color: '#10b981' }}>Wrytoff</h2>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '24px' }}>Smarter write-offs. Confident decisions.</p>
          
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
