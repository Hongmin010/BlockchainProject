/**
 * EnhancementGame 컨트랙트 강화 훅
 *
 * 주요 기능
 * ─────────
 * 1. getItemLevel()        — 아이템 레벨 조회
 * 2. getPendingAttemptId() — 미완료 강화 대기 여부 확인
 * 3. requestEnhancement()  — 강화 트랜잭션 전송
 * 4. EnhancementResult 이벤트 리스닝 — VRF 결과 수신
 *
 * 반환값
 * ──────
 * level        number          — 현재 아이템 레벨
 * isPending    boolean         — 강화 대기 중(VRF 미수신)
 * status       'idle' | 'waiting_tx' | 'waiting_vrf' | 'done'
 * lastResult   { success, beforeLevel, afterLevel, txHash } | null
 * error        string | null
 * forge        (itemId, enhancementType?) => Promise<void>
 * refreshState (itemId) => Promise<void>
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Contract } from 'ethers';
import ABI from '../abi/EnhancementGameVRF.abi.json';

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;

// ─── 헬퍼 ────────────────────────────────────────────────────────
function getContract(signerOrProvider) {
  return new Contract(CONTRACT_ADDRESS, ABI, signerOrProvider);
}

// ─── 훅 ──────────────────────────────────────────────────────────
export function useForge({ signer, provider, address }) {
  const [level, setLevel] = useState(0);
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState('idle');
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);

  // 이벤트 리스너 정리용 ref
  const listenerRef = useRef(null);

  // ── 아이템 상태 조회 ─────────────────────────────────────────
  const refreshState = useCallback(
    async (itemId = 1) => {
      if (!provider || !address) return;
      try {
        const contract = getContract(provider);

        const [lvl, pendingId] = await Promise.all([
          contract.getItemLevel(address, itemId),
          contract.getPendingAttemptId(address, itemId),
        ]);
        setLevel(Number(lvl));
        setIsPending(Number(pendingId) !== 0);
      } catch (err) {
        console.error('[useForge] refreshState 오류:', err);
      }
    },
    [provider, address]
  );

  // 지갑 연결/변경 시 자동 조회
  useEffect(() => {
    if (!address || !provider) return;

    const contract = getContract(provider);

    Promise.all([contract.getItemLevel(address, 1), contract.getPendingAttemptId(address, 1)])
      .then(([lvl, pendingId]) => {
        setLevel(Number(lvl));
        setIsPending(Number(pendingId) !== 0);
      })
      .catch(console.error);
  }, [address, provider]);

  // ── EnhancementResult 이벤트 리스닝 ─────────────────────────
  const _startListening = useCallback(
    (itemId) => {
      if (!provider || !address) return;
      const contract = getContract(provider);

      // 이전 리스너 제거
      if (listenerRef.current) {
        contract.off('EnhancementResult', listenerRef.current);
      }

      const handler = (
        attemptId,
        user,
        evItemId,
        vrfRequestId,
        evBeforeLevel,
        afterLevel,
        resultType,
        successRateBps,
        randomValue,
        event
      ) => {
        // 내 주소 + 내 아이템인지 확인
        if (user.toLowerCase() !== address.toLowerCase() || Number(evItemId) !== Number(itemId))
          return;

        const success = Number(resultType) === 1;
        setLastResult({
          success,
          beforeLevel: Number(evBeforeLevel),
          afterLevel: Number(afterLevel),
          txHash: event.log?.transactionHash ?? '',
          randomValue: randomValue.toString(),
          successRateBps: Number(successRateBps),
        });
        setLevel(Number(afterLevel));
        setIsPending(false);
        setStatus('done');

        // 리스너 자체 제거
        contract.off('EnhancementResult', handler);
        listenerRef.current = null;

        // 최신 온체인 상태 재동기화
        refreshState(itemId);
      };

      contract.on('EnhancementResult', handler);
      listenerRef.current = handler;
    },
    [provider, address, refreshState]
  );

  // ── 강화 실행 ────────────────────────────────────────────────
  const forge = useCallback(
    async (itemId = 1, enhancementType = 0, proof = []) => {
      if (!signer || !address) {
        setError('지갑이 연결되어 있지 않습니다.');
        return;
      }
      if (isPending) {
        setError('이미 강화가 진행 중입니다. VRF 결과를 기다려 주세요.');
        return;
      }
      if (level >= 5) {
        setError('이미 최고 레벨입니다.');
        return;
      }

      setError(null);
      setLastResult(null);
      setStatus('waiting_tx');

      try {
        const contract = getContract(signer);
        // proof가 있으면 Merkle gate 통과 버전으로 호출 (첫 강화)
        const tx =
          proof.length > 0
            ? await contract.requestEnhancementWithProof(itemId, enhancementType, proof)
            : await contract.requestEnhancement(itemId, enhancementType);

        // 트랜잭션 전송 완료 → VRF 대기 상태로 전환
        setIsPending(true);
        setStatus('waiting_vrf');

        // 이벤트 리스너 등록
        _startListening(itemId);

        // 트랜잭션 컨펌 대기 (선택적 — UI에서 txHash 표시용)
        const receipt = await tx.wait(1);
        console.log('[useForge] tx confirmed:', receipt.hash);
      } catch (err) {
        console.error('[useForge] forge 오류:', err);
        setIsPending(false);
        setStatus('idle');

        // 사용자 거부(4001) / 기타 구분
        if (err?.code === 4001 || err?.code === 'ACTION_REJECTED') {
          setError('트랜잭션이 취소되었습니다.');
        } else if (err?.reason) {
          setError(`컨트랙트 오류: ${err.reason}`);
        } else {
          setError(err?.message ?? '강화 트랜잭션 전송에 실패했습니다.');
        }
      }
    },
    [signer, address, isPending, level, _startListening]
  );

  // ── 언마운트 시 이벤트 리스너 정리 ──────────────────────────
  useEffect(() => {
    return () => {
      if (listenerRef.current && provider) {
        const contract = getContract(provider);
        contract.off('EnhancementResult', listenerRef.current);
      }
    };
  }, [provider]);

  return {
    level,
    isPending,
    status,
    lastResult,
    error,
    forge,
    refreshState,
  };
}
