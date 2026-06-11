import { NavLink } from 'react-router-dom';
import styles from './Header.module.css';

export default function Header({ address = null, onConnect }) {
  const short = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null;

  return (
    <header className={styles.header}>
      <NavLink to="/" className={styles.logo}>
        {/* 로고 이미지 아직 없음 - 고양이 이모지로 임시 대체 */}
        <span className={styles.mark}>🐱</span> <span>CatForge</span>
      </NavLink>

      <nav className={styles.nav}>
        <NavLink
          to="/game"
          className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
        >
          게임
        </NavLink>
        <NavLink
          to="/dashboard"
          className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
        >
          대시보드
        </NavLink>
        <NavLink
          to="/records"
          className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
        >
          내 기록
        </NavLink>
        <NavLink
          to="/verify"
          className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
        >
          온체인 검증
        </NavLink>
        <NavLink
          to="/ranking"
          className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
        >
          명예의 전당
        </NavLink>
      </nav>

      {short ? (
        // 지갑 연결 후 지갑 주소 (중간 생략해서) 표시
        <div className={styles.walletConnected}>
          <span className={styles.dot} />
          {short}
        </div>
      ) : (
        // 지갑 연결 전 버튼
        <button className={styles.walletBtn} onClick={onConnect}>
          지갑 연결
        </button>
      )}
    </header>
  );
}
