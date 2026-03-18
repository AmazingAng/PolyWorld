import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: '#22c55e' }}>
          <polygon points="22,12 17,3.4 7,3.4 2,12 7,20.6 17,20.6" />
          <path d="M2 12h20M12 3.4L16 12l-4 8.6M12 3.4L8 12l4 8.6" />
        </svg>
        <span style={{ fontFamily: "'Inter Tight', sans-serif", fontWeight: 800, letterSpacing: '-0.02em', fontSize: '15px' }}>
          PolyWorld
        </span>
      </div>
    ),
  },
  links: [
    {
      text: 'Dashboard',
      url: '/',
      external: true,
    },
  ],
};
