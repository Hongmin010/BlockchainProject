import styles from './TxHash.module.css';

const ETHERSCAN_BASE = {
  mainnet: 'https://etherscan.io/tx',
  sepolia: 'https://sepolia.etherscan.io/tx',
  'base-sepolia': 'https://sepolia.basescan.org/tx',
};

export default function TxHash({ hash = '', shorten = true, network = 'base-sepolia' }) {
  if (!hash) return null;

  const display = shorten && hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;

  const href = `${ETHERSCAN_BASE[network] ?? ETHERSCAN_BASE['base-sepolia']}/${hash}`;

  return (
    <a className={styles.tx} href={href} target="_blank" rel="noopener noreferrer" title={hash}>
      {display}
    </a>
  );
}
