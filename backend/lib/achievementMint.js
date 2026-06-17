/**
 * ============================================================
 *  업적 NFT mint 호출 모듈 (오프체인 판정 업적 ID 3, 4, 5 전용)
 * ============================================================
 *
 *  흐름: status='detected'(또는 'failed' 재시도)
 *        → 'minting' (선점 가드 — 동시 실행 방지)
 *        → mintAchievement(to, achievementId, dataHash) 호출
 *        → 성공: tx_hash 저장 + 'minted' / 실패: 'failed' + last_error 보관 (재시도 가능)
 *
 *  모드
 *  ----
 *  - MOCK_MINT=true : 실호출 대신 결정적 가짜 tx_hash 로 전 흐름 검증.
 *    (minter 지갑 key 도착 전 기본 운용 모드)
 *  - 실모드: .env 의 PRIVATE_KEY(서버 지갑) + ACHIEVEMENTS_NFT_ADDRESS + RPC_URL.
 *    ⚠️ PRIVATE_KEY 는 절대 로그/응답에 노출하지 않는다.
 *
 *  컨트랙트 접근은 전부 abi/achievements.fragment.json 경유 —
 *  실제 ABI 도착 시 그 파일만 교체하면 된다.
 */

const { ethers } = require('ethers');
const ACHIEVEMENTS_FRAGMENT = require('../abi/achievements.fragment.json');

/** 호출 시점 평가 (테스트에서 env 토글 가능하도록 모듈 로드 시 고정하지 않음) */
function isMockMode() {
  return String(process.env.MOCK_MINT).toLowerCase() === 'true';
}

/** 실모드 컨트랙트 인스턴스 (서버 지갑 서명). env 미비 시 명확한 에러. */
function getContract() {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;
  const address = process.env.ACHIEVEMENTS_NFT_ADDRESS;
  if (!rpcUrl || !privateKey || !address) {
    throw new Error(
      'mint 실모드 env 미비 (RPC_URL / PRIVATE_KEY / ACHIEVEMENTS_NFT_ADDRESS) — '
      + '컨트랙트 배포 전에는 MOCK_MINT=true 로 운용할 것',
    );
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  return new ethers.Contract(address, ACHIEVEMENTS_FRAGMENT, signer);
}

/**
 * 기본 전송 구현: mock 이면 결정적 가짜 tx_hash, 실모드면 컨트랙트 호출.
 *  반환: tx_hash (0x + 64 hex)
 */
async function defaultSend({ wallet, achievementId, dataHash }) {
  if (isMockMode()) {
    // 결정적 가짜 해시 — 같은 (지갑, 업적) 재시도 시 같은 값이라 디버깅 쉬움
    return ethers.id(`MOCK_MINT:${wallet}:${achievementId}:${dataHash}`);
  }
  const contract = getContract();
  const tx = await contract.mintAchievement(wallet, achievementId, dataHash);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * detected/failed 행 1건을 mint 한다.
 *  row: { id, wallet, achievement_id, data_hash }
 *  opts.send: 전송 구현 주입 (테스트용). 기본 defaultSend.
 *  반환: 'minted' | 'failed' | null(다른 워커가 선점 — 아무것도 안 함)
 */
async function mintDetected(db, row, opts = {}) {
  const send = opts.send || defaultSend;

  // 1) 'minting' 선점 — detected/failed 상태일 때만 전이 (동시 실행 가드)
  const claim = await db.query(`
    UPDATE achievements
       SET status = 'minting', updated_at = NOW()
     WHERE id = $1 AND status IN ('detected', 'failed')
    RETURNING id
  `, [row.id]);
  if (claim.rows.length === 0) return null;

  try {
    const txHash = await send({
      wallet: row.wallet,
      achievementId: Number(row.achievement_id),
      dataHash: row.data_hash,
    });
    await db.query(`
      UPDATE achievements
         SET status = 'minted', tx_hash = $2, last_error = NULL,
             minted_at = NOW(), updated_at = NOW()
       WHERE id = $1
    `, [row.id, txHash]);
    console.log(`[mint] 완료: wallet=${row.wallet} achievement=${row.achievement_id} tx=${txHash}${isMockMode() ? ' (MOCK)' : ''}`);
    return 'minted';
  } catch (err) {
    // 에러 보관 → status='failed' 로 두면 processPendingMints 가 재시도한다
    await db.query(`
      UPDATE achievements
         SET status = 'failed', last_error = $2, updated_at = NOW()
       WHERE id = $1
    `, [row.id, String(err.message || err).slice(0, 1000)]);
    console.error(`[mint] 실패: wallet=${row.wallet} achievement=${row.achievement_id} — ${err.message}`);
    return 'failed';
  }
}

/**
 * 밀린 mint 일괄 처리 (재시도 경로).
 *  detected: 훅이 mint 직후 죽었던 경우 / failed: 이전 실패 재시도.
 */
async function processPendingMints(db, opts = {}) {
  const { rows } = await db.query(`
    SELECT id, wallet, achievement_id, data_hash
      FROM achievements
     WHERE status IN ('detected', 'failed') AND source = 'offchain'
     ORDER BY id
  `);
  const results = [];
  for (const row of rows) {
    results.push({ id: row.id, result: await mintDetected(db, row, opts) });
  }
  return results;
}

module.exports = { mintDetected, processPendingMints, defaultSend, isMockMode };
