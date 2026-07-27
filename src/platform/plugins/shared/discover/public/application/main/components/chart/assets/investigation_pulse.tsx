/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import { keyframes } from '@emotion/react';
import { i18n } from '@kbn/i18n';
import investigationPulseImage from './investigation_pulse.png';

const pulse = keyframes`
  0%   { transform: scale(1);    opacity: 1;   }
  50%  { transform: scale(1.14); opacity: 0.9; }
  100% { transform: scale(1);    opacity: 1;   }
`;

/**
 * Placeholder shown while an investigation runs. Temporary stand-in for the loading spinner.
 */
export const InvestigationPulse = ({ size = 96 }: { size?: number }) => (
  <img
    src={investigationPulseImage}
    alt={i18n.translate('discover.investigateSelection.runningIllustrationAlt', {
      defaultMessage: 'Investigation in progress',
    })}
    width={size}
    height={size}
    data-test-subj="discoverInvestigationPulse"
    css={{
      animation: `${pulse} 2s ease-in-out infinite`,
      // Motion is decorative here, so it is dropped entirely when the reader asks for less of it.
      '@media (prefers-reduced-motion: reduce)': {
        animation: 'none',
      },
    }}
  />
);
