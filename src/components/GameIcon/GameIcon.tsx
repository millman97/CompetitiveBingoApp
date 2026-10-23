type IconKind = 'board' | 'standings' | 'chat' | 'link' | 'help' | 'banner';

/** Small interface symbols; challenge artwork comes from the hiscores asset set. */
const GameIcon = ({
  kind,
  className = '',
}: {
  kind: IconKind;
  className?: string;
}) => (
  <svg
    viewBox='0 0 40 40'
    className={`game-icon ${className}`}
    fill='none'
    stroke='#17120b'
    strokeWidth='1.6'
    strokeLinejoin='round'
    aria-hidden='true'
    focusable='false'
  >
    {kind === 'help' && (
      <>
        <circle
          cx='20'
          cy='20'
          r='16'
          fill='#5b4930'
          stroke='#d0a751'
          strokeWidth='2'
        />
        <path
          d='M14 15a6 6 0 0 1 12 0c0 5-6 5-6 10'
          stroke='#f3d27b'
          strokeWidth='3'
        />
        <path
          d='M20 28v3'
          stroke='#f3d27b'
          strokeWidth='3'
        />
      </>
    )}
    {kind === 'board' && (
      <>
        <path
          d='M6 4h28v32H6z'
          fill='#6e5940'
        />
        <path
          d='M9 7h22v26H9z'
          fill='#c7ac72'
        />
        <path
          d='M16 8v24M24 8v24M10 16h20M10 24h20'
          stroke='#705632'
        />
        <path
          d='m11 11 2 2 4-5m2 12 2 2 5-6m0 13 2 2 4-5'
          stroke='#f5d365'
          strokeWidth='2'
        />
      </>
    )}
    {kind === 'standings' && (
      <>
        <path
          d='M5 20h8v16H5z'
          fill='#b38a44'
        />
        <path
          d='M16 7h8v29h-8z'
          fill='#ebc46c'
        />
        <path
          d='M27 14h8v22h-8z'
          fill='#cba351'
        />
        <path
          d='M7 21v13M18 9v25M29 16v18'
          stroke='#fce29b'
        />
      </>
    )}
    {kind === 'chat' && (
      <>
        <path
          d='M4 5h25v22H17l-8 8v-8H4z'
          fill='#e0b655'
        />
        <path
          d='M31 13h5v20h-7l-5 5v-8'
          fill='#9a7634'
        />
        <path
          d='M7 8h18'
          stroke='#ffe8a2'
        />
      </>
    )}
    {kind === 'link' && (
      <>
        <path
          d='m17 13 6-6a7 7 0 0 1 10 10l-6 6m-10-6-6 6a7 7 0 0 0 10 10l6-6M14 26l12-12'
          stroke='#d9aa48'
          strokeWidth='5'
        />
        <path
          d='m16 25 9-9'
          stroke='#ffe39a'
          strokeWidth='1.5'
        />
      </>
    )}
    {kind === 'banner' && (
      <>
        <path
          d='M6 5h28'
          stroke='#8b7650'
          strokeWidth='5'
        />
        <path
          d='M10 5h20v32l-10-7-10 7z'
          fill='currentColor'
        />
        <path
          d='M13 8v22'
          stroke='#fff6'
        />
        <path
          d='m20 12 2 5 6 .5-4.5 4 1.5 6-5-3.5-5 3.5 1.5-6-4.5-4 6-.5z'
          fill='#efd58d'
        />
      </>
    )}
  </svg>
);

export default GameIcon;
