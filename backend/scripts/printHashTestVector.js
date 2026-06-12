/**
 * 업적 dataHash 테스트 벡터 출력 스크립트
 * ----------------------------------------
 *  고정 입력 1세트의 (입력값 전체 + abi.encode 바이트 + keccak256 해시)를
 *  콘솔과 docs/hash-test-vector.md 양쪽에 출력한다.
 *
 *  용도: 컨트랙트팀이 Remix 에서 keccak256(abi.encode(...)) 로 동일 값을
 *  재현해 인코딩 스펙(타입·순서)이 바이트 단위로 일치하는지 검증한다.
 *
 *  실행: node scripts/printHashTestVector.js
 */

const fs = require('fs');
const path = require('path');
const { ACHIEVEMENT_PAYLOAD_TYPES } = require('../constants/achievements');
const { buildPayload, encodePayload, hashPayload } = require('../lib/achievementHash');

// 고정 테스트 벡터 입력 (변경 금지 — lib/achievementHash.test.js 스냅샷과 동일 세트)
//  시나리오: ID 4(천운) — 40회 시도 중 31회 성공, 블록 26,000,000 ~ 26,123,456 구간
const FIXED_INPUT = {
  wallet: '0xAbcDef0123456789abCdef0123456789ABCDEF01', // 대소문자 혼합 입력 → 소문자 정규화 확인용
  achievementId: 4,
  evidenceA: 31,   // ID 3/4: 성공수
  evidenceB: 40,   // ID 3/4: 시도수
  fromBlock: 26000000,
  toBlock: 26123456,
};

const payload = buildPayload(FIXED_INPUT);
const encoded = encodePayload(FIXED_INPUT);
const hash = hashPayload(FIXED_INPUT);

const md = `# 업적 dataHash 테스트 벡터 (컨트랙트팀 검증용)

> 이 파일은 \`node scripts/printHashTestVector.js\` 가 생성한다. 손으로 수정하지 말 것.
> 컨트랙트팀: 아래 Remix 스니펫으로 **동일한 해시**가 나오는지 확인해주세요.
> 일치하면 인코딩 스펙(타입·순서)이 바이트 단위로 합치된 것입니다.

## 인코딩 스펙

\`\`\`
dataHash = keccak256( abi.encode(
  address wallet, uint256 achievementId,
  uint256 evidenceA, uint256 evidenceB,
  uint256 fromBlock, uint256 toBlock
) )
\`\`\`

- **abi.encode** (동적 표준 인코딩) — \`abi.encodePacked\` 아님!
- 백엔드: ethers v6 \`AbiCoder.defaultAbiCoder().encode()\` + \`keccak256\`
- 타입·순서 정의처: \`constants/achievements.js\` 의 \`ACHIEVEMENT_PAYLOAD_TYPES\` (단일 정의)
- evidence 의미: ID 3,4 → A=성공수, B=시도수 / ID 5 → A=10강 이상 마리수, B=0

## 고정 입력값

| 필드 | 값 |
| --- | --- |
| wallet (입력) | \`${FIXED_INPUT.wallet}\` |
| wallet (정규화) | \`${payload.wallet}\` |
| achievementId | \`${payload.achievementId}\` (천운) |
| evidenceA (성공수) | \`${payload.evidenceA}\` |
| evidenceB (시도수) | \`${payload.evidenceB}\` |
| fromBlock | \`${payload.fromBlock}\` |
| toBlock | \`${payload.toBlock}\` |

## 결과

- **abi.encode 바이트** (${(encoded.length - 2) / 2} bytes):

\`\`\`
${encoded}
\`\`\`

- **dataHash (keccak256)**:

\`\`\`
${hash}
\`\`\`

## Remix 재현 스니펫 (Solidity)

\`\`\`solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract HashVectorCheck {
    function check() external pure returns (bytes32) {
        // 기대값: ${hash}
        return keccak256(abi.encode(
            address(${payload.wallet}),
            uint256(${payload.achievementId}),
            uint256(${payload.evidenceA}),
            uint256(${payload.evidenceB}),
            uint256(${payload.fromBlock}),
            uint256(${payload.toBlock})
        ));
    }
}
\`\`\`
`;

const outPath = path.join(__dirname, '..', 'docs', 'hash-test-vector.md');
fs.writeFileSync(outPath, md, 'utf8');

console.log('=== 업적 dataHash 테스트 벡터 ===');
console.log('타입·순서 :', JSON.stringify(ACHIEVEMENT_PAYLOAD_TYPES));
console.log('입력값    :', JSON.stringify(payload, null, 2));
console.log('abi.encode:', encoded);
console.log('dataHash  :', hash);
console.log(`→ ${path.relative(process.cwd(), outPath)} 에도 기록 완료`);
