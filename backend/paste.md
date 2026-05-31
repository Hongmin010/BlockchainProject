# 작업: 온체인 고양이 강화 게임 (단일 HTML)

## 컨텍스트
- 팀 프로젝트: 게임 강화 확률을 온체인에서 검증하는 시스템
- 사용자 시나리오: 지갑 연결 → 강화 시도 → 컨트랙트가 VRF로 결과 생성 → UI에 반영
- 핵심 가치: 모든 강화 결과가 온체인에 기록되어 누구나 검증 가능
- 같은 백엔드 서버가 게임 UI와 통계 API를 함께 서빙 (같은 origin)

## 위치
- 레포 `backend` 브랜치
- 경로: `backend/public/game/index.html` (단일 HTML 파일)
- 백엔드 서버에서 정적 서빙 (`app.use('/game', express.static('public/game'))` 한 줄 추가)
- 접근 URL: `http://localhost:PORT/game`

## 기술 제약
- 단일 HTML 파일 (CSS, JS 인라인 또는 같은 폴더 분리 둘 다 OK)
- 빌드 도구 없음 (webpack, vite 등 사용 금지)
- 외부 라이브러리는 CDN으로만 (ethers.js v6 CDN 등)
- 이미지 파일 사용 금지 → SVG 인라인으로 처리
- 모던 브라우저 기준, 데스크탑만 (모바일 반응형 불필요)

## 기능 요구사항

### 1. 지갑 연결
- MetaMask 감지 및 연결 버튼
- 연결된 주소 표시 (축약형: 0x1234...abcd)
- 네트워크 체크 (테스트넷 chainId는 환경변수 또는 상수)
- 잘못된 네트워크면 전환 요청
- 계정 변경, 네트워크 변경 이벤트 처리
- 연결 끊김 처리

### 2. 게임 UI
- 등급 +0 ~ +10
- 등급별 SVG 고양이 (인라인 SVG, 등급 올라갈수록 시각적 변화)
- 현재 등급, 강화석 잔액, 다음 등급 성공 확률 표시
- 강화 버튼 → 트랜잭션 전송 → 대기 → 결과 표시
- 강화 성공/실패 애니메이션, 이펙트

### 3. 트랜잭션 라이프사이클
- 4가지 상태 모두 UI에 표시
  - `idle`: 강화 가능
  - `pending`: 지갑 서명 대기
  - `mining`: 트랜잭션 채굴 대기
  - `confirmed` / `failed`: 결과 표시
- 트랜잭션 해시 표시 + 익스플로러 링크
- VRF 결과는 별도 이벤트로 수신 (`EnhanceResult` 이벤트 리스닝)
- 결과 수신 전까지 로딩 상태 유지

### 4. 에러 처리
- 사용자 서명 거부
- 가스 부족
- 컨트랙트 revert (사유 표시)
- 네트워크 오류 / RPC 실패
- 모든 에러를 사용자 친화 메시지로 변환

### 5. 온체인 상태 조회
- 페이지 진입 시 컨트랙트에서 사용자 상태 읽어옴
  - 현재 등급: `getCurrentLevel(address)`
  - 강화석: `getStones(address)`
  - 등급별 확률: `getProbability(uint8)`
- 새로고침해도 온체인 데이터 기준으로 복원

### 6. 통계 패널 (백엔드 API)
- GET `/api/stats/by-level` 호출 (같은 서버, 상대경로 OK)
- 응답 예시 구조:
```json
  [
    { "level": 0, "attempts": 1240, "successes": 992, "publishedProb": 0.80, "observedProb": 0.800 },
    { "level": 1, "attempts": 980,  "successes": 735, "publishedProb": 0.75, "observedProb": 0.750 }
  ]
```
- 공개 확률 vs 관측 확률 비교 표시
- 5~10초 간격 폴링으로 실시간 업데이트
- API 미응답 시 그래프 영역에 안내 메시지 (전체 페이지는 동작)

## 컨트랙트 인터페이스 (가정 — 컨트랙트 팀과 확정 필요)
```solidity
function enhance() external payable returns (uint256 requestId);
function getCurrentLevel(address user) external view returns (uint8);
function getStones(address user) external view returns (uint256);
function getProbability(uint8 level) external view returns (uint256); // basis points (10000 = 100%)

event EnhanceRequested(address indexed user, uint256 indexed requestId, uint8 currentLevel);
event EnhanceResult(address indexed user, uint256 indexed requestId, bool success, uint8 newLevel);
```

## 설정값 (코드 상단 상수로 관리)
```js
const CONTRACT_ADDRESS = '0x...';
const CHAIN_ID = 11155111; // Sepolia 예시
const EXPLORER_BASE = 'https://sepolia.etherscan.io';
const STATS_API = '/api/stats/by-level';
const POLL_INTERVAL_MS = 7000;
```
배포 시 위 값들만 교체할 수 있게 상단에 모아둘 것.

## 안 해도 되는 것
- 사용자 인증 (지갑 주소가 ID)
- 모바일 반응형
- 다국어
- 라우팅 (단일 페이지)
- 빌드/번들링

## 산출물
1. `backend/public/game/index.html` — 게임 UI 전체
2. 백엔드 서버에 정적 서빙 추가 코드 스니펫 (Express 가정)
3. 컨트랙트 ABI를 어디서 받아와야 하는지 명시 (이주안/홍민 협의 필요)
4. 환경변수 또는 상수 교체 가이드