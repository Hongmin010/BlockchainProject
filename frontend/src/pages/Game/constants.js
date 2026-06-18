import { AdvancedResultType } from '../../hooks/useAdvancedForge';
import destroyImage from '../../assets/cats/destroy.png';

// Game 페이지 전용 공용 상수

// 상남자(Risky) 강화 파괴 시 5레벨로 떨어지기 직전 잠깐 보여주는 연출용 이미지.
// glob은 *.png를 전부 수집하지만, 아래 CAT_IMAGES는 숫자 이름만 골라 담으므로 레벨 이미지엔 섞이지 않는다.
export const DESTROY_IMAGE = destroyImage;

// 레벨별 고양이 이미지 (src/assets/cats/{level}.png).
// Vite가 폴더 안 png를 빌드 시 자동 수집 → 파일을 추가하면 코드 수정 없이 인식됨.
const catImageModules = import.meta.glob('../../assets/cats/*.png', {
  eager: true,
  import: 'default',
});
// 숫자 이름(0~20.png)만 수집한다. destroy.png 등 숫자가 아닌 파일은 제외.
const CAT_IMAGES = Object.fromEntries(
  Object.entries(catImageModules)
    .map(([path, url]) => [path.match(/\/(\d+)\.png$/)?.[1], url])
    .filter(([level]) => level != null)
    .map(([level, url]) => [Number(level), url])
);
const MAX_CAT_IMAGE_LEVEL = Math.max(...Object.keys(CAT_IMAGES).map(Number));

// 해당 레벨의 고양이 이미지 경로를 반환. 레벨 0~최대 범위로 클램프해 항상 이미지를 보장.
export function catImageForLevel(level) {
  const clamped = Math.max(0, Math.min(level ?? 0, MAX_CAT_IMAGE_LEVEL));
  return CAT_IMAGES[clamped];
}

// 상급 결과 타입별 표시 정보
export const ADV_RESULT_INFO = {
  [AdvancedResultType.FailKeep]:      { label: '✕ 실패 (유지)',  logStyle: 'logFail',       badgeStyle: 'resultFail' },
  [AdvancedResultType.Success]:       { label: '✓ 성공!',        logStyle: 'logSuccess',    badgeStyle: 'resultSuccess' },
  [AdvancedResultType.SafeDowngrade]: { label: '↓ 단계 하락',    logStyle: 'logDowngrade',  badgeStyle: 'resultDowngrade' },
  [AdvancedResultType.Destroyed]:     { label: '💥 파괴!',        logStyle: 'logDestroyed',  badgeStyle: 'resultDestroyed' },
  [AdvancedResultType.Guaranteed]:    { label: '🌟 보장 성공!',   logStyle: 'logGuaranteed', badgeStyle: 'resultGuaranteed' },
};
