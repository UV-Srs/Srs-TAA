import React from 'react';

interface SRSLogoProps {
  size?: number;
  className?: string;
}

export const SRSLogo: React.FC<SRSLogoProps> = ({ size = 34, className = '' }) => (
  <img
    src="/srs-logo.png"
    alt="SRS Consulting"
    width={size}
    height={size}
    className={className}
    style={{ display: 'block', flexShrink: 0, objectFit: 'contain' }}
    draggable={false}
  />
);
