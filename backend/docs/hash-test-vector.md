# 업적 dataHash 테스트 벡터 (컨트랙트팀 검증용)

> 이 파일은 `node scripts/printHashTestVector.js` 가 생성한다. 손으로 수정하지 말 것.
> 컨트랙트팀: 아래 Remix 스니펫으로 **동일한 해시**가 나오는지 확인해주세요.
> 일치하면 인코딩 스펙(타입·순서)이 바이트 단위로 합치된 것입니다.

## 인코딩 스펙

```
dataHash = keccak256( abi.encode(
  address wallet, uint256 achievementId,
  uint256 evidenceA, uint256 evidenceB,
  uint256 fromBlock, uint256 toBlock
) )
```

- **abi.encode** (동적 표준 인코딩) — `abi.encodePacked` 아님!
- 백엔드: ethers v6 `AbiCoder.defaultAbiCoder().encode()` + `keccak256`
- 타입·순서 정의처: `constants/achievements.js` 의 `ACHIEVEMENT_PAYLOAD_TYPES` (단일 정의)
- evidence 의미: ID 3,4 → A=성공수, B=시도수 / ID 5 → A=10강 이상 마리수, B=0

## 고정 입력값

| 필드 | 값 |
| --- | --- |
| wallet (입력) | `0xAbcDef0123456789abCdef0123456789ABCDEF01` |
| wallet (정규화) | `0xabcdef0123456789abcdef0123456789abcdef01` |
| achievementId | `4` (천운) |
| evidenceA (성공수) | `31` |
| evidenceB (시도수) | `40` |
| fromBlock | `26000000` |
| toBlock | `26123456` |

## 결과

- **abi.encode 바이트** (192 bytes):

```
0x000000000000000000000000abcdef0123456789abcdef0123456789abcdef010000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001f000000000000000000000000000000000000000000000000000000000000002800000000000000000000000000000000000000000000000000000000018cba8000000000000000000000000000000000000000000000000000000000018e9cc0
```

- **dataHash (keccak256)**:

```
0xeb63454cd7ffa48cf0e34c4d2a0d97a414c5f9b774827f2d55979a464a4dcafc
```

## Remix 재현 스니펫 (Solidity)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract HashVectorCheck {
    function check() external pure returns (bytes32) {
        // 기대값: 0xeb63454cd7ffa48cf0e34c4d2a0d97a414c5f9b774827f2d55979a464a4dcafc
        return keccak256(abi.encode(
            address(0xabcdef0123456789abcdef0123456789abcdef01),
            uint256(4),
            uint256(31),
            uint256(40),
            uint256(26000000),
            uint256(26123456)
        ));
    }
}
```
