/**
 * ============================================================
 *  Merkle proof 발급 유틸 (allowlist 게이트 대응)
 * ============================================================
 *
 *  배경
 *  ----
 *  배포된 컨트랙트는 `merkleRoot` 가 설정되어 있어, 등록된
 *  (user, itemId, enhancementType) 조합만 강화할 수 있다
 *  (`requestEnhancementWithProof` + Merkle proof 필수).
 *  프론트엔드가 이 proof 를 컨트랙트에 넘기려면 백엔드가 발급해야 한다.
 *
 *  트리 구성 (컨트랙트와 100% 일치 — 온체인 root 로 검증됨)
 *  ------------------------------------------------------
 *   - leaf      = keccak256(abi.encode(address user, uint256 itemId, uint8 type))
 *                 (컨트랙트 `getEnhancementLeaf` 와 동일)
 *   - 내부 노드 = keccak256(sortedPair(a, b))   (a < b ? (a,b) : (b,a))
 *                 (컨트랙트 `MerkleProof.sol` `_hashPair` 와 동일 — OZ 표준)
 *   - 홀수 노드 = promote (다음 레벨로 승격, 중복 해시 안 함)
 *   - leaf 순서 = merkle/allowlist.json `entries` 배열 순서 (트리 구조 결정)
 *
 *  source of truth
 *  ---------------
 *  `merkle/allowlist.json` — 온체인 merkleRoot 에 커밋된 등록 목록의 복원본.
 *  모듈 로드 시 트리를 빌드하고 computed root === allowlist.merkleRoot 를
 *  자가검증한다(불일치 시 throw → 서버 부팅 실패로 조기 노출).
 *  온체인 root 가 바뀌면 allowlist.json 을 재생성해야 한다.
 * ============================================================
 */

'use strict';

const { ethers } = require('ethers');
const allowlist = require('../merkle/allowlist.json');

const coder = ethers.AbiCoder.defaultAbiCoder();

/** leaf = keccak256(abi.encode(address, uint256, uint8)) — getEnhancementLeaf 동일 */
function computeLeaf(user, itemId, type) {
  return ethers.keccak256(
    coder.encode(['address', 'uint256', 'uint8'], [user, BigInt(itemId), Number(type)]),
  );
}

/** 내부 노드 해시: keccak256(sorted(a, b)) — MerkleProof.sol _hashPair 동일 */
function hashPair(a, b) {
  const [x, y] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([x, y]));
}

// ------------------------------------------------------------
//  트리 캐시 (lazy singleton) — 최초 호출 시 1회 빌드 후 메모리 보관
// ------------------------------------------------------------
let _tree = null;

function buildTree() {
  if (_tree) return _tree;

  const type = allowlist.enhancementType;
  const leaves = allowlist.entries.map((e) => computeLeaf(e.user, e.itemId, type));

  // leaf → index 역인덱스 (proof 생성 시 위치 조회용)
  const indexByLeaf = new Map();
  leaves.forEach((lf, i) => { if (!indexByLeaf.has(lf)) indexByLeaf.set(lf, i); });

  // 레벨별 노드 배열 (levels[0]=leaves, ..., 마지막=[root])
  const levels = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]); // promote-odd
    }
    levels.push(next);
    level = next;
  }
  const root = (level[0] || ethers.ZeroHash).toLowerCase();

  // 자가검증: 복원한 트리의 root 가 allowlist.json 에 박힌 온체인 root 와 같아야 함
  const expected = String(allowlist.merkleRoot).toLowerCase();
  if (root !== expected) {
    throw new Error(`[merkle] 빌드 root(${root}) != allowlist merkleRoot(${expected}) — allowlist.json 재생성 필요`);
  }

  _tree = { levels, root, indexByLeaf };
  return _tree;
}

/** levels 트리에서 index 위치 leaf 의 proof(형제 해시 배열) 추출 */
function proofForIndex(levels, index) {
  const proof = [];
  let idx = index;
  for (let l = 0; l < levels.length - 1; l += 1) {
    const level = levels[l];
    const pairIdx = idx % 2 === 1 ? idx - 1 : idx + 1;
    if (pairIdx < level.length) proof.push(level[pairIdx]); // 형제 존재 시만 (promote 케이스 제외)
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/**
 * (user, itemId, type) 에 대한 Merkle proof 발급.
 * @returns {{ registered: boolean, leaf: string, proof: string[]|null }}
 */
function getProof(user, itemId, type) {
  const tree = buildTree();
  const t = type === undefined || type === null ? allowlist.enhancementType : Number(type);
  const leaf = computeLeaf(user, itemId, t);
  if (!tree.indexByLeaf.has(leaf)) return { registered: false, leaf, proof: null };
  return { registered: true, leaf, proof: proofForIndex(tree.levels, tree.indexByLeaf.get(leaf)) };
}

/** 진단/부팅 로그용 메타 */
function getInfo() {
  const tree = buildTree();
  return {
    contract: allowlist.contract,
    root: tree.root,
    enhancementType: allowlist.enhancementType,
    count: allowlist.entries.length,
  };
}

module.exports = { getProof, getInfo, getRoot: () => buildTree().root, computeLeaf };
