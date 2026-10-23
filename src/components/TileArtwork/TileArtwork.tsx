import { artworkFor } from '../../utils/tileArtwork';

const TileArtwork = ({
  metrics,
  aggregate,
  valueBased = false,
}: {
  metrics?: readonly string[];
  aggregate?: string;
  valueBased?: boolean;
}) => {
  const artwork = artworkFor(metrics, aggregate, valueBased);
  return (
    <span
      className='tile-artwork'
      aria-hidden='true'
    >
      <img
        src={artwork.source}
        alt=''
        loading='lazy'
      />
    </span>
  );
};

export default TileArtwork;
