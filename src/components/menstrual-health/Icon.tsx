'use client';

import React from 'react';

interface IconProps {
  name: string;
  className?: string;
  size?: number;
}

export default function Icon({ name, className = '', size = 20 }: IconProps) {
  // Built-in clean SVGs matching standard Material Symbols / Icons
  const renderSvg = () => {
    switch (name) {
      case 'vital_signs':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M3 12h3l3-7 4 14 3-7h5"
          />
        );
      case 'radio_button_checked':
        return (
          <>
            <circle cx="12" cy="12" r="9" strokeWidth="2" fill="none" />
            <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
          </>
        );
      case 'calendar_today':
      case 'calendar_month':
      case 'today':
      case 'edit_calendar':
        return (
          <>
            <rect x="3" y="4" width="18" height="18" rx="3" strokeWidth="2" fill="none" />
            <line x1="3" y1="9" x2="21" y2="9" strokeWidth="2" />
            <line x1="8" y1="2" x2="8" y2="5" strokeWidth="2" strokeLinecap="round" />
            <line x1="16" y1="2" x2="16" y2="5" strokeWidth="2" strokeLinecap="round" />
          </>
        );
      case 'favorite':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
          />
        );
      case 'trending_up':
      case 'insights':
      case 'analytics':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M23 6l-9.5 9.5-5-5L1 18m22-12h-6m6 0v6"
          />
        );
      case 'auto_stories':
      case 'menu_book':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        );
      case 'tune':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4M6 16v4"
          />
        );
      case 'arrow_forward':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M5 12h14m-6-6l6 6-6 6"
          />
        );
      case 'arrow_back':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M19 12H5m6-6l-6 6 6 6"
          />
        );
      case 'chevron_left':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M15 19l-7-7 7-7"
          />
        );
      case 'chevron_right':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9 5l7 7-7 7"
          />
        );
      case 'close':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M6 18L18 6M6 6l12 12"
          />
        );
      case 'add':
      case 'add_notes':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 4v16m8-8H4"
          />
        );
      case 'add_circle':
        return (
          <>
            <circle cx="12" cy="12" r="9" strokeWidth="2" fill="none" />
            <path strokeLinecap="round" strokeWidth="2" d="M12 8v8m-4-4h8" />
          </>
        );
      case 'water_drop':
      case 'opacity':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"
          />
        );
      case 'event_upcoming':
        return (
          <>
            <rect x="3" y="4" width="18" height="18" rx="3" strokeWidth="2" fill="none" />
            <line x1="3" y1="9" x2="21" y2="9" strokeWidth="2" />
            <circle cx="16" cy="15" r="2" fill="currentColor" />
          </>
        );
      case 'info':
        return (
          <>
            <circle cx="12" cy="12" r="9" strokeWidth="2" fill="none" />
            <line x1="12" y1="8" x2="12" y2="8.01" strokeWidth="3" strokeLinecap="round" />
            <line x1="12" y1="11" x2="12" y2="16" strokeWidth="2" strokeLinecap="round" />
          </>
        );
      case 'shield':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
          />
        );
      case 'check_circle':
        return (
          <>
            <circle cx="12" cy="12" r="9" strokeWidth="2" fill="none" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4" />
          </>
        );
      case 'timelapse':
      case 'schedule':
        return (
          <>
            <circle cx="12" cy="12" r="9" strokeWidth="2" fill="none" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6l4 2" />
          </>
        );
      case 'query_stats':
        return (
          <>
            <circle cx="12" cy="12" r="9" strokeWidth="2" fill="none" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 14l2-3 3 2 3-4" />
          </>
        );
      case 'history_edu':
      case 'history':
      case 'restart_alt':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M3 12a9 9 0 109-9c-2.5 0-4.8 1-6.4 2.6L3 8m0 0V3m0 5h5M12 7v5l3 3"
          />
        );
      case 'bolt':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
          />
        );
      case 'bedtime':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        );
      case 'self_improvement':
      case 'spa':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 3c-1.5 3-5 5.5-5 9a5 5 0 0010 0c0-3.5-3.5-6-5-9z"
          />
        );
      case 'healing':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        );
      case 'psychology_alt':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        );
      case 'bubble_chart':
        return (
          <>
            <circle cx="8" cy="14" r="4" strokeWidth="2" fill="none" />
            <circle cx="15" cy="8" r="3" strokeWidth="2" fill="none" />
            <circle cx="16" cy="16" r="2" strokeWidth="2" fill="none" />
          </>
        );
      case 'face_2':
        return (
          <>
            <circle cx="12" cy="12" r="9" strokeWidth="2" fill="none" />
            <path strokeLinecap="round" strokeWidth="2" d="M9 10h.01M15 10h.01M9 15c1 1 5 1 6 0" />
          </>
        );
      case 'accessibility_new':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 4a2 2 0 100-4 2 2 0 000 4zm-7 5h14m-7 0v11m-3 0l3-5 3 5"
          />
        );
      case 'battery_2_bar':
        return (
          <>
            <rect x="2" y="6" width="18" height="12" rx="2" strokeWidth="2" fill="none" />
            <line x1="22" y1="10" x2="22" y2="14" strokeWidth="2" />
            <line x1="6" y1="10" x2="6" y2="14" strokeWidth="2" />
            <line x1="10" y1="10" x2="10" y2="14" strokeWidth="2" />
          </>
        );
      case 'sick':
        return (
          <>
            <circle cx="12" cy="12" r="9" strokeWidth="2" fill="none" />
            <path strokeLinecap="round" strokeWidth="2" d="M8 15h8M9 9l2 2m0-2l-2 2m4-2l2 2m0-2l-2 2" />
          </>
        );
      case 'block':
        return (
          <>
            <circle cx="12" cy="12" r="9" strokeWidth="2" fill="none" />
            <line x1="6" y1="6" x2="18" y2="18" strokeWidth="2" />
          </>
        );
      case 'invert_colors':
      case 'water_full':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"
            fill="currentColor"
          />
        );
      case 'tips_and_updates':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        );
      case 'south_east':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M7 7l10 10m0 0H9m8 0V9"
          />
        );
      case 'north_east':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M7 17L17 7m0 0H9m8 0v8"
          />
        );
      case 'download':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        );
      case 'table_chart':
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2" fill="none" />
            <line x1="3" y1="9" x2="21" y2="9" strokeWidth="2" />
            <line x1="3" y1="15" x2="21" y2="15" strokeWidth="2" />
            <line x1="9" y1="9" x2="9" y2="21" strokeWidth="2" />
            <line x1="15" y1="9" x2="15" y2="21" strokeWidth="2" />
          </>
        );
      case 'folder_shared':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        );
      default:
        return (
          <circle cx="12" cy="12" r="8" strokeWidth="2" fill="none" />
        );
    }
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className={`inline-block shrink-0 ${className}`}
      aria-hidden="true"
    >
      {renderSvg()}
    </svg>
  );
}

