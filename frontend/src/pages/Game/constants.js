import { AdvancedResultType } from '../../hooks/useAdvancedForge';

// Game 페이지 전용 공용 상수

export const CAT_EMOJIS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

// 상급 결과 타입별 표시 정보
export const ADV_RESULT_INFO = {
  [AdvancedResultType.FailKeep]:      { label: '✕ 실패 (유지)',  logStyle: 'logFail',       badgeStyle: 'resultFail' },
  [AdvancedResultType.Success]:       { label: '✓ 성공!',        logStyle: 'logSuccess',    badgeStyle: 'resultSuccess' },
  [AdvancedResultType.SafeDowngrade]: { label: '↓ 단계 하락',    logStyle: 'logDowngrade',  badgeStyle: 'resultDowngrade' },
  [AdvancedResultType.Destroyed]:     { label: '💥 파괴!',        logStyle: 'logDestroyed',  badgeStyle: 'resultDestroyed' },
  [AdvancedResultType.Guaranteed]:    { label: '🌟 보장 성공!',   logStyle: 'logGuaranteed', badgeStyle: 'resultGuaranteed' },
};
