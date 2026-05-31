# 블록체인 프로젝트 (11조) Frontend

- [실행 방법](#-실행-방법)
- [폴더 구조](#-폴더-구조)
- [페이지별 기능](#-페이지별-기능)
- [기술 스택](#-기술-스택)

## 🚀 실행 방법

### 1. 의존성 설치

```bash
cd frontend
npm install
```

### 2. 환경 변수 설정

`frontend/` 폴더 바로 아래에 `.env` 파일을 만들고 내용 채우기<br>
(`.env` 내용은 단톡방에 공유되어있음)

| 변수                    | 설명                                            |
| ----------------------- | ----------------------------------------------- |
| `VITE_CONTRACT_ADDRESS` | 배포된 EnhancementGame 컨트랙트 주소            |
| `VITE_CHAIN_ID`         | Base Sepolia 체인 ID                            |
| `VITE_RPC_URL`          | 블록체인 RPC 엔드포인트                         |
| `VITE_API_BASE_URL`     | 백엔드 API 서버 주소 (Render 배포 후 변경 예정) |

### 3. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:5173` 접속하여 확인

> ⚠️ '게임', '내 기록' 페이지는 **MetaMask 지갑** 필요<br>
> 지갑 연결 후 Base Sepolia 네트워크로 연결하기 (상단 배너의 '전환하기' 버튼 클릭)

> ⚠️ 백엔드 서버가 켜져 있지 않으면 통계/기록 데이터는 `Network Error` 가 표시되는 것이 정상

## 📁 폴더 구조

```
frontend/
├── src/
│   ├── abi/         컨트랙트 ABI (EnhancementGameVRF.abi.json)
│   ├── api/         백엔드 API 통신 함수 (api.js)
│   ├── components/  공통 컴포넌트 (Header, Button, Card, Badge,
│   │                StageBar, CharacterStage, ProgressBar, TxHash, WalletModal)
│   ├── hooks/       useWallet(지갑 연결), useForge(컨트랙트 강화)
│   ├── pages/       Landing, Dashboard, Game, Records, Verify
│   ├── styles/      tokens.css(디자인 토큰), global.css(공통 스타일)
│   └── App.jsx      BrowserRouter + Routes
└── .env             환경 변수 (직접 생성)
```

## 📄 페이지별 기능

| 경로         | 페이지    | 지갑     | 설명                               |
| ------------ | --------- | -------- | ---------------------------------- |
| `/`          | Landing   | 불필요   | 서비스 소개 랜딩 페이지            |
| `/game`      | Game      | **필요** | 고양이 강화 시도, 실시간 결과 확인 |
| `/dashboard` | Dashboard | 불필요   | 전체 누적 통계, 단계별 성공률 차트 |
| `/records`   | Records   | **필요** | 내 강화 기록 (성공/실패, TX 해시)  |
| `/verify`    | Verify    | 불필요   | Attempt ID로 온체인 결과 검증      |

### 데이터 흐름

- **블록체인 직접 조회** (`useForge`): 아이템 레벨, 강화 대기 여부, 강화 트랜잭션 전송, VRF 결과 이벤트 수신
- **백엔드 API 조회** (`api.js`): 통계, 강화 기록 목록, VRF 검증, 확률표 이력

## 🛠️ 기술 스택

- **React** + **Vite** — UI 프레임워크 / 빌드 도구
- **React Router** — 페이지 라우팅
- **CSS Module** — 컴포넌트 단위 스타일링
- **ethers.js v6** — 블록체인 연동 (지갑, 컨트랙트 호출)
- **axios** — 백엔드 API 통신
- **Vercel** — 배포 (예정)
