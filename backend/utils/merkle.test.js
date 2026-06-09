/**
 * ============================================================
 *  utils/merkle.js 단위 테스트 — node:test (Node 18+ 내장)
 *  실행: npm test
 * ============================================================
 *
 *  네트워크/DB 의존성 0 — 커밋된 merkle/allowlist.json 만 사용.
 *  핵심: 등록된 모든 leaf 의 proof 가 컨트랙트 검증 알고리즘(정렬-쌍 keccak)으로
 *  root 까지 재구성되는지 로컬에서 검증한다. 이는 온체인 isValidEnhancementProof
 *  통과와 동치이며, RPC 없이 회귀 테스트 가능.
 * ============================================================
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');

const { getProof, getInfo, getRoot, computeLeaf } = require('./merkle');
const allowlist = require('../merkle/allowlist.json');

const USER_DEMO = '0x9a7f7f7e990474659211526fca723f46d0e89aff'; // item 1~100 등록
const DEAD = '0x000000000000000000000000000000000000dead';

// 컨트랙트 MerkleProof.sol processProof 재현 (a<b ? hash(a,b):hash(b,a))
function processProof(leaf, proof) {
  let h = leaf;
  for (const p of proof) {
    const [a, b] = h.toLowerCase() <= p.toLowerCase() ? [h, p] : [p, h];
    h = ethers.keccak256(ethers.concat([a, b]));
  }
  return h.toLowerCase();
}


// ------------------------------------------------------------
//  메타 (getInfo / getRoot)
// ------------------------------------------------------------
test('getInfo: allowlist.json 과 root/count/type 일치', () => {
  const info = getInfo();
  assert.equal(info.root, String(allowlist.merkleRoot).toLowerCase());
  assert.equal(info.count, allowlist.entries.length);
  assert.equal(info.enhancementType, allowlist.enhancementType);
});

test('getRoot: 0x + 64 hex 형식', () => {
  assert.match(getRoot(), /^0x[0-9a-f]{64}$/);
});


// ------------------------------------------------------------
//  leaf 인코딩 (컨트랙트 getEnhancementLeaf 동일성)
// ------------------------------------------------------------
test('computeLeaf: keccak256(abi.encode(address,uint256,uint8))', () => {
  const expected = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256', 'uint8'], [USER_DEMO, 3n, 0]),
  );
  assert.equal(computeLeaf(USER_DEMO, '3', 0), expected);
});

test('computeLeaf: itemId 가 string 이든 number 든 동일', () => {
  assert.equal(computeLeaf(USER_DEMO, '7', 0), computeLeaf(USER_DEMO, 7, 0));
});


// ------------------------------------------------------------
//  proof 정확성 — 핵심 (등록 leaf 전부 root 로 재구성)
// ------------------------------------------------------------
test('getProof: 등록된 101개 leaf 의 proof 가 전부 root 로 재구성됨', () => {
  const root = getRoot();
  const type = allowlist.enhancementType;
  let checked = 0;
  for (const e of allowlist.entries) {
    const { registered, leaf, proof } = getProof(e.user, e.itemId, type);
    assert.equal(registered, true, `${e.user}/${e.itemId} 는 등록돼야 함`);
    assert.equal(computeLeaf(e.user, e.itemId, type), leaf);
    assert.equal(processProof(leaf, proof), root, `${e.user}/${e.itemId} proof 가 root 로 안 모임`);
    checked += 1;
  }
  assert.equal(checked, allowlist.entries.length);
});


// ------------------------------------------------------------
//  미등록 처리
// ------------------------------------------------------------
test('getProof: 미등록 지갑 → registered=false, proof=null', () => {
  const r = getProof(DEAD, '3', 0);
  assert.equal(r.registered, false);
  assert.equal(r.proof, null);
});

test('getProof: 등록 지갑이라도 미등록 itemId 면 false', () => {
  assert.equal(getProof(USER_DEMO, '999999', 0).registered, false);
});

test('getProof: 등록 지갑이라도 다른 enhancementType 이면 false (type 0만 등록)', () => {
  assert.equal(getProof(USER_DEMO, '3', 1).registered, false);
});

test('getProof: type 미지정 시 allowlist 기본 type 으로 처리', () => {
  const explicit = getProof(USER_DEMO, '3', allowlist.enhancementType);
  const implicit = getProof(USER_DEMO, '3');
  assert.equal(implicit.registered, explicit.registered);
  assert.equal(implicit.leaf, explicit.leaf);
});
