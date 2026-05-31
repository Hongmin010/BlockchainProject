import { Button } from './index';
import styles from './WalletModal.module.css';

export default function WalletModal({ onConnect, onClose, title }) {
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.icon}>🔌</div>

        <h2 className={styles.title}>{title ?? '지갑 연결이 필요해요'}</h2>
        <p className={styles.desc}>
          결과는 블록체인에 영구히 기록됩니다.
          <br />
          가스비가 발생할 수 있어요.
        </p>

        <div className={styles.btnList}>
          <Button variant="primary" size="lg" onClick={onConnect} className={styles.walletBtn}>
            <span className={styles.walletBtnIcon}>🦊</span>
            <span>MetaMask로 연결</span>
            <span className={styles.walletBtnArrow}>→</span>
          </Button>
        </div>

        <div className={styles.later}>
          <button className={styles.laterBtn} onClick={onClose}>
            나중에 할게요
          </button>
        </div>
      </div>
    </div>
  );
}
