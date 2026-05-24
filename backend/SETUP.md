# SETUP — 백엔드 로컬 환경 구축 가이드

> 새 팀원이 본인 PC(Windows 11)에서 백엔드를 처음부터 동일하게 띄울 수 있게 정리한 문서.
> 이미 한 번 구축 완료된 환경(2026-05-24, 전형재 PC 기준)을 그대로 재현한다.
>
> 본 가이드는 학습용 로컬 환경 기준이다. 운영 배포는 별도 문서 필요.

---

## 0. 요구 사양

| 항목 | 버전 / 조건 |
| --- | --- |
| OS | Windows 10/11 (다른 OS는 PostgreSQL 설치 방법만 다름, 이후 단계 동일) |
| Node.js | v20 LTS 이상 (현재 환경 v24.16.0 — `node --watch` 내장 사용) |
| npm | v10+ (Node에 동봉) |
| PostgreSQL | 16.x (현재 환경 16.14) |
| winget | Windows 10 1809+ 기본 탑재. 없으면 Microsoft Store에서 "앱 설치 관리자" 설치. |
| 디스크 여유 | 약 2GB (PostgreSQL 본체 ~1.5GB + node_modules ~200MB + 여유분) |
| 관리자 권한 | PostgreSQL 설치 시 UAC 1회 |

```powershell
# 사전 확인
node --version    # v20 이상이어야 함
npm --version
winget --version
```

---

## 1. PostgreSQL 16 설치 (한 번만)

### 1-1. winget으로 silent 설치

```powershell
winget install --id PostgreSQL.PostgreSQL.16 --exact --source winget --silent `
  --accept-package-agreements --accept-source-agreements `
  --override "--mode unattended --unattendedmodeui none --superpassword postgres --servicename postgresql-x64-16 --serverport 5432 --enable-components server,commandlinetools"
```

- 5~10분 소요 (다운로드 ~350MB + 압축 해제 + initdb + 서비스 등록)
- **UAC 프롬프트가 한 번 뜬다** — "예" 선택
- VC++ Redistributable 설치 창이 추가로 뜰 수 있다 (자동 진행)
- 슈퍼유저 비밀번호: `postgres` (위 명령에 명시한 임시값 — 곧 앱 사용자 별도 생성)
- 설치 위치: `C:\Program Files\PostgreSQL\16\`
- 서비스: `postgresql-x64-16` (Automatic 시작)

### 1-2. 설치 검증

```powershell
Get-Service postgresql-x64-16        # Status: Running, StartType: Automatic
Get-NetTCPConnection -LocalPort 5432 -State Listen   # 0.0.0.0:5432 Listen

$env:PGPASSWORD = "postgres"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h localhost -d postgres -c "SELECT version();"
Remove-Item env:PGPASSWORD
# PostgreSQL 16.14 ... 출력되면 OK
```

### 1-3. PATH (선택)

매번 전체 경로 치기 귀찮으면 `C:\Program Files\PostgreSQL\16\bin` 을 시스템 PATH 에 추가.
PowerShell 재시작 후 `psql --version` 으로 확인.

---

## 2. 앱 사용자 + DB 생성 (한 번만)

> 본 프로젝트는 슈퍼유저 `postgres` 가 아니라 **권한이 제한된 앱 전용 사용자 `khu_user`** 로 DB에 접속한다.
> 비밀번호는 각자 PC 마다 새로 생성하고 `.env` 에만 저장한다. **절대 git 에 커밋 금지.**

### 2-1. 강한 비밀번호 생성

PowerShell 에서 32자 랜덤 비밀번호 생성 (`[a-zA-Z0-9_-]` 만 사용 — URL/SQL/.env 모두 safe):

```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$chars = [char[]]'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
$pw = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
# $pw 에 비밀번호 저장됨. 이 PowerShell 세션에서만 유효.
```

### 2-2. 1회용 init SQL 작성 후 실행 (실행 직후 삭제)

`backend/db/init_user.sql.tmp` 파일을 임시로 만든다:

```sql
CREATE USER khu_user WITH PASSWORD :'khu_password';
CREATE DATABASE khu_blockchain OWNER khu_user ENCODING 'UTF8' TEMPLATE template0;
GRANT ALL PRIVILEGES ON DATABASE khu_blockchain TO khu_user;
```

같은 PowerShell 세션 (`$pw` 가 살아있는 동안) 에서 실행:

```powershell
$env:PGPASSWORD = "postgres"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" `
  -v ON_ERROR_STOP=1 -U postgres -h localhost -d postgres `
  -v "khu_password=$pw" -f .\db\init_user.sql.tmp
Remove-Item env:PGPASSWORD
Remove-Item .\db\init_user.sql.tmp     # 즉시 삭제 (비밀번호 placeholder 누수 방지)
```

### 2-3. khu_user 접속 검증

```powershell
$env:PGPASSWORD = $pw
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U khu_user -h localhost -d khu_blockchain -c "SELECT current_user, current_database();"
# khu_user | khu_blockchain  출력되면 OK
```

---

## 3. `.env` 파일 작성 (각자 PC 마다)

`backend/.env.example` 을 참고하여 `backend/.env` 를 작성한다.

> `.env` 는 `backend/.gitignore` 6번 줄에서 차단됨 — git 에 커밋되지 않는다.
> `git check-ignore -v backend/.env` 로 매번 확인 가능.

같은 PowerShell 세션에서 자동 작성:

```powershell
$envContent = @"
DATABASE_URL=postgres://khu_user:$pw@localhost:5432/khu_blockchain
PORT=3000
RPC_URL=
CONTRACT_ADDRESS=
POLL_INTERVAL_MS=12000
BATCH_SIZE=1000
CONFIRMATION_BLOCKS=5
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText("D:\project\BlockchainProject\backend\.env", $envContent, $utf8NoBom)

$pw = $null                # 메모리에서 비밀번호 변수 정리
Remove-Item env:PGPASSWORD
```

**중요**: `.env` 는 반드시 **BOM 없는 UTF-8** 로 저장해야 한다. PowerShell 기본 `Set-Content -Encoding utf8` 은 BOM 을 포함하여 일부 dotenv 버전이 첫 변수 이름을 잘못 파싱한다 (`﻿DATABASE_URL`). 위 `[System.IO.File]::WriteAllText` + `UTF8Encoding $false` 방식이 BOM 없는 UTF-8 을 보장한다.

### 환경변수 의미

| 키 | 의미 | 비고 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 접속 문자열 | 비밀번호 포함, 절대 커밋 금지 |
| `PORT` | Express API 서버 포트 | 기본 3000 |
| `RPC_URL` | 이더리움 RPC 엔드포인트 | Sepolia 컨트랙트 배포 후 채움 |
| `CONTRACT_ADDRESS` | 강화 컨트랙트 주소 | 컨트랙트 팀이 배포 후 공유 |
| `POLL_INTERVAL_MS` | 인덱서 폴링 주기 (ms) | 평균 블록타임 12초 기준 |
| `BATCH_SIZE` | `getLogs` 1회 조회 블록 범위 | 1000 권장 (RPC 한도 안전값) |
| `CONFIRMATION_BLOCKS` | reorg 안전 버퍼 블록 수 | 5 (메인넷 5~12) |

---

## 4. DB 스키마 적용 (한 번만)

`backend/db/schema.sql` 을 `khu_user` 권한으로 실행하면 4개 테이블 + 11개 인덱스 + `indexer_cursor` 초기 행 1개가 생성된다.

```powershell
# .env 의 DATABASE_URL 에서 비밀번호 추출하거나, PGPASSWORD 환경변수로 전달
$env:PGPASSWORD = "여기에 .env 의 비밀번호"   # 또는 위 단계의 $pw 가 살아있다면 그것
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" `
  -v ON_ERROR_STOP=1 -U khu_user -h localhost -d khu_blockchain `
  -f .\db\schema.sql
Remove-Item env:PGPASSWORD
```

### 검증

```powershell
$env:PGPASSWORD = "비밀번호"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U khu_user -h localhost -d khu_blockchain -c "\dt"
# 4개 테이블: attempts, indexer_cursor, probability_history, user_items
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U khu_user -h localhost -d khu_blockchain -c "SELECT * FROM indexer_cursor;"
# main | 0 | <timestamp>  한 행 출력되면 OK
Remove-Item env:PGPASSWORD
```

`schema.sql` 은 `CREATE TABLE IF NOT EXISTS` + `INSERT ... ON CONFLICT DO NOTHING` 으로 작성되어 있어 여러 번 실행해도 안전 (멱등).

---

## 5. Node 의존성 설치

`backend/` 디렉터리에서:

```powershell
npm install
```

- 약 1~2분 소요
- 94개 패키지 설치됨 (`cors`, `dotenv`, `ethers`, `express`, `pg` + transitive)
- `package-lock.json` 자동 생성 — **이건 git 에 커밋한다** (의존성 버전 고정)
- `node_modules/` 는 `.gitignore` 에 포함 → 자동 제외

`npm audit` 결과 moderate 2건은 dev-only 또는 영향도 낮은 경고로 학습용 환경에서는 무시. 본구현 단계에서 `npm audit fix` 검토 예정.

---

## 6. 서버 실행 + 라우트 검증

```powershell
npm run dev      # node --watch api/server.js (파일 수정 시 자동 재시작)
# 또는
npm start        # node api/server.js (재시작 없음)
```

부팅 메시지: `[api] 서버 부팅 완료 (v2.0): http://localhost:3000`

다른 터미널에서 7개 라우트 모두 응답 확인:

```powershell
curl.exe http://localhost:3000/health
# {"status":"ok","service":"khu-blockchain-backend","version":"2.0","timestamp":"..."}

curl.exe http://localhost:3000/api/stats/by-level
curl.exe http://localhost:3000/api/stats/global
curl.exe http://localhost:3000/api/stats/user/0xabcdef0123456789abcdef0123456789abcdef01
curl.exe http://localhost:3000/api/attempts/recent
curl.exe http://localhost:3000/api/attempts/1
curl.exe "http://localhost:3000/api/probability/history?level=7"
# 위 6개는 모두 501 not_implemented (stub — 발표 후 본구현 예정)
```

> PowerShell 의 `curl` 은 `Invoke-WebRequest` 별칭이라 `-w`/`-s` 옵션이 다르다. Windows 10/11 기본 탑재된 진짜 curl 을 `curl.exe` 로 호출해야 한다.

---

## 자주 발생하는 에러와 해결

### A. winget 설치가 msstore 약관 프롬프트에서 멈춤

```text
모든 원본 사용 약관에 동의하십니까? [Y] 예  [N] 아니요:
```

원인: `winget show` 같은 명령이 msstore 소스를 건드릴 때 약관 동의를 요구.
해결: `--source winget` 명시 + `--accept-source-agreements` 플래그.

### B. UAC 가 안 보임

위치 확인:
1. 작업 표시줄에 노란/파란 깜빡임 (UAC 창이 다른 화면에 숨어있을 수 있음)
2. `Get-Process consent -ErrorAction SilentlyContinue` 로 `consent.exe` 살아있는지 확인
3. Win+Tab / Alt+Tab 으로 UAC 창 가져오기

### C. PostgreSQL 설치가 10분 넘게 안 끝남

- `$env:TEMP\installbuilder_installer.log` 의 마지막 줄 확인
- `Unpacking ...\pgAdmin 4\runtime\resources\app\node_modules\...` 가 계속 나오면 정상 (pgAdmin Electron 의 작은 파일 수만 개 압축 해제 중). 5~10분 더 기다림.
- 인스톨러 프로세스 CPU 활동이 계속 늘면 stuck 아님.

### D. `psql: password authentication failed for user "khu_user"`

- `$env:PGPASSWORD` 누락 또는 잘못된 값.
- `.env` 의 비밀번호와 실제 DB 의 비밀번호 불일치. 다시 만들려면:
  ```sql
  -- 슈퍼유저 postgres 로 접속하여:
  ALTER USER khu_user WITH PASSWORD '<새비밀번호>';
  ```
  그 다음 `.env` 의 `DATABASE_URL` 비밀번호 부분도 함께 바꿔야 한다.

### E. `psql: connection to server at "localhost" (::1), port 5432 failed`

- 서비스 안 떠 있음: `Start-Service postgresql-x64-16`
- 포트 충돌: `Get-NetTCPConnection -LocalPort 5432` 로 점유 프로세스 확인 후 정리

### F. dotenv 가 첫 변수를 이상하게 읽음 (예: `process.env.DATABASE_URL` undefined)

- `.env` 가 BOM 포함 UTF-8 일 가능성. **BOM 없는 UTF-8** 로 다시 저장 (3절 참고).

### G. `EACCES` / `EPERM` (npm install 권한 오류)

- 관리자 PowerShell 에서 다시 시도하거나, `%APPDATA%\npm-cache` 권한 점검.

### H. `CREATE USER` 시 `:'khu_password'` 구문 오류

- `DO $$ ... $$` PL/pgSQL 블록 안에서는 psql 의 `:'변수'` 치환이 **동작하지 않는다**. plain SQL 문장으로 작성할 것 (2-2 절 예시 참고).

### I. SQL 일부 실패해도 psql 이 exit 0 으로 반환

- `psql` 호출에 **반드시 `-v ON_ERROR_STOP=1`** 옵션을 준다. 첫 오류 발생 시 즉시 exit 1.

---

## 환경 정리 (재구축 필요 시)

DB 만 초기화하고 새로 만들고 싶을 때:

```powershell
$env:PGPASSWORD = "postgres"
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"

# 1) DB 삭제 (연결 중인 세션 모두 강제 종료 후 drop)
& $psql -U postgres -h localhost -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='khu_blockchain' AND pid <> pg_backend_pid();"
& $psql -U postgres -h localhost -d postgres -c "DROP DATABASE IF EXISTS khu_blockchain;"

# 2) 사용자 삭제
& $psql -U postgres -h localhost -d postgres -c "DROP USER IF EXISTS khu_user;"

Remove-Item env:PGPASSWORD
```

그 다음 2절부터 다시 실행.

---

## 참고 문서

- [README.md](./README.md) — 프로젝트 개요, 차별화 포인트, 8개 라우트 명세
- [docs/events.md](./docs/events.md) — 컨트랙트 팀 합의 완료된 3개 이벤트 명세 (v2.0)
- [docs/design_decisions.md](./docs/design_decisions.md) — V1→V2 단순화 결정 기록
- [db/schema.sql](./db/schema.sql) — DB 스키마 + 자료형 매핑 근거 (주석)
