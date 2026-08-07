import { useState } from 'react';

export function SmartImage({
  src,
  alt = '',
  className,
  fallbackSrc = '/no-photo.svg',
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  fallbackSrc?: string;
}) {
  const [failed, setFailed] = useState(false);
  const resolved = src && !failed ? src : fallbackSrc;
  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
