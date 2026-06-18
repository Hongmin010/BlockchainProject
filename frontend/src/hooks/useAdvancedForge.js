import { useState, useCallback, useEffect, useRef } from 'react';
import { Contract, JsonRpcProvider } from 'ethers';
import ABI from '../abi/AdvancedEnhancementGameVRF.abi.json';

const CONTRACT_ADDRESS = import.meta.env.VITE_ADVANCED_CONTRACT_ADDRESS;
const RPC_URL = import.meta.env.VITE_RPC_URL;

// 상급 강화 결과 타입 (컨트랙트 AdvancedResultType enum과 동일)
export const AdvancedResultType = {
  FailKeep: 0, // 실패, 레벨 유지 (Risky 강화 실패 / Safe 강화 5강에서 실패)
  Success: 1, // 성공 +1
  SafeDowngrade: 2, // Safe 강화 실패, 레벨 -1
  Destroyed: 3, // Risky 강화 파괴, 5강으로 복귀
  Guaranteed: 4, // Safe 강화 보장 성공 (연속 하락 2회 후)
};

// 상급 강화 모드
export const AdvancedMode = {
  Safe: 0,
  Risky: 1,
};

// 컨트랙트 AdvancedEnhancement.sol 상수와 동일 (기본 5강 + extra 15 = 최종 20강)
export const MAX_EXTRA_LEVEL = 15;
export const MAX_TOTAL_LEVEL = 20;

function getContract(signerOrProvider) {
  return new Contract(CONTRACT_ADDRESS, ABI, signerOrProvider);
}

// 컨트랙트에 선언된 상급 강화 확률표를 온체인에서 직접 읽어온다.
// 백엔드를 거치지 않으므로 화면의 숫자가 곧 온체인 값 — 누구나 컨트랙트로 검증 가능하다.
// 지갑 미연결 상태에서도 표가 보이도록 provider가 없으면 공개 RPC로 폴백한다.
//
// 30개를 한꺼번에 쏘면 공개 RPC가 rate-limit으로 빈 응답(CALL_EXCEPTION)을 주므로,
// 배칭을 끄고(batchMaxCount:1) 각 모드를 한 단계씩 순차로 읽되, 두 모드만 병렬로 돌린다
// (동시성 2-wide ≈ 4초). 정적 데이터라 1회만 로드한다.
//
// 반환: { safe: [{ successProb, destroyProb }, ...], risky: [...] }
//   - 각 배열 index = extraLevel(0 ~ MAX_EXTRA_LEVEL-1), 값 단위 = % (bp ÷ 100)
export async function fetchDeclaredAdvancedRates(provider = null) {
  const reader =
    provider ?? new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true, batchMaxCount: 1 });
  const contract = getContract(reader);
  const readMode = async (mode) => {
    const rows = [];
    for (let extraLevel = 0; extraLevel < MAX_EXTRA_LEVEL; extraLevel++) {
      const [successRateBps, destroyRateBps] = await contract.advancedRates(mode, extraLevel);
      rows.push({
        successProb: Number(successRateBps) / 100,
        destroyProb: Number(destroyRateBps) / 100,
      });
    }
    return rows;
  };
  const [safe, risky] = await Promise.all([
    readMode(AdvancedMode.Safe),
    readMode(AdvancedMode.Risky),
  ]);
  return { safe, risky };
}

export function useAdvancedForge({ signer, provider, address }) {
  const [extraLevel, setExtraLevel] = useState(0);
  const [safeDropStreak, setSafeDropStreak] = useState(0);
  const [isGuaranteed, setIsGuaranteed] = useState(false);
  const [isRiskyBlocked, setIsRiskyBlocked] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState('idle');
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);

  const listenerRef = useRef(null);

  // 총 레벨 = 5 + extraLevel
  const totalLevel = 5 + extraLevel;

  // ── 상태 조회 ─────────────────────────────────────────────
  const refreshState = useCallback(
    async (itemId = 1) => {
      if (!provider || !address) return;
      try {
        const contract = getContract(provider);
        const [extra, streak, pendingId, guaranteed, riskyBlocked] = await Promise.all([
          contract.getAdvancedExtraLevel(address, itemId),
          contract.getSafeDropStreak(address, itemId),
          contract.getPendingAttemptId(address, itemId),
          contract.isNextSafeEnhancementGuaranteed(address, itemId),
          contract.isRiskyEnhancementBlocked(address, itemId),
        ]);
        setExtraLevel(Number(extra));
        setSafeDropStreak(Number(streak));
        setIsPending(Number(pendingId) !== 0);
        setIsGuaranteed(guaranteed);
        setIsRiskyBlocked(riskyBlocked);
      } catch (err) {
        console.error('[useAdvancedForge] refreshState 오류:', err);
      }
    },
    [provider, address]
  );

  // 지갑 연결/변경 시 자동 조회
  useEffect(() => {
    if (!address || !provider) return;
    const contract = getContract(provider);
    Promise.all([
      contract.getAdvancedExtraLevel(address, 1),
      contract.getSafeDropStreak(address, 1),
      contract.getPendingAttemptId(address, 1),
      contract.isNextSafeEnhancementGuaranteed(address, 1),
      contract.isRiskyEnhancementBlocked(address, 1),
    ])
      .then(([extra, streak, pendingId, guaranteed, riskyBlocked]) => {
        setExtraLevel(Number(extra));
        setSafeDropStreak(Number(streak));
        setIsPending(Number(pendingId) !== 0);
        setIsGuaranteed(guaranteed);
        setIsRiskyBlocked(riskyBlocked);
      })
      .catch(console.error);
  }, [address, provider]);

  // ── AdvancedEnhancementResult 이벤트 리스닝 ──────────────
  const _startListening = useCallback(
    (itemId) => {
      if (!provider || !address) return;
      const contract = getContract(provider);

      if (listenerRef.current) {
        contract.off('AdvancedEnhancementResult', listenerRef.current);
      }

      const handler = (
        attemptId,
        user,
        evItemId,
        vrfRequestId,
        mode,
        beforeExtraLevel,
        afterExtraLevel,
        beforeTotalLevel,
        afterTotalLevel,
        resultType,
        beforeSafeDropStreak,
        afterSafeDropStreak,
        guaranteed,
        successRateBps,
        destroyRateBps,
        randomValue,
        rollBps,
        event
      ) => {
        if (user.toLowerCase() !== address.toLowerCase() || Number(evItemId) !== Number(itemId))
          return;

        const rt = Number(resultType);
        setLastResult({
          resultType: rt,
          mode: Number(mode),
          beforeExtraLevel: Number(beforeExtraLevel),
          afterExtraLevel: Number(afterExtraLevel),
          beforeTotalLevel: Number(beforeTotalLevel),
          afterTotalLevel: Number(afterTotalLevel),
          beforeSafeDropStreak: Number(beforeSafeDropStreak),
          afterSafeDropStreak: Number(afterSafeDropStreak),
          guaranteed,
          successRateBps: Number(successRateBps),
          destroyRateBps: Number(destroyRateBps),
          txHash: event?.log?.transactionHash ?? '',
          success: rt === AdvancedResultType.Success || rt === AdvancedResultType.Guaranteed,
        });

        const newStreak = Number(afterSafeDropStreak);
        setExtraLevel(Number(afterExtraLevel));
        setSafeDropStreak(newStreak);
        setIsGuaranteed(newStreak >= 2);
        setIsRiskyBlocked(newStreak >= 2);
        setIsPending(false);
        setStatus('done');

        contract.off('AdvancedEnhancementResult', handler);
        listenerRef.current = null;

        refreshState(itemId);
      };

      contract.on('AdvancedEnhancementResult', handler);
      listenerRef.current = handler;
    },
    [provider, address, refreshState]
  );

  // ── 상급 강화 실행 ────────────────────────────────────────
  const forge = useCallback(
    async (itemId = 1, mode = AdvancedMode.Safe, proof = []) => {
      if (!signer || !address) {
        setError('지갑이 연결되어 있지 않습니다.');
        return;
      }
      if (isPending) {
        setError('이미 강화가 진행 중입니다. VRF 결과를 기다려 주세요.');
        return;
      }
      if (extraLevel >= MAX_EXTRA_LEVEL) {
        setError('이미 최고 레벨입니다.');
        return;
      }
      if (mode === AdvancedMode.Risky && isRiskyBlocked) {
        setError('Safe 보장 강화를 먼저 사용해야 합니다.');
        return;
      }

      setError(null);
      setLastResult(null);
      setStatus('waiting_tx');

      try {
        const contract = getContract(signer);
        const tx = await contract.requestAdvancedEnhancementWithProof(itemId, mode, proof);

        setIsPending(true);
        setStatus('waiting_vrf');
        _startListening(itemId);

        const receipt = await tx.wait(1);
        console.log('[useAdvancedForge] tx confirmed:', receipt.hash);
      } catch (err) {
        console.error('[useAdvancedForge] forge 오류:', err);
        setIsPending(false);
        setStatus('idle');

        if (err?.code === 4001 || err?.code === 'ACTION_REJECTED') {
          setError('트랜잭션이 취소되었습니다.');
        } else if (err?.reason) {
          setError(`컨트랙트 오류: ${err.reason}`);
        } else {
          setError(err?.message ?? '강화 트랜잭션 전송에 실패했습니다.');
        }
      }
    },
    [signer, address, isPending, extraLevel, isRiskyBlocked, _startListening]
  );

  // ── 언마운트 시 이벤트 리스너 정리 ───────────────────────
  useEffect(() => {
    return () => {
      if (listenerRef.current && provider) {
        const contract = getContract(provider);
        contract.off('AdvancedEnhancementResult', listenerRef.current);
      }
    };
  }, [provider]);

  return {
    extraLevel,
    totalLevel,
    safeDropStreak,
    isGuaranteed,
    isRiskyBlocked,
    isPending,
    status,
    lastResult,
    error,
    forge,
    refreshState,
  };
}
