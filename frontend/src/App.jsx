import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useWallet } from './hooks/useWallet';
import { Landing, Dashboard, Game, Records, Verify, Ranking } from './pages';
import './styles/tokens.css';
import './styles/global.css';

export default function App() {
  const wallet = useWallet();

  const sharedProps = {
    address: wallet.address,
    onConnect: wallet.connect,
    wallet,
  };

  return (
    <BrowserRouter>
      {/* 경고 배너 */}
      {wallet.address && !wallet.isCorrectChain && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: 'var(--ember-500, #ff7a1a)',
            color: '#fff',
            textAlign: 'center',
            padding: '10px 16px',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          ⚠ Base Sepolia (체인 ID 84532)에 연결해 주세요.&nbsp;
          <button
            onClick={wallet.switchToBaseSepolia}
            style={{
              background: '#fff',
              color: 'var(--ember-500, #ff7a1a)',
              border: 'none',
              borderRadius: 6,
              padding: '2px 12px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            전환하기
          </button>
        </div>
      )}
      <div style={{ paddingTop: wallet.address && !wallet.isCorrectChain ? 44 : 0 }}>
        <Routes>
          <Route path="/" element={<Landing {...sharedProps} />} />
          <Route path="/game" element={<Game {...sharedProps} />} />
          <Route path="/dashboard" element={<Dashboard {...sharedProps} />} />
          <Route path="/records" element={<Records {...sharedProps} />} />
          <Route path="/verify" element={<Verify {...sharedProps} />} />
          <Route path="/ranking" element={<Ranking {...sharedProps} />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
