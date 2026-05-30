import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useState } from 'react';
import './styles/tokens.css';
import './styles/global.css';
import Landing from './pages/Landing';

const Placeholder = ({ name }) => (
  <div style={{ padding: 40, color: 'var(--ink-2)', fontFamily: 'var(--mono)' }}>
    {name} 페이지 — 개발 예정
  </div>
);

export default function App() {
  const [address, setAddress] = useState(null);

  const handleConnect = async () => {
    if (!window.ethereum) {
      alert('MetaMask가 설치되어 있지 않습니다.');
      return;
    }
    try {
      const [addr] = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });
      setAddress(addr);
    } catch (err) {
      console.error('지갑 연결 실패:', err);
    }
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing address={address} onConnect={handleConnect} />} />
        <Route path="/game" element={<Placeholder name="Game" />} />
        <Route path="/dashboard" element={<Placeholder name="Dashboard" />} />
        <Route path="/records" element={<Placeholder name="Records" />} />
        <Route path="/verify" element={<Placeholder name="Verify" />} />
      </Routes>
    </BrowserRouter>
  );
}
