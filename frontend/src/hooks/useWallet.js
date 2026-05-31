/**
 * ethers.js v6 기반 지갑 연결 훅
 *
 * 반환값
 * ------
 * address      string | null   — 현재 연결된 지갑 주소 (소문자)
 * provider     BrowserProvider | null
 * signer       JsonRpcSigner | null
 * chainId      number | null   — 현재 연결된 체인 ID
 * isConnecting boolean        — 연결 요청 진행 중
 * error        string | null   — 마지막 오류 메시지
 * connect      () => Promise<void>   — 지갑 연결
 * disconnect   () => void            — 지갑 해제 (로컬 상태만 초기화)
 * switchToBaseSepolia () => Promise<void>  — Base Sepolia 로 체인 전환
 */

import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider } from 'ethers';

// ─── 상수 ────────────────────────────────────────────────────────
const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 84532);

const BASE_SEPOLIA_PARAMS = {
  chainId: '0x' + TARGET_CHAIN_ID.toString(16),
  chainName: 'Base Sepolia Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [import.meta.env.VITE_RPC_URL ?? 'https://sepolia.base.org'],
  blockExplorerUrls: ['https://sepolia.basescan.org'],
};

// ─── 헬퍼 ────────────────────────────────────────────────────────
function getEthereum() {
  return typeof window !== 'undefined' ? window.ethereum : null;
}

// ─── 훅 ──────────────────────────────────────────────────────────
export function useWallet() {
  const [address, setAddress] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);

  // ── 내부: provider/signer/chainId 갱신 ──────────────────────────
  const _refresh = useCallback(async (ethProvider) => {
    const s = await ethProvider.getSigner();
    const net = await ethProvider.getNetwork();
    setSigner(s);
    setAddress((await s.getAddress()).toLowerCase());
    setChainId(Number(net.chainId));
  }, []);

  // ── 지갑 연결 ────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    const eth = getEthereum();
    if (!eth) {
      setError('MetaMask(또는 호환 지갑)가 설치되어 있지 않습니다.');
      return;
    }
    setError(null);
    setIsConnecting(true);
    try {
      await eth.request({ method: 'eth_requestAccounts' });
      const bp = new BrowserProvider(eth);
      setProvider(bp);
      await _refresh(bp);
    } catch (err) {
      setError(err?.message ?? '지갑 연결에 실패했습니다.');
    } finally {
      setIsConnecting(false);
    }
  }, [_refresh]);

  // ── 지갑 해제 (로컬 상태 초기화만) ──────────────────────────────
  const disconnect = useCallback(() => {
    setAddress(null);
    setProvider(null);
    setSigner(null);
    setChainId(null);
    setError(null);
  }, []);

  // ── Base Sepolia 전환 ─────────────────────────────────────────
  const switchToBaseSepolia = useCallback(async () => {
    const eth = getEthereum();
    if (!eth) return;
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_SEPOLIA_PARAMS.chainId }],
      });
    } catch (switchErr) {
      // 체인이 MetaMask에 등록되지 않은 경우 추가 시도
      if (switchErr.code === 4902) {
        try {
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [BASE_SEPOLIA_PARAMS],
          });
        } catch (addErr) {
          setError(addErr?.message ?? 'Base Sepolia 체인 추가에 실패했습니다.');
        }
      } else {
        setError(switchErr?.message ?? '체인 전환에 실패했습니다.');
      }
    }
  }, []);

  // ── 이미 연결된 계정 자동 감지 ──────────────────────────────────
  useEffect(() => {
    const eth = getEthereum();
    if (!eth) return;

    // 이미 연결 허용된 계정이 있으면 복원
    eth.request({ method: 'eth_accounts' }).then((accounts) => {
      if (accounts.length > 0) {
        const bp = new BrowserProvider(eth);
        setProvider(bp);
        _refresh(bp).catch(() => {});
      }
    });

    // ── MetaMask 이벤트 구독 ─────────────────────────────────────
    const onAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        disconnect();
      } else {
        const bp = new BrowserProvider(eth);
        setProvider(bp);
        _refresh(bp).catch(() => {});
      }
    };

    const onChainChanged = () => {
      // 체인 변경 시 페이지 새로고침
      window.location.reload();
    };

    const onDisconnect = () => disconnect();

    eth.on('accountsChanged', onAccountsChanged);
    eth.on('chainChanged', onChainChanged);
    eth.on('disconnect', onDisconnect);

    return () => {
      eth.removeListener('accountsChanged', onAccountsChanged);
      eth.removeListener('chainChanged', onChainChanged);
      eth.removeListener('disconnect', onDisconnect);
    };
  }, [_refresh, disconnect]);

  return {
    address,
    provider,
    signer,
    chainId,
    isConnecting,
    error,
    isCorrectChain: chainId === TARGET_CHAIN_ID,
    connect,
    disconnect,
    switchToBaseSepolia,
  };
}
